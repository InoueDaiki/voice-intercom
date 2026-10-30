// 画面の下の操作の台。上から、いまの通話の表示灯、送信中のもの、テキスト入力、PTT のキー
import { type Language, type MediaUploader, outgoingTextLabel, type RoomSession } from "@voice-intercom/client-core";
import { captionTranslation, outgoingMediaLabel, receivingCaption, useRoomHub } from "@voice-intercom/client-react";
import { Badge, Button, cx, Icon, KeyButton, SignalLamp, type SignalState, Text, Textarea } from "@voice-intercom/ui-native";
import { Headphones, Paperclip, PhoneOff, SendHorizontal } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import type { LocalFile, PickedMedia } from "../mobileMedia.ts";
import { MainPtt } from "./MainPtt.tsx";
import { askMedia } from "./pickMedia.ts";

export type Uploader = MediaUploader<PickedMedia, LocalFile>;

export function Console({
  session,
  uploader,
  myIdentity,
  myLanguage,
  onAudio,
}: {
  session: RoomSession;
  uploader: Uploader | undefined;
  myIdentity: string;
  myLanguage: Language;
  onAudio: (enabled: boolean) => void;
}) {
  const hub = useRoomHub();
  // ほかのルームの音声をつないでいれば、下に音声中の帯が出て、安全な領域は帯が避ける
  const dockBelow = !session.audio && hub.audioRooms.length > 0;
  return (
    <View className={cx("border-t border-border bg-surface", dockBelow ? "pb-4" : "pb-safe-or-4")}>
      <View className="w-full max-w-3xl gap-3 self-center px-4 pt-3">
        {session.audio && <OnAir session={session} myIdentity={myIdentity} myLanguage={myLanguage} />}
        <OutgoingTexts session={session} />
        {uploader && <OutgoingMediaList uploader={uploader} />}
        <Controls session={session} uploader={uploader} />
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

// 送信中の画像・動画・ファイル(送った本人にだけ出す)
function OutgoingMediaList({ uploader }: { uploader: Uploader }) {
  const items = uploader.items;
  if (items.length === 0) {
    return null;
  }
  return (
    <View className="gap-2">
      {items.map((item) => (
        <View key={item.localId} className="gap-1">
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="min-w-0 shrink text-sm" numberOfLines={1}>
              {item.source.name}
            </Text>
            <Badge tone={item.state === "failed" ? "danger" : "neutral"}>{outgoingMediaLabel(item)}</Badge>
            {item.cancellable && (
              <Button variant="link" textClassName="text-xs" onPress={() => uploader.cancel(item)}>
                取りやめる
              </Button>
            )}
            {item.state === "failed" && item.retryable && (
              <Button variant="link" textClassName="text-xs" onPress={() => uploader.retry(item)}>
                やり直す
              </Button>
            )}
            {item.state === "failed" && (
              <Button variant="link" textClassName="text-xs" onPress={() => uploader.dismiss(item)}>
                取り消す
              </Button>
            )}
          </View>
          {item.state !== "failed" && item.progress !== undefined && (
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.floor(item.progress * 100) }}
              className="h-1 overflow-hidden rounded-full bg-surface-strong"
            >
              <View className="h-full bg-fg" style={{ width: `${Math.floor(item.progress * 100)}%` }} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

// テキスト入力と、画像・動画・ファイルの添付。音声をつないでいなくても使える。
// 改行はキーボードの改行で入れ、送信のボタンで送る
function Controls({ session, uploader }: { session: RoomSession; uploader: Uploader | undefined }) {
  const [text, setText] = useState("");
  const disabled = !session.connected;
  const submit = () => {
    if (session.textSender.submit(text)) {
      setText("");
    }
  };
  return (
    <View className="flex-row items-end gap-2">
      <Button
        icon
        accessibilityLabel="画像・動画・ファイルを送る"
        disabled={disabled || !uploader}
        onPress={() =>
          askMedia((media) => {
            for (const m of media) {
              uploader?.submit(m);
            }
          })
        }
      >
        <Icon icon={Paperclip} />
      </Button>
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
