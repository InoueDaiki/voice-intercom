// 音声中の帯。音声をつないだルームが1つでもあれば、下に出す(設計メモの「ユーザーの3つの状態の表し方」)。
// 音声をつないだルームの画面には、同じ PTT が操作の台にあるので出さない。
// - たたんだ見出しに、どこかで声が流れているか(TX・RX の灯り)とルームの名前を出す
// - 開くと、ルームごとに灯りと、そのルームだけに話す操作、切る操作を並べる
// - 主の PTT(音声をつないだ全部のルームに届く)を下に置く
import type { RoomConnection, RoomHub } from "@voice-intercom/client-core";
import { pressOne, receivingCaption, signalOf, useRoomHub } from "@voice-intercom/client-react";
import { Button, cx, Icon, SignalLamp, type SignalState, Text } from "@voice-intercom/ui-native";
import { Link, usePathname } from "expo-router";
import { ChevronDown, Headphones, Mic, PhoneOff } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { MainPtt } from "./MainPtt.tsx";

export function AudioDock({ myIdentity }: { myIdentity: string }) {
  const hub = useRoomHub();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rooms = hub.audioRooms;
  // 音声をつないだルームの画面(設定の画面は除く)には、操作の台に PTT がある
  const currentRoomId = /^\/rooms\/([^/]+)$/.exec(pathname)?.[1];
  if (rooms.length === 0 || rooms.some((r) => r.roomId === currentRoomId)) {
    return null;
  }
  const states = rooms.map((r) => signalOf(r.session, myIdentity));
  const overall: SignalState = states.includes("tx") ? "tx" : states.includes("rx") ? "rx" : "off";
  return (
    <View accessibilityLabel="音声中のルーム" className="border-t border-border bg-surface pb-safe-or-3">
      <View className="w-full max-w-3xl gap-1 self-center px-4 pt-2">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          className="h-10 flex-row items-center gap-2"
          onPress={() => setOpen(!open)}
        >
          <Icon icon={Headphones} />
          <Text className="text-sm font-bold">音声中</Text>
          <Text className="text-sm text-fg-muted">{rooms.length}ルーム</Text>
          {!open && <SignalLamp state={overall} />}
          <Text className="min-w-0 flex-1 text-sm text-fg-muted" numberOfLines={1}>
            {open ? "" : rooms.map((r) => r.roomName).join("、")}
          </Text>
          <View className={cx(open && "rotate-180")}>
            <Icon icon={ChevronDown} color="fg-muted" />
          </View>
        </Pressable>
        {open && (
          <ScrollView className="max-h-40">
            {rooms.map((r, i) => (
              <AudioRoomRow key={r.roomId} hub={hub} room={r} signal={states[i] ?? "off"} myIdentity={myIdentity} />
            ))}
          </ScrollView>
        )}
        <MainPtt hub={hub} className="mt-1" />
      </View>
    </View>
  );
}

function AudioRoomRow({
  hub,
  room,
  signal,
  myIdentity,
}: {
  hub: RoomHub;
  room: RoomConnection;
  signal: SignalState;
  myIdentity: string;
}) {
  const { session } = room;
  let status = (
    <Text className="text-sm text-fg-muted" numberOfLines={1}>
      {session.connected ? "待機中" : "接続中…"}
    </Text>
  );
  if (signal === "tx") {
    status = (
      <Text className="text-sm font-bold text-live" numberOfLines={1}>
        送話中
      </Text>
    );
  } else if (signal === "rx") {
    const receiving = receivingCaption(session, myIdentity);
    status = (
      <Text className="text-sm font-bold text-rx-fg" numberOfLines={1}>
        {receiving ? session.displayName(receiving.speakerIdentity) : ""}
      </Text>
    );
  }
  return (
    <View className="h-12 flex-row items-center gap-2">
      <SignalLamp state={signal} />
      <Link href={{ pathname: "/rooms/[roomId]", params: { roomId: room.roomId } }} asChild>
        <Pressable accessibilityRole="link" className="max-w-[45%] min-w-0">
          <Text className="text-sm font-bold underline" numberOfLines={1}>
            {room.roomName}
          </Text>
        </Pressable>
      </Link>
      <View className="min-w-0 flex-1">{status}</View>
      {/* このルームだけに話す。押している間だけ */}
      <Button
        size="sm"
        disabled={!session.connected}
        accessibilityLabel={`${room.roomName} だけに話す`}
        accessibilityHint="押している間、このルームだけに声が届きます"
        onPressIn={() => pressOne(session, true)}
        onPressOut={() => pressOne(session, false)}
      >
        <Icon icon={Mic} />
        ここだけ
      </Button>
      <Button
        icon
        size="sm"
        variant="ghost"
        accessibilityLabel={`${room.roomName} の音声を切る`}
        onPress={() => void hub.setAudio(room.roomId, room.roomName, false)}
      >
        <Icon icon={PhoneOff} />
      </Button>
    </View>
  );
}
