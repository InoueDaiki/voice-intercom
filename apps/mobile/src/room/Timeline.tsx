// 履歴と、入室してから届いたものを1本にしたタイムライン。新しいものが下に来る。
// 逆さの一覧(inverted)にして、開いたときと新しいものが届いたときに下端を見せ、上端に近づいたら古いほうを読み足す
import {
  DELETED_TEXT_LABEL,
  deletedLabel,
  deletionWhat,
  type Language,
  type RoomSession,
  type TimelineEntry,
  type TimelineEvent,
} from "@voice-intercom/client-core";
import {
  captionLanguageLabel,
  captionTranslation,
  type CaptionEntry,
  continuesPrevious,
  type DeleteEntry,
  formatBytes,
  formatDuration,
  formatTime,
  useDeleteEntry,
} from "@voice-intercom/client-react";
import { Button, ConfirmDialog, cx, Icon, Text } from "@voice-intercom/ui-native";
import { Image as ExpoImage } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { FileText, Image, Keyboard, Mic, Play } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { withUniwind } from "uniwind";

const StyledImage = withUniwind(ExpoImage);

export function Timeline({
  session,
  myLanguage,
  readOnly = false,
}: {
  session: RoomSession;
  myLanguage: Language;
  readOnly?: boolean;
}) {
  const entries = session.entries;
  const timeline = session.timeline;

  const loadOlder = () => {
    if (timeline.loadingOlder || !timeline.hasOlder || !timeline.loaded) {
      return;
    }
    void session.loadOlder();
  };

  const status = (
    <View className="gap-2 py-2">
      {timeline.error && (
        <View className="flex-row flex-wrap items-center justify-center gap-2">
          <Text className="text-center text-sm text-danger-fg">{timeline.error}</Text>
          <Button variant="link" textClassName="text-sm" onPress={() => void timeline.syncLatest()}>
            読み直す
          </Button>
        </View>
      )}
      <Text className="text-center text-xs text-fg-muted">
        {!timeline.loaded || timeline.loadingOlder
          ? "読み込み中…"
          : timeline.hasOlder
            ? "上へ戻ると、古いものを読み込みます"
            : "これより前はありません"}
      </Text>
    </View>
  );

  // 逆さの一覧では、空のときの表示も逆さになるので、一覧を使わずに出す
  if (timeline.loaded && entries.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-1 px-6">
        {timeline.error && status}
        <Text className="text-center text-fg-muted">{readOnly ? "履歴はありません。" : "まだ誰も話していません。"}</Text>
        {!readOnly && (
          <Text className="text-center text-fg-muted">
            {session.audio
              ? "「押して話す」を押している間、声がルームの全員に届きます。"
              : "テキストはこのまま送れます。声で話すときは「音声をつなぐ」を押します。"}
          </Text>
        )}
      </View>
    );
  }

  const reversed = [...entries].reverse();
  return (
    <FlatList
      inverted
      className="flex-1"
      contentContainerClassName="w-full max-w-3xl self-center px-4 py-4"
      data={reversed}
      keyExtractor={(e) => e.key}
      // 逆さなので、Footer が上端
      ListFooterComponent={status}
      onEndReached={loadOlder}
      onEndReachedThreshold={0.5}
      keyboardShouldPersistTaps="handled"
      // タイムラインを動かしたらキーボードを閉じる
      keyboardDismissMode="on-drag"
      renderItem={({ item, index }) => {
        const continued = continuesPrevious(reversed[index + 1], item);
        return item.type === "caption" ? (
          <CaptionItem session={session} entry={item} myLanguage={myLanguage} continued={continued} />
        ) : (
          <MediaItem session={session} entry={item} continued={continued} />
        );
      }}
    />
  );
}

// タイムラインの1行。続きの行は名前と時刻を省く
function FeedRow({ head, continued, children }: { head: ReactNode; continued: boolean; children: ReactNode }) {
  return (
    <View className={cx("gap-1", continued ? "pt-2.5" : "mt-3 border-t border-border pt-3")}>
      {!continued && head}
      {children}
    </View>
  );
}

function FeedHead({
  name,
  at,
  icon,
  children,
  remove,
}: {
  name: string;
  at: Date;
  icon: ReactNode;
  children?: ReactNode;
  remove: DeleteEntry;
}) {
  return (
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
      <Text className="text-sm font-bold">{name}</Text>
      {icon}
      <Text className="text-xs text-fg-muted">{formatTime(at)}</Text>
      {children}
      {remove.can && (
        <Button
          variant="link"
          className="ml-auto"
          textClassName="text-xs text-fg-muted"
          disabled={remove.deleting}
          onPress={remove.ask}
        >
          削除
        </Button>
      )}
      <ConfirmDialog
        open={remove.confirming}
        tone="danger"
        title={`この${remove.what}を削除しますか?`}
        description={`ルームの全員の画面と履歴から消え、「削除された${remove.what}」と出ます。元に戻せません。`}
        confirmLabel="削除する"
        onConfirm={() => void remove.run()}
        onCancel={remove.cancel}
      />
    </View>
  );
}

// 音声の発話とテキスト入力。訳があれば訳を大きく、原文を小さく添える(読むのは訳で、原文は確かめるため)
function CaptionItem({
  session,
  entry,
  myLanguage,
  continued,
}: {
  session: RoomSession;
  entry: CaptionEntry;
  myLanguage: Language;
  continued: boolean;
}) {
  const remove = useDeleteEntry(session, entry, "テキスト");
  const translation = captionTranslation(entry, myLanguage);
  const language = captionLanguageLabel(entry);

  return (
    <FeedRow
      continued={continued}
      head={
        <FeedHead
          name={session.displayName(entry.speakerIdentity)}
          at={entry.at}
          remove={remove}
          icon={
            entry.isText ? (
              <Icon icon={Keyboard} size={14} color="fg-muted" accessibilityLabel="テキスト" />
            ) : (
              <Icon icon={Mic} size={14} color="fg-muted" accessibilityLabel="音声" />
            )
          }
        >
          {language && <Text className="text-xs text-fg-muted">{language}</Text>}
        </FeedHead>
      }
    >
      {entry.deleted ? (
        <Text className={deletedTextClass}>{DELETED_TEXT_LABEL}</Text>
      ) : (
        <>
          {/* 確定する前の字幕は薄く出す */}
          {translation && (
            <Text selectable className={cx("text-lg leading-snug font-medium", !translation.isFinal && "opacity-55")}>
              {translation.text}
            </Text>
          )}
          {entry.original && (
            <Text
              selectable
              className={cx(
                translation ? "text-sm text-fg-muted" : "text-lg leading-snug font-medium",
                !entry.original.isFinal && "opacity-55",
              )}
            >
              {entry.original.text || <Text className="text-fg-muted">(聞き取れませんでした)</Text>}
            </Text>
          )}
        </>
      )}
      {remove.error && <Text className="text-sm text-danger-fg">{remove.error}</Text>}
    </FeedRow>
  );
}

const deletedTextClass = "text-sm text-fg-muted italic";

// 画像・動画・ファイル
function MediaItem({
  session,
  entry,
  continued,
}: {
  session: RoomSession;
  entry: Extract<TimelineEntry, { type: "media" }>;
  continued: boolean;
}) {
  const event = entry.event;
  const remove = useDeleteEntry(session, entry, deletionWhat(event));
  return (
    <FeedRow
      continued={continued}
      head={
        <FeedHead
          name={session.displayName(event.sender_id)}
          at={entry.at}
          remove={remove}
          icon={<Icon icon={Image} size={14} color="fg-muted" accessibilityLabel="画像・動画・ファイル" />}
        />
      }
    >
      <MediaBody event={event} />
      {remove.error && <Text className="text-sm text-danger-fg">{remove.error}</Text>}
    </FeedRow>
  );
}

const mediaClass = "max-h-72 w-full max-w-80 rounded-md border border-border";

// 画像と動画は縮小した絵だけを出し、押すとアプリの中のブラウザで元のものを開く(動画の再生もブラウザ)
function MediaBody({ event }: { event: TimelineEvent }) {
  const [failed, setFailed] = useState(false);
  const media = event.media;
  if (event.deleted || !media) {
    return <Text className={deletedTextClass}>{deletedLabel(event)}</Text>;
  }
  // アプリの中のブラウザで開く(Safari に移るとアプリが裏に回り、音声が聞こえなくなる)
  const open = () => void WebBrowser.openBrowserAsync(media.url);
  if (media.media_type === "file" || failed || (media.media_type === "video" && !media.thumbnail_url)) {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={open}
        className="max-w-full flex-row items-center gap-2 self-start rounded-md border border-border bg-surface px-3 py-2 active:bg-surface-muted"
      >
        <Icon icon={media.media_type === "video" ? Play : FileText} color="fg-muted" />
        <Text className="shrink text-sm underline">
          {media.file_name ?? (media.media_type === "file" ? "ファイル" : media.media_type === "video" ? "動画" : "ダウンロード")}
        </Text>
        <Text className="text-sm text-fg-muted">{formatBytes(media.size_bytes)}</Text>
      </Pressable>
    );
  }
  // 縦横比の枠を先に取り、読み終えても周りがずれないようにする
  const aspectRatio = media.width && media.height ? media.width / media.height : 4 / 3;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={media.media_type === "video" ? "送られた動画を開く" : "送られた画像を開く"}
      onPress={open}
      className="self-start"
    >
      <StyledImage
        className={mediaClass}
        style={{ aspectRatio }}
        source={{ uri: media.thumbnail_url ?? media.url }}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
      {media.media_type === "video" && (
        <View className="absolute inset-0 items-center justify-center">
          <View className="size-12 items-center justify-center rounded-full bg-overlay">
            <Icon icon={Play} size={24} color="on-overlay" />
          </View>
        </View>
      )}
      {media.media_type === "video" && media.duration_ms != null && (
        <View className="absolute top-1.5 right-1.5 rounded-sm bg-overlay px-1.5">
          <Text className="text-xs text-on-overlay">{formatDuration(media.duration_ms)}</Text>
        </View>
      )}
    </Pressable>
  );
}
