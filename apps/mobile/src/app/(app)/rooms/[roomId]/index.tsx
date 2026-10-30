// ルームの画面。開いている間はデータだけでつなぎ(タイムラインを見て、テキストを送れる)、
// 「音声をつなぐ」でマイクとスピーカーも使う。音声をつないだら、画面を離れてもつないだまま(RoomHub)。
// アプリを裏に回したときは RoomKeeper が受け持つ(PTT を離す、戻ったら入り直す、画面を消させない)
import {
  apiMediaBackend,
  MediaUploader,
  type Room,
  type RoomConnection,
  RoomSession,
  type User,
} from "@voice-intercom/client-core";
import {
  errorMessage,
  joinErrorMessage,
  PAGE_LIMIT,
  useApi,
  useMe,
  useObservable,
  useRoom,
  useRoomHub,
  useRoomMutation,
} from "@voice-intercom/client-react";
import { Alert, Badge, Button, Icon, Text } from "@voice-intercom/ui-native";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { Archive, Headphones, Settings, Users } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { KeyboardAvoidingView, Pressable, View } from "react-native";

import { useAuth } from "../../../../auth.ts";
import { mobileMediaPreparer, xhrSignedPut } from "../../../../mobileMedia.ts";
import { Console, type Uploader } from "../../../../room/Console.tsx";
import { Timeline } from "../../../../room/Timeline.tsx";
import { RoomKindBadge } from "../../../../roomKinds.tsx";

export default function RoomPage() {
  const { roomId = "" } = useLocalSearchParams<{ roomId: string }>();
  const room = useRoom(roomId);
  const me = useMe();
  const auth = useAuth();
  const myIdentity = auth.state.status === "signedIn" ? auth.state.user.sub : undefined;

  if (room.isPending || me.isPending) {
    return <Message>読み込み中…</Message>;
  }
  if (room.isError) {
    return (
      <Message>
        <Alert tone="danger">ルームを開けません: {errorMessage(room.error)}</Alert>
      </Message>
    );
  }
  if (!me.data || !myIdentity) {
    return (
      <Message>
        <Alert tone="danger">プロフィールが登録されていません。</Alert>
      </Message>
    );
  }
  const header = <RoomHeader room={room.data} />;
  if (!room.data.member_ids.includes(myIdentity)) {
    return (
      <>
        {header}
        <JoinRoom room={room.data} />
      </>
    );
  }
  if (room.data.archived_at) {
    return (
      <>
        {header}
        <ArchivedRoom key={roomId} room={room.data} me={me.data} myIdentity={myIdentity} />
      </>
    );
  }
  return (
    <>
      {header}
      <RoomScreen key={roomId} room={room.data} me={me.data} myIdentity={myIdentity} />
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 gap-3 bg-canvas px-4 py-6">
      {typeof children === "string" ? <Text className="text-fg-muted">{children}</Text> : children}
    </View>
  );
}

// 上の帯に、ルームの名前と、設定への入り口を出す
function RoomHeader({ room }: { room: Room }) {
  return (
    <Stack.Screen
      options={{
        title: room.name,
        headerRight: () => (
          <Link href={{ pathname: "/rooms/[roomId]/settings", params: { roomId: room.room_id } }} asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="メンバーと設定" className="p-2">
              <Icon icon={Settings} size={20} color="on-key" />
            </Pressable>
          </Link>
        ),
      }}
    />
  );
}

// メンバーでない Public のルーム(一覧から開いた、リンクを受け取った)。参加すれば入れる
function JoinRoom({ room }: { room: Room }) {
  const api = useApi();
  const join = useRoomMutation(room.room_id, () => api.joinRoom(room.room_id));
  return (
    <Message>
      <Text className="text-fg-muted">
        {room.kind === "public"
          ? `このルームにはまだ参加していません(${room.member_ids.length}人が参加しています)。`
          : "このルームのメンバーではありません。"}
      </Text>
      {join.isError && <Alert tone="danger">参加できませんでした: {errorMessage(join.error)}</Alert>}
      {room.kind === "public" && !room.archived_at && (
        <Button variant="primary" className="self-start" disabled={join.isPending} onPress={() => join.mutate(undefined)}>
          参加する
        </Button>
      )}
    </Message>
  );
}

// アーカイブしたルーム。履歴を読むだけで、つながない
function ArchivedRoom({ room, me, myIdentity }: { room: Room; me: User; myIdentity: string }) {
  const api = useApi();
  const [session, setSession] = useState<RoomSession>();
  useObservable(session);
  useEffect(() => {
    const s = new RoomSession({
      myIdentity,
      myLanguage: me.language,
      roomName: room.name,
      fetchTimelinePage: (before) => api.listTimeline(room.room_id, { limit: PAGE_LIMIT, before }),
    });
    setSession(s);
    void s.timeline.syncLatest().then(() => s.applyTimeline([]));
    return () => s.dispose();
  }, [api, room.room_id, room.name, me.language, myIdentity]);
  return (
    <View className="flex-1 bg-canvas">
      <StatusRow room={room} />
      {session ? <Timeline session={session} myLanguage={me.language} readOnly /> : <View className="flex-1" />}
      <View className="flex-row items-center gap-2 border-t border-border bg-surface px-4 pt-4 pb-safe-or-4">
        <Icon icon={Archive} color="fg-muted" />
        <Text className="flex-1 text-sm text-fg-muted">
          アーカイブしたルームです。履歴を読めますが、話したり送ったりはできません。
        </Text>
      </View>
    </View>
  );
}

function RoomScreen({ room, me, myIdentity }: { room: Room; me: User; myIdentity: string }) {
  const roomId = room.room_id;
  const roomName = room.name;
  const api = useApi();
  const hub = useRoomHub();
  const headerHeight = useHeaderHeight();
  const [connection, setConnection] = useState<RoomConnection>();
  const [uploader, setUploader] = useState<Uploader>();
  const session = connection?.session;
  const keeper = connection?.keeper;
  useObservable(session);
  useObservable(keeper);
  useObservable(uploader);
  const joinError = keeper?.joinError === undefined ? undefined : joinErrorMessage(keeper.joinError);

  useEffect(() => {
    const c = hub.open(roomId, roomName);
    const u: Uploader = new MediaUploader({
      roomId,
      backend: apiMediaBackend(api, xhrSignedPut),
      preparer: mobileMediaPreparer,
      // 送ったものは、配信を待たずにすぐタイムラインに出す
      onCompleted: (event) => c.session.addMedia([event]),
    });
    setConnection(c);
    setUploader(u);
    // 画面を離れたら、アップロードは取りやめる。音声をつないでいなければ切る
    return () => {
      u.dispose();
      hub.close(roomId);
    };
  }, [api, hub, roomId, roomName]);

  return (
    // キーボードを出したら、操作の台をキーボードの上に上げる
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} className="flex-1 bg-canvas">
      <StatusRow room={room}>{session && <RoomStatus session={session} rejoining={keeper?.rejoining ?? false} />}</StatusRow>
      {(joinError || session?.error || session?.warning || keeper?.awayNotice) && (
        <View className="w-full max-w-3xl gap-2 self-center px-4 pt-3">
          {(joinError ?? session?.error) && (
            <Alert
              tone="danger"
              action={
                keeper &&
                session?.canRejoin && (
                  <Button size="sm" onPress={() => void keeper.rejoin()}>
                    入り直す
                  </Button>
                )
              }
            >
              {joinError ?? session?.error}
            </Alert>
          )}
          {session?.warning && <Text className="text-sm text-fg-muted">{session.warning}</Text>}
          {keeper?.awayNotice && (
            // 裏に回っていた間の声は聞けていないかもしれない。控えめに、字幕と履歴で追えることだけを示す
            <View className="flex-row flex-wrap items-baseline gap-x-2">
              <Text className="text-sm text-fg-muted">
                アプリを離れていた間の声は、聞こえていなかったかもしれません。字幕と履歴で追えます。
              </Text>
              <Button variant="link" textClassName="text-xs" onPress={() => keeper.dismissAwayNotice()}>
                閉じる
              </Button>
            </View>
          )}
        </View>
      )}
      {session ? <Timeline session={session} myLanguage={me.language} /> : <View className="flex-1" />}
      {session && (
        <Console
          session={session}
          uploader={uploader}
          myIdentity={myIdentity}
          myLanguage={me.language}
          onAudio={(enabled) => void hub.setAudio(roomId, roomName, enabled)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// 帯の下の、ルームの種別と状態の行
function StatusRow({ room, children }: { room: Room; children?: ReactNode }) {
  return (
    <View className="border-b border-border bg-canvas">
      <View className="w-full max-w-3xl flex-row flex-wrap items-center gap-x-3 gap-y-1 self-center px-4 py-2">
        <RoomKindBadge kind={room.kind} />
        {children}
      </View>
    </View>
  );
}

function RoomStatus({ session, rejoining }: { session: RoomSession; rejoining: boolean }) {
  if (!session.connected) {
    if (rejoining) {
      return <Badge tone="neutral">つなぎ直し中…</Badge>;
    }
    return <Badge tone={session.error ? "danger" : "neutral"}>{session.error ? "切断" : "接続中…"}</Badge>;
  }
  return (
    <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
      {session.audio && (
        <View className="flex-row items-center gap-1">
          <Icon icon={Headphones} />
          <Text className="text-sm font-medium">音声中</Text>
        </View>
      )}
      <View className="flex-row items-center gap-1">
        <Icon icon={Users} color="fg-muted" />
        <Text className="text-sm text-fg-muted">{session.participantCount}人</Text>
      </View>
      {/* dev では使っていない間 Agent を止めているので、起動を待つことがある(設計メモの「Agent の scale to zero」) */}
      <Text className="text-sm text-fg-muted">{session.agentPresent ? "翻訳あり" : "翻訳の準備中"}</Text>
    </View>
  );
}
