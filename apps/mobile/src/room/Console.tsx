// 画面の下の操作の台。上から、いまの通話の表示灯、送信中のもの、テキスト入力、PTT のキー
import { type Language, outgoingTextLabel, type RoomSession } from "@voice-intercom/client-core";
import { captionTranslation, receivingCaption, useRoomHub } from "@voice-intercom/client-react";
import { Badge, Button, cx, Icon, KeyButton, SignalLamp, type SignalState, Text, Textarea } from "@voice-intercom/ui-native";
import { Headphones, PhoneOff, SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { MainPtt } from "./MainPtt.tsx";

export function Console({
  session,
  myIdentity,
  myLanguage,
  onAudio,
}: {
  session: RoomSession;
  myIdentity: string;
  myLanguage: Language;
  onAudio: (enabled: boolean) => void;
}) {
  return (
    <View className="border-t border-border bg-surface pb-safe-or-4">
      <View className="w-full max-w-3xl gap-3 self-center px-4 pt-3">
        {session.audio && <OnAir session={session} myIdentity={myIdentity} myLanguage={myLanguage} />}
        <OutgoingTexts session={session} />
        <Controls session={session} />
        <AudioControls session={session} onAudio={onAudio} />
      </View>
    </View>
  );
}

// 送ったテキストのうち、まだ結果を出しておくもの(送信中、届いた、断られた、失敗した)
function OutgoingTexts({ session }: { session: RoomSession }) {
  const items = session.textSender.items
    .map((t) => ({ t, label: outgoingTextLabel(t) }))
    .filter((x) => x.label !== undefined)
    .slice(-5);
  if (items.length === 0) {
    return null;
  }
  return (
    <View className="gap-1">
      {items.map(({ t, label }) => (
        <View key={t.messageId} className="flex-row items-center gap-2">
          <Text className="min-w-0 shrink text-sm" numberOfLines={1}>
            {t.text}
          </Text>
          <Badge tone={t.state === "sending" || t.state === "delivered" ? "neutral" : "danger"}>{label}</Badge>
        </View>
      ))}
    </View>
  );
}

// テキスト入力。音声をつないでいなくても使える。改行はキーボードの改行で入れ、送信のボタンで送る
// (画像・動画・ファイルを送るのは、端末のファイルの読み方を作ってから足す)
function Controls({ session }: { session: RoomSession }) {
  const [text, setText] = useState("");
  const disabled = !session.connected;
  const submit = () => {
    if (session.textSender.submit(text)) {
      setText("");
    }
  };
  return (
    <View className="flex-row items-end gap-2">
      <Textarea
        className="max-h-40 flex-1"
        value={text}
        onChangeText={setText}
        placeholder="テキストを送る"
        accessibilityLabel="テキスト"
        editable={!disabled}
      />
      <Button icon accessibilityLabel="送信" disabled={disabled || text.trim() === ""} onPress={submit}>
        <Icon icon={SendHorizontal} />
      </Button>
    </View>
  );
}

// 音声をつないでいなければ「音声をつなぐ」、つないでいれば PTT(音声をつないだ全部のルームに届く)と「音声を切る」。
// PTT の場所に置き、状態が替わっても下の段が動かないようにする
function AudioControls({ session, onAudio }: { session: RoomSession; onAudio: (enabled: boolean) => void }) {
  const hub = useRoomHub();
  if (!session.audio) {
    return (
      <KeyButton
        icon={<Icon icon={Headphones} size={20} />}
        detail="マイクとスピーカーを使います"
        disabled={!session.connected || session.switchingAudio}
        onPress={() => onAudio(true)}
      >
        {session.switchingAudio ? "つないでいます…" : "音声をつなぐ"}
      </KeyButton>
    );
  }
  return (
    <View className="flex-row items-stretch gap-2">
      <MainPtt hub={hub} className="flex-1" />
      <Button className="h-auto" accessibilityLabel="音声を切る" accessibilityHint="マイクとスピーカーを使うのをやめます" onPress={() => onAudio(false)}>
        <Icon icon={PhoneOff} />
      </Button>
    </View>
  );
}

// いま声が流れているか。自分が送っていれば TX(赤)、ほかの人の確定していない字幕が流れていれば RX(緑)、
// どちらでもなければ消灯。高さを変えず、灯りが替わるだけにする(下のキーが動かないように)
function OnAir({ session, myIdentity, myLanguage }: { session: RoomSession; myIdentity: string; myLanguage: Language }) {
  const hub = useRoomHub();
  const receiving = receivingCaption(session, myIdentity);
  const audioRooms = hub.audioRooms.length;

  let signal: SignalState = "off";
  let label = "待機中";
  let detail = <Text className="text-sm text-fg-muted">話している人はいません</Text>;
  let rowClass = "bg-surface-muted";
  if (session.talking) {
    signal = "tx";
    label = "送話中";
    detail = (
      <Text className="text-sm" numberOfLines={1}>
        {audioRooms > 1 ? `音声中の${audioRooms}ルームに届いています` : "ルームの全員に届いています"}
      </Text>
    );
  } else if (receiving) {
    const translation = captionTranslation(receiving, myLanguage);
    signal = "rx";
    label = "受信中";
    detail = (
      <Text className="text-sm" numberOfLines={1}>
        <Text className="font-bold">{session.displayName(receiving.speakerIdentity)}</Text>{" "}
        <Text className="text-fg-muted">{(translation ?? receiving.original)?.text}</Text>
      </Text>
    );
    rowClass = "bg-rx-soft";
  }

  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      className={cx("h-10 flex-row items-center gap-3 rounded-md px-3", rowClass)}
    >
      <SignalLamp state={signal} />
      <Text
        className={cx("text-sm font-bold", session.talking ? "text-live" : receiving ? "text-rx-fg" : "text-fg-muted")}
      >
        {label}
      </Text>
      <View className="min-w-0 flex-1">{detail}</View>
    </View>
  );
}
