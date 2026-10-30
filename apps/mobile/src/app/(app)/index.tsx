import type { Room } from "@voice-intercom/client-core";
import { errorMessage, useApi, useJoinableRooms, useMe, useRoomHub, useRoomMutation, useRooms } from "@voice-intercom/client-react";
import { Alert, Badge, Button, cx, Icon, LoadErrorAlert, PageHeader, Text } from "@voice-intercom/ui-native";
import { Link, Stack, useRouter } from "expo-router";
import { ChevronDown, ChevronRight, Headphones, Plus } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";

import { Page } from "../../components/Page.tsx";
import { ROOM_KINDS } from "../../roomKinds.tsx";

// ルームの一覧。自分のルーム(参加している)、参加できるルーム(テナントの Public)、アーカイブの3つに分ける
// (設計メモの「ユーザーの3つの状態の表し方」)
export default function RoomList() {
  const me = useMe();
  const hasTenant = me.data?.tenant_id != null;
  const rooms = useRooms();
  const joinable = useJoinableRooms(hasTenant);
  const active = rooms.data?.filter((r) => !r.archived_at) ?? [];
  const archived = rooms.data?.filter((r) => r.archived_at) ?? [];
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <Page
      refreshing={rooms.isRefetching}
      onRefresh={() => {
        void rooms.refetch();
        void joinable.refetch();
      }}
    >
      <Stack.Screen
        options={{
          headerRight: () =>
            me.data && (
              // 右上はプロフィール(表示名)。ログアウトもプロフィールの画面から
              <Link href="/profile" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="プロフィール" className="max-w-48 px-2 py-1">
                  <Text className="text-sm text-on-key" numberOfLines={1}>
                    {me.data.display_name}
                  </Text>
                </Pressable>
              </Link>
            ),
        }}
      />
      <PageHeader
        title="ルーム"
        description="ルームを開くと、字幕とテキストを見て送れます。声で話すときは、ルームで「音声をつなぐ」を押します。"
      />
      {hasTenant && (
        <Link href="/rooms/new" asChild>
          <Button variant="primary" className="-mt-4 self-start">
            <Icon icon={Plus} />
            ルームを作る
          </Button>
        </Link>
      )}
      {!hasTenant && me.data && (
        <Alert tone="warning">テナントに所属していません。運営者に所属を決めてもらうと、ルームを使えます。</Alert>
      )}
      {rooms.isPending && <Text className="text-fg-muted">読み込み中…</Text>}
      {rooms.isError && (
        <LoadErrorAlert onRetry={() => void rooms.refetch()}>
          ルームの一覧を取得できません: {errorMessage(rooms.error)}
        </LoadErrorAlert>
      )}
      {rooms.isSuccess && (
        <RoomSection title="自分のルーム">
          {active.length === 0 ? (
            <Text className="text-fg-muted">参加しているルームはありません。ルームを作るか、下の一覧から参加してください。</Text>
          ) : (
            <RoomRows rooms={active} />
          )}
        </RoomSection>
      )}
      {joinable.isSuccess && joinable.data.length > 0 && (
        <RoomSection title="参加できるルーム" description="テナントの誰でも参加できる Public のルームです。">
          <RoomRows rooms={joinable.data} joinable />
        </RoomSection>
      )}
      {archived.length > 0 && (
        <View className="gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: archiveOpen }}
            className="flex-row items-center gap-1 self-start py-1"
            onPress={() => setArchiveOpen(!archiveOpen)}
          >
            <Icon icon={archiveOpen ? ChevronDown : ChevronRight} color="fg-muted" />
            <Text className="text-sm font-bold text-fg-muted">アーカイブ({archived.length})</Text>
          </Pressable>
          {archiveOpen && <RoomRows rooms={archived} />}
        </View>
      )}
    </Page>
  );
}

function RoomSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <View className="gap-3">
      <View>
        <Text accessibilityRole="header" className="font-bold">
          {title}
        </Text>
        {description && <Text className="text-sm text-fg-muted">{description}</Text>}
      </View>
      {children}
    </View>
  );
}

// カードを並べず、1枚の面を線で区切る(行は同じ種類のものなので)
function RoomRows({ rooms, joinable = false }: { rooms: Room[]; joinable?: boolean }) {
  return (
    <View className="overflow-hidden rounded-lg border border-border bg-surface">
      {rooms.map((room, i) => (
        <View key={room.room_id} className={cx(i > 0 && "border-t border-border")}>
          {joinable ? <JoinableRow room={room} /> : <RoomRow room={room} />}
        </View>
      ))}
    </View>
  );
}

function RoomName({ room }: { room: Room }) {
  const { label, Icon: KindIcon } = ROOM_KINDS[room.kind];
  return (
    <View className="min-w-0 flex-1 flex-row items-center gap-2">
      <Icon icon={KindIcon} color="fg-muted" accessibilityLabel={label} />
      <Text className="flex-1 text-lg font-bold" numberOfLines={1}>
        {room.name}
      </Text>
    </View>
  );
}

function RoomRow({ room }: { room: Room }) {
  const hub = useRoomHub();
  const audio = hub.get(room.room_id)?.session.audio ?? false;
  return (
    <Link href={{ pathname: "/rooms/[roomId]", params: { roomId: room.room_id } }} asChild>
      <Pressable accessibilityRole="link" className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-surface-muted">
        <RoomName room={room} />
        {audio && (
          <Badge tone="neutral">
            <Icon icon={Headphones} size={14} />
            音声中
          </Badge>
        )}
        <Text className="text-sm text-fg-muted">{room.member_ids.length}人</Text>
        <Icon icon={ChevronRight} size={20} color="fg-muted" />
      </Pressable>
    </Link>
  );
}

function JoinableRow({ room }: { room: Room }) {
  const api = useApi();
  const router = useRouter();
  const join = useRoomMutation(room.room_id, () => api.joinRoom(room.room_id));
  return (
    <View className="gap-2 px-4 py-3">
      <View className="flex-row items-center gap-3">
        <RoomName room={room} />
        <Text className="text-sm text-fg-muted">{room.member_ids.length}人</Text>
        <Button
          size="sm"
          disabled={join.isPending}
          onPress={() =>
            join.mutate(undefined, {
              onSuccess: () => router.push({ pathname: "/rooms/[roomId]", params: { roomId: room.room_id } }),
            })
          }
        >
          参加する
        </Button>
      </View>
      {join.isError && <Text className="text-sm text-danger-fg">{errorMessage(join.error)}</Text>}
    </View>
  );
}
