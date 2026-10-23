import type { MemberRole, Room, RoomMember } from "@voice-intercom/client-core";
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Input, PageHeader, Select } from "@voice-intercom/ui-web";
import { ChevronLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "react-oidc-context";
import { Link, useNavigate, useParams } from "react-router";

import { api } from "../api.ts";
import { errorMessage, useMe, useRoom, useRoomMembers, useRoomMutation, useUsers } from "../queries.ts";
import { ROOM_KINDS, RoomKindBadge } from "../RoomKind.tsx";
import { useRoomHub } from "../roomHub.tsx";

// ルームのメンバーと設定。オーナーと管理者は、名前・種類・メンバー(自分のテナントの人だけ)を変え、
// アーカイブできる。誰でも抜けられるが、最後のオーナーは抜けられない(設計メモの「テナントとルームの種別」)
export default function RoomSettings() {
  const roomId = useParams().roomId ?? "";
  const room = useRoom(roomId);
  const me = useMe();
  const { user } = useAuth();
  const myIdentity = user?.profile.sub;
  const groups = user?.profile["cognito:groups"];
  const isAdmin = Array.isArray(groups) && groups.includes("admin");
  const back = (
    <Link to={`/rooms/${encodeURIComponent(roomId)}`} className="inline-flex items-center gap-0.5 text-fg-muted no-underline hover:text-fg">
      <ChevronLeft aria-hidden="true" className="size-4" />
      ルームに戻る
    </Link>
  );

  if (room.isPending || me.isPending) {
    return <p className={pageClass}>読み込み中…</p>;
  }
  if (room.isError || !me.data || !myIdentity) {
    return (
      <section className={pageClass}>
        <PageHeader title="メンバーと設定" back={back} />
        <Alert tone="danger">ルームを開けません: {room.isError ? errorMessage(room.error) : "プロフィールがありません"}</Alert>
      </section>
    );
  }
  const r = room.data;
  const myTenant = me.data.tenant_id ?? undefined;
  const tenants = [r.tenant_id, r.connect_tenant_id].filter(Boolean);
  const canManage = myTenant !== undefined && tenants.includes(myTenant) && (r.owner_ids.includes(myIdentity) || isAdmin);
  return (
    <section className={pageClass}>
      <PageHeader title="メンバーと設定" back={back} description={r.name} />
      <div className="grid gap-6">
        <RoomBasics room={r} canManage={canManage} />
        <Members room={r} canManage={canManage} myIdentity={myIdentity} myTenant={myTenant} />
        <LeaveAndArchive room={r} canManage={canManage} myIdentity={myIdentity} />
      </div>
    </section>
  );
}

const pageClass = "mx-auto max-w-3xl px-4 py-8 sm:px-6";

function RoomBasics({ room, canManage }: { room: Room; canManage: boolean }) {
  const [name, setName] = useState(room.name);
  const [kind, setKind] = useState(room.kind);
  const update = useRoomMutation(room.room_id, (body: { name: string; kind?: "public" | "private" }) =>
    api.updateRoom(room.room_id, body),
  );
  const changed = name.trim() !== room.name || kind !== room.kind;

  if (!canManage) {
    return (
      <Card className="grid gap-2">
        <h2>種類</h2>
        <p className="flex items-center gap-2 text-sm">
          <RoomKindBadge kind={room.kind} />
          {ROOM_KINDS[room.kind].description}
        </p>
      </Card>
    );
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ name: name.trim(), ...(kind !== "connect" && { kind }) });
  };
  return (
    <form onSubmit={onSubmit}>
      <Card className="grid gap-4">
        <h2>名前と種類</h2>
        <Field label="名前">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {room.kind === "connect" ? (
          <p className="flex items-center gap-2 text-sm">
            <RoomKindBadge kind="connect" />
            {ROOM_KINDS.connect.description}(種類は変えられません)
          </p>
        ) : (
          <Field label="種類" hint={ROOM_KINDS[kind].description}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as "public" | "private")}>
              <option value="private">{ROOM_KINDS.private.label}</option>
              <option value="public">{ROOM_KINDS.public.label}</option>
            </Select>
          </Field>
        )}
        {update.isError && <Alert tone="danger">保存できません: {errorMessage(update.error)}</Alert>}
        <div>
          <Button type="submit" disabled={!changed || name.trim() === "" || update.isPending}>
            保存する
          </Button>
        </div>
      </Card>
    </form>
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
  const members = useRoomMembers(room.room_id);
  const users = useUsers();
  const [invitee, setInvitee] = useState("");
  const put = useRoomMutation(room.room_id, ({ userId, role }: { userId: string; role: MemberRole }) =>
    api.putRoomMember(room.room_id, userId, role),
  );
  const remove = useRoomMutation(room.room_id, (userId: string) => api.deleteRoomMember(room.room_id, userId));
  const error = put.error ?? remove.error;
  const memberIds = new Set(room.member_ids);
  const candidates = users.data?.filter((u) => !memberIds.has(u.user_id)) ?? [];
  // 変えられるのは、自分のテナントの人だけ(Connect では相手のテナントの人を変えない)
  const isOwnSide = (m: RoomMember) => (m.tenant_id || room.tenant_id) === myTenant;
  const lastOwner = room.owner_ids.length === 1;

  return (
    <Card className="grid gap-4">
      <h2>メンバー({room.member_ids.length}人)</h2>
      {members.isPending && <p className="text-sm text-fg-muted">読み込み中…</p>}
      {members.isError && <Alert tone="danger">メンバーを取得できません: {errorMessage(members.error)}</Alert>}
      {members.isSuccess && (
        <ul className="divide-y divide-border">
          {members.data.map((m) => {
            const owner = m.role === "owner";
            const manageable = canManage && isOwnSide(m);
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {m.display_name ?? m.user_id}
                  {m.user_id === myIdentity && <span className="ml-1 text-sm text-fg-muted">(自分)</span>}
                </span>
                {room.kind === "connect" && !isOwnSide(m) && <Badge tone="neutral">相手のテナント</Badge>}
                {owner && <Badge tone="primary">オーナー</Badge>}
                {manageable && (
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={put.isPending || (owner && lastOwner)}
                      title={owner && lastOwner ? "最後のオーナーはメンバーに戻せません" : undefined}
                      onClick={() => put.mutate({ userId: m.user_id, role: owner ? "member" : "owner" })}
                    >
                      {owner ? "メンバーに戻す" : "オーナーにする"}
                    </Button>
                    {m.user_id !== myIdentity && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending || (owner && lastOwner)}
                        onClick={() => remove.mutate(m.user_id)}
                      >
                        外す
                      </Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <Alert tone="danger">変えられませんでした: {errorMessage(error)}</Alert>}
      {canManage && (
        <form
          className="grid grid-cols-[1fr_auto] items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (invitee) {
              put.mutate({ userId: invitee, role: "member" }, { onSuccess: () => setInvitee("") });
            }
          }}
        >
          <Field label="招待する" hint="自分のテナントの人を、すぐにメンバーにします。">
            <Select value={invitee} onChange={(e) => setInvitee(e.target.value)} disabled={candidates.length === 0}>
              <option value="">{candidates.length === 0 ? "招待できる人はいません" : "選んでください"}</option>
              {candidates.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.display_name}
                </option>
              ))}
            </Select>
          </Field>
          {/* 説明の行の分だけ上にそろえる */}
          <Button type="submit" className="mb-5" disabled={!invitee || put.isPending}>
            招待する
          </Button>
        </form>
      )}
    </Card>
  );
}

function LeaveAndArchive({ room, canManage, myIdentity }: { room: Room; canManage: boolean; myIdentity: string }) {
  const hub = useRoomHub();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<"leave" | "archive">();
  const leave = useRoomMutation(room.room_id, () => api.deleteRoomMember(room.room_id, myIdentity));
  const archive = useRoomMutation(room.room_id, () => api.archiveRoom(room.room_id));
  const unarchive = useRoomMutation(room.room_id, () => api.unarchiveRoom(room.room_id));
  const lastOwner = room.owner_ids.length === 1 && room.owner_ids[0] === myIdentity;
  const error = leave.error ?? archive.error ?? unarchive.error;

  return (
    <Card className="grid gap-3">
      <h2>抜ける・アーカイブ</h2>
      {lastOwner ? (
        <p className="text-sm text-fg-muted">
          あなたは最後のオーナーなので、抜けられません。ほかの人をオーナーにするか、アーカイブしてください。
        </p>
      ) : (
        <p className="text-sm text-fg-muted">抜けると、一覧に出なくなります。{room.kind === "public" ? "Public なので、また参加できます。" : "入り直すには招待が要ります。"}</p>
      )}
      {canManage && (
        <p className="text-sm text-fg-muted">
          {room.archived_at
            ? "アーカイブしています。戻すと、また話したり送ったりできます。"
            : "アーカイブすると、全員の音声が切れ、履歴を読むだけのルームになります。メンバーはそのまま残ります。"}
        </p>
      )}
      {error && <Alert tone="danger">できませんでした: {errorMessage(error)}</Alert>}
      <div className="flex flex-wrap gap-2">
        {!lastOwner && (
          <Button variant="danger" disabled={leave.isPending} onClick={() => setConfirm("leave")}>
            このルームを抜ける
          </Button>
        )}
        {canManage &&
          (room.archived_at ? (
            <Button disabled={unarchive.isPending} onClick={() => unarchive.mutate(undefined)}>
              アーカイブを戻す
            </Button>
          ) : (
            <Button disabled={archive.isPending} onClick={() => setConfirm("archive")}>
              アーカイブする
            </Button>
          ))}
      </div>
      <ConfirmDialog
        open={confirm === "leave"}
        tone="danger"
        title={`${room.name} を抜けますか?`}
        description="音声をつないでいれば切れます。"
        confirmLabel="抜ける"
        cancelLabel="やめる"
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setConfirm(undefined);
          leave.mutate(undefined, {
            onSuccess: () => {
              hub.drop(room.room_id);
              void navigate("/", { replace: true });
            },
          });
        }}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        title={`${room.name} をアーカイブしますか?`}
        description="全員の音声が切れ、話したり送ったりできなくなります。履歴は読めます。あとで戻せます。"
        confirmLabel="アーカイブする"
        cancelLabel="やめる"
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setConfirm(undefined);
          archive.mutate(undefined, { onSuccess: () => hub.drop(room.room_id) });
        }}
      />
    </Card>
  );
}
