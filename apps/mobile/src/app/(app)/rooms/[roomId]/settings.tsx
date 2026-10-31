// ルームのメンバーと設定。オーナーと管理者は、名前・種類・メンバー(自分のテナントの人だけ)を変え、
// アーカイブできる。誰でも抜けられるが、最後のオーナーは抜けられない(設計メモの「テナントとルームの種別」)
import { LANGUAGE_LABELS, type MemberRole, type Room, type RoomMember } from "@voice-intercom/client-core";
import {
  errorMessage,
  isPermanentError,
  useApi,
  useMe,
  useRoom,
  useRoomHub,
  useRoomMembers,
  useRoomMutation,
  useUsers,
} from "@voice-intercom/client-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxList,
  ChoiceGroup,
  ConfirmDialog,
  cx,
  Field,
  Icon,
  Input,
  LoadErrorAlert,
  PageHeader,
  Text,
} from "@voice-intercom/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAuth } from "../../../../auth.ts";
import { Page } from "../../../../components/Page.tsx";
import { ROOM_KINDS, RoomKindBadge } from "../../../../roomKinds.tsx";

export default function RoomSettings() {
  const { roomId = "" } = useLocalSearchParams<{ roomId: string }>();
  const room = useRoom(roomId);
  const me = useMe();
  const auth = useAuth();
  const user = auth.state.status === "signedIn" ? auth.state.user : undefined;
  const myIdentity = user?.sub;
  const isAdmin = user?.groups.includes("admin") ?? false;

  if (room.isPending || me.isPending) {
    return (
      <Page>
        <Text className="text-fg-muted">読み込み中…</Text>
      </Page>
    );
  }
  const r = room.data;
  // 取り直しの失敗なら、持っている値で画面を保つ(外すと入力中の内容が消える)。無くなった・権限が無くなったときは続けない
  if (r === undefined || (room.isError && isPermanentError(room.error))) {
    return (
      <Page>
        <LoadErrorAlert onRetry={() => void room.refetch()} retryable={!isPermanentError(room.error)}>
          ルームを開けません: {errorMessage(room.error)}
        </LoadErrorAlert>
      </Page>
    );
  }
  if (!me.data || !myIdentity) {
    return (
      <Page>
        <Alert tone="danger">ルームを開けません: プロフィールがありません</Alert>
      </Page>
    );
  }
  const myTenant = me.data.tenant_id ?? undefined;
  const tenants = [r.tenant_id, r.connect_tenant_id].filter(Boolean);
  const canManage = myTenant !== undefined && tenants.includes(myTenant) && (r.owner_ids.includes(myIdentity) || isAdmin);
  return (
    <Page>
      <View className="gap-6">
        <PageHeader title="メンバーと設定" description={r.name} />
        <RoomBasics room={r} canManage={canManage} />
        <Members room={r} canManage={canManage} myIdentity={myIdentity} myTenant={myTenant} />
        <LeaveAndArchive room={r} canManage={canManage} myIdentity={myIdentity} />
      </View>
    </Page>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" className="font-bold">
      {children}
    </Text>
  );
}

function RoomBasics({ room, canManage }: { room: Room; canManage: boolean }) {
  const api = useApi();
  const [name, setName] = useState(room.name);
  const [kind, setKind] = useState(room.kind);
  const update = useRoomMutation(room.room_id, (body: { name: string; kind?: "public" | "private" }) =>
    api.updateRoom(room.room_id, body),
  );
  const changed = name.trim() !== room.name || kind !== room.kind;

  if (!canManage) {
    return (
      <Card className="gap-2">
        <SectionTitle>種類</SectionTitle>
        <View className="flex-row flex-wrap items-center gap-2">
          <RoomKindBadge kind={room.kind} />
          <Text className="text-sm">{ROOM_KINDS[room.kind].description}</Text>
        </View>
      </Card>
    );
  }
  return (
    <Card className="gap-4">
      <SectionTitle>名前と種類</SectionTitle>
      <Field label="名前">
        <Input value={name} onChangeText={setName} />
      </Field>
      {room.kind === "connect" ? (
        <View className="flex-row flex-wrap items-center gap-2">
          <RoomKindBadge kind="connect" />
          <Text className="text-sm">{ROOM_KINDS.connect.description}(種類は変えられません)</Text>
        </View>
      ) : (
        <ChoiceGroup
          legend="種類"
          name="kind"
          value={kind}
          onChange={setKind}
          options={(["private", "public"] as const).map((k) => {
            const { label, description, Icon: KindIcon } = ROOM_KINDS[k];
            return { value: k, label, description, icon: <Icon icon={KindIcon} /> };
          })}
        />
      )}
      {update.isError && <Alert tone="danger">保存できません: {errorMessage(update.error)}</Alert>}
      <Button
        className="self-start"
        disabled={!changed || name.trim() === "" || update.isPending}
        onPress={() => update.mutate({ name: name.trim(), ...(kind !== "connect" && { kind }) })}
      >
        保存する
      </Button>
    </Card>
  );
}

function Members({
  room,
  canManage,
  myIdentity,
  myTenant,
}: {
  room: Room;
  canManage: boolean;
  myIdentity: string;
  myTenant: string | undefined;
}) {
  const api = useApi();
  const members = useRoomMembers(room.room_id);
  const users = useUsers();
  const [invitees, setInvitees] = useState<string[]>([]);
  // 選んだ人を順に足す(承諾は待たない)
  const invite = useRoomMutation(room.room_id, async (userIds: string[]) => {
    for (const userId of userIds) {
      await api.putRoomMember(room.room_id, userId, "member");
    }
  });
  const put = useRoomMutation(room.room_id, ({ userId, role }: { userId: string; role: MemberRole }) =>
    api.putRoomMember(room.room_id, userId, role),
  );
  const remove = useRoomMutation(room.room_id, (userId: string) => api.deleteRoomMember(room.room_id, userId));
  const error = put.error ?? remove.error ?? invite.error;
  const memberIds = new Set(room.member_ids);
  const candidates = (users.data ?? [])
    .filter((u) => !memberIds.has(u.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"))
    .map((u) => ({ value: u.user_id, label: u.display_name, description: LANGUAGE_LABELS[u.language] }));
  // 変えられるのは、自分のテナントの人だけ(Connect では相手のテナントの人を変えない)
  const isOwnSide = (m: RoomMember) => (m.tenant_id || room.tenant_id) === myTenant;
  const lastOwner = room.owner_ids.length === 1;

  return (
    <Card className="gap-4">
      <SectionTitle>{`メンバー(${room.member_ids.length}人)`}</SectionTitle>
      {members.isPending && <Text className="text-sm text-fg-muted">読み込み中…</Text>}
      {members.isError && (
        <LoadErrorAlert onRetry={() => void members.refetch()}>
          メンバーを取得できません: {errorMessage(members.error)}
        </LoadErrorAlert>
      )}
      {members.isSuccess && (
        <View>
          {members.data.map((m, i) => {
            const owner = m.role === "owner";
            const manageable = canManage && isOwnSide(m);
            return (
              <View key={m.user_id} className={cx("gap-2 py-2", i > 0 && "border-t border-border")}>
                <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                  <Text className="min-w-0 flex-1" numberOfLines={1}>
                    {m.display_name ?? m.user_id}
                    {m.user_id === myIdentity && <Text className="text-sm text-fg-muted">(自分)</Text>}
                  </Text>
                  {room.kind === "connect" && !isOwnSide(m) && <Badge tone="neutral">相手のテナント</Badge>}
                  {owner && <Badge tone="primary">オーナー</Badge>}
                </View>
                {manageable && (
                  <View className="flex-row flex-wrap gap-1">
                    <Button
                      size="sm"
                      disabled={put.isPending || (owner && lastOwner)}
                      accessibilityHint={owner && lastOwner ? "最後のオーナーはメンバーに戻せません" : undefined}
                      onPress={() => put.mutate({ userId: m.user_id, role: owner ? "member" : "owner" })}
                    >
                      {owner ? "メンバーに戻す" : "オーナーにする"}
                    </Button>
                    {m.user_id !== myIdentity && (
                      <Button size="sm" disabled={remove.isPending || (owner && lastOwner)} onPress={() => remove.mutate(m.user_id)}>
                        外す
                      </Button>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
      {error && <Alert tone="danger">変えられませんでした: {errorMessage(error)}</Alert>}
      {canManage && users.isSuccess && (
        <View className="gap-3 border-t border-border pt-4">
          <CheckboxList
            legend="招待する"
            hint="自分のテナントの人を、すぐにメンバーにします。"
            options={candidates}
            value={invitees}
            onChange={setInvitees}
            disabled={invite.isPending}
            selectedLabel={(n) => `${n}人を選んでいます`}
            emptyMessage="招待できる人はいません。"
            noMatchMessage={(q) => `「${q}」に当てはまる人はいません。`}
          />
          {invitees.length > 0 && (
            <Button
              className="self-start"
              disabled={invite.isPending}
              onPress={() => invite.mutate(invitees, { onSettled: () => setInvitees([]) })}
            >
              {invite.isPending ? "招待しています…" : `${invitees.length}人を招待する`}
            </Button>
          )}
        </View>
      )}
    </Card>
  );
}

function LeaveAndArchive({ room, canManage, myIdentity }: { room: Room; canManage: boolean; myIdentity: string }) {
  const api = useApi();
  const hub = useRoomHub();
  const router = useRouter();
  const [confirm, setConfirm] = useState<"leave" | "archive">();
  const leave = useRoomMutation(room.room_id, () => api.deleteRoomMember(room.room_id, myIdentity));
  const archive = useRoomMutation(room.room_id, () => api.archiveRoom(room.room_id));
  const unarchive = useRoomMutation(room.room_id, () => api.unarchiveRoom(room.room_id));
  const lastOwner = room.owner_ids.length === 1 && room.owner_ids[0] === myIdentity;
  const error = leave.error ?? archive.error ?? unarchive.error;

  return (
    <Card className="gap-3">
      <SectionTitle>抜ける・アーカイブ</SectionTitle>
      {lastOwner ? (
        <Text className="text-sm text-fg-muted">
          あなたは最後のオーナーなので、抜けられません。ほかの人をオーナーにするか、アーカイブしてください。
        </Text>
      ) : (
        <Text className="text-sm text-fg-muted">
          抜けると、一覧に出なくなります。{room.kind === "public" ? "Public なので、また参加できます。" : "入り直すには招待が要ります。"}
        </Text>
      )}
      {canManage && (
        <Text className="text-sm text-fg-muted">
          {room.archived_at
            ? "アーカイブしています。戻すと、また話したり送ったりできます。"
            : "アーカイブすると、全員の音声が切れ、履歴を読むだけのルームになります。メンバーはそのまま残ります。"}
        </Text>
      )}
      {error && <Alert tone="danger">できませんでした: {errorMessage(error)}</Alert>}
      <View className="flex-row flex-wrap gap-2">
        {!lastOwner && (
          <Button variant="danger" disabled={leave.isPending} onPress={() => setConfirm("leave")}>
            このルームを抜ける
          </Button>
        )}
        {canManage &&
          (room.archived_at ? (
            <Button disabled={unarchive.isPending} onPress={() => unarchive.mutate(undefined)}>
              アーカイブを戻す
            </Button>
          ) : (
            <Button disabled={archive.isPending} onPress={() => setConfirm("archive")}>
              アーカイブする
            </Button>
          ))}
      </View>
      <ConfirmDialog
        open={confirm === "leave"}
        tone="danger"
        title={`${room.name} を抜けますか?`}
        description="音声をつないでいれば切れます。"
        confirmLabel="抜ける"
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setConfirm(undefined);
          leave.mutate(undefined, {
            onSuccess: () => {
              hub.drop(room.room_id);
              router.dismissTo("/");
            },
          });
        }}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        title={`${room.name} をアーカイブしますか?`}
        description="全員の音声が切れ、話したり送ったりできなくなります。履歴は読めます。あとで戻せます。"
        confirmLabel="アーカイブする"
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setConfirm(undefined);
          archive.mutate(undefined, { onSuccess: () => hub.drop(room.room_id) });
        }}
      />
    </Card>
  );
}
