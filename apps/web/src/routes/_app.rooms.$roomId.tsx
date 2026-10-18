import {
  ApiError,
  apiMediaBackend,
  DELETED_TEXT_LABEL,
  deletedLabel,
  deletionWhat,
  LANGUAGE_LABELS,
  type Language,
  MediaUploader,
  NotSavedYetError,
  type OutgoingMedia,
  outgoingTextLabel,
  RoomSession,
  type TimelineEntry,
  type TimelineEvent,
  type User,
} from "@voice-intercom/client-core";
import { Alert, Badge, Button, ConfirmDialog, cx, PttButton, Textarea } from "@voice-intercom/ui-web";
import { ChevronLeft, FileText, Image, Keyboard, Mic, Paperclip, SendHorizontal, Users } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAuth } from "react-oidc-context";
import { Link, useParams } from "react-router";

import { api } from "../api.ts";
import { formatBytes, formatDuration, formatTime } from "../format.ts";
import { errorMessage, useMe, useRoom } from "../queries.ts";
import { webRoomPlatform } from "../roomPlatform.ts";
import { useObservable } from "../useObservable.ts";
import { webMediaPreparer, xhrSignedPut } from "../webMedia.ts";

// 履歴の1ページの件数
const PAGE_LIMIT = 50;

// 上端からこれより近づいたら、古いほうを読み足す(ピクセル)
const LOAD_OLDER_THRESHOLD = 200;

// 同じ人の続けての発言を、名前を出さずにまとめる間隔(ミリ秒)
const GROUP_WINDOW_MS = 60_000;

type Uploader = MediaUploader<File, Blob>;

export default function RoomPage() {
  const roomId = useParams().roomId ?? "";
  const room = useRoom(roomId);
  const me = useMe();
  const { user } = useAuth();
  const myIdentity = user?.profile.sub;

  if (room.isPending || me.isPending) {
    return <p className={roomMessageClass}>読み込み中…</p>;
  }
  if (room.isError) {
    return (
      <section className={cx(roomMessageClass, "grid gap-3")}>
        <BackLink />
        <Alert tone="danger">ルームを開けません: {errorMessage(room.error)}</Alert>
      </section>
    );
  }
  if (!me.data || !myIdentity) {
    return (
      <div className={roomMessageClass}>
        <Alert tone="danger">プロフィールが登録されていません。</Alert>
      </div>
    );
  }
  return <RoomScreen key={roomId} roomId={roomId} roomName={room.data.name} me={me.data} myIdentity={myIdentity} />;
}

const roomMessageClass = "mx-auto max-w-3xl px-4 py-6 text-fg-muted";

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-0.5 text-sm text-fg-muted no-underline hover:text-fg">
      <ChevronLeft aria-hidden="true" className="size-4" />
      ルーム
    </Link>
  );
}

// 入室している間の画面。開いたら入室し、閉じたら退室する
function RoomScreen({ roomId, roomName, me, myIdentity }: { roomId: string; roomName: string; me: User; myIdentity: string }) {
  const [session, setSession] = useState<RoomSession>();
  const [uploader, setUploader] = useState<Uploader>();
  const [joinError, setJoinError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  useObservable(session);
  useObservable(uploader);

  useEffect(() => {
    const s = new RoomSession({
      myIdentity,
      myLanguage: me.language,
      roomName,
      platform: webRoomPlatform,
      fetchTimelinePage: (before) => api.listTimeline(roomId, { limit: PAGE_LIMIT, before }),
      fetchTimelineEvent: (eventId) => api.getTimelineEvent(roomId, eventId),
      deleteTimelineEvent: (eventId) => api.deleteTimelineEvent(roomId, eventId),
    });
    const u: Uploader = new MediaUploader({
      roomId,
      backend: apiMediaBackend(api, xhrSignedPut),
      preparer: webMediaPreparer,
      // 送ったものは、配信を待たずにすぐタイムラインに出す
      onCompleted: (event) => s.addMedia([event]),
    });
    setSession(s);
    setUploader(u);
    setJoinError(undefined);
    let cancelled = false;
    (async () => {
      const token = await api.createLiveKitToken(roomId);
      if (!cancelled) {
        await s.connect(token.server_url, token.participant_token);
      }
    })().catch((e: unknown) => {
      if (cancelled) {
        return;
      }
      setJoinError(
        e instanceof ApiError && e.status === 409
          ? "プロフィールが登録されていないので入室できません。"
          : `入室できませんでした: ${errorMessage(e)}`,
      );
    });
    return () => {
      cancelled = true;
      u.dispose();
      s.dispose();
    };
  }, [roomId, roomName, me.language, myIdentity]);

  const sendFiles = (files: Iterable<File>) => {
    for (const f of files) {
      uploader?.submit(f);
    }
  };

  // ファイルをルームの画面に落としても送れる
  const onDragOver = (e: DragEvent) => {
    if (session?.connected && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragging(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    setDragging(false);
    if (session?.connected && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      sendFiles(e.dataTransfer.files);
    }
  };

  return (
    <section
      className={cx(
        "flex h-full flex-col",
        // ファイルを落とせることを示す
        dragging && "outline-2 -outline-offset-4 outline-fg outline-dashed",
      )}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <header className="border-b border-border">
        <div className={cx(columnClass, "grid gap-1 py-3")}>
          <BackLink />
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1>{roomName}</h1>
            {session && <RoomStatus session={session} />}
          </div>
        </div>
      </header>
      {(joinError || session?.error || session?.warning || (session && !session.canPlaybackAudio)) && (
        <div className={cx(columnClass, "grid gap-2 pt-3")}>
          {joinError && <Alert tone="danger">{joinError}</Alert>}
          {session?.error && !joinError && <Alert tone="danger">{session.error}</Alert>}
          {session?.warning && <p className="text-sm text-fg-muted">{session.warning}</p>}
          {session && !session.canPlaybackAudio && (
            <Alert
              tone="warning"
              action={
                <Button size="sm" variant="primary" onClick={() => void session.startAudio()}>
                  音を出す
                </Button>
              }
            >
              ブラウザが音の再生を止めています。
            </Alert>
          )}
        </div>
      )}
      {session && <Timeline session={session} myLanguage={me.language} />}
      {session && (
        <Console session={session} uploader={uploader} myIdentity={myIdentity} myLanguage={me.language} onFiles={sendFiles} />
      )}
    </section>
  );
}

// 画面の中身の列。タイムラインと操作の台で、同じ幅と余白にそろえる
const columnClass = "mx-auto w-full max-w-3xl px-4 sm:px-6";

function RoomStatus({ session }: { session: RoomSession }) {
  if (!session.connected) {
    return <Badge tone={session.error ? "danger" : "neutral"}>{session.error ? "切断" : "入室中…"}</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
      <span className="inline-flex items-center gap-1">
        <Users aria-hidden="true" className="size-4" />
        {session.participantCount}人
      </span>
      {session.agentPresent ? (
        <span>翻訳あり</span>
      ) : (
        // dev では使っていない間 Agent を止めているので、起動を待つことがある(設計メモの「Agent の scale to zero」)
        <span title="翻訳の Agent の起動に1〜2分かかることがあります">翻訳の準備中(1〜2分かかることがあります)</span>
      )}
    </span>
  );
}

// 履歴と、入室してから届いたものを1本にしたタイムライン。新しいものが下に来る。
// 下端を見ていれば新しいものを追いかけ、上端に近づいたら古いほうを読み足す
function Timeline({ session, myLanguage }: { session: RoomSession; myLanguage: Language }) {
  const entries = session.entries;
  const timeline = session.timeline;
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // 読み足す前の高さ。読み足した後に、見ていた位置がずれないよう同じだけ下げる
  const heightBeforeOlder = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    if (heightBeforeOlder.current !== undefined && !timeline.loadingOlder) {
      el.scrollTop += el.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = undefined;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  const loadOlder = () => {
    const el = listRef.current;
    if (!el || timeline.loadingOlder || !timeline.hasOlder || !timeline.loaded) {
      return;
    }
    heightBeforeOlder.current = el.scrollHeight;
    void session.loadOlder();
  };

  // 読み込んだ分が少なく、スクロールできないまま上端にいるなら、続けて読み足す
  useEffect(() => {
    const el = listRef.current;
    if (el && timeline.loaded && el.scrollHeight <= el.clientHeight) {
      loadOlder();
    }
  });

  return (
    <div
      className="min-h-32 flex-1 overflow-y-auto"
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (el.scrollTop < LOAD_OLDER_THRESHOLD) {
          loadOlder();
        }
      }}
    >
      <ol className={cx(columnClass, "flex min-h-full flex-col py-4")}>
        <li className="py-2 text-center text-xs text-fg-muted">
          {!timeline.loaded || timeline.loadingOlder
            ? "読み込み中…"
            : timeline.hasOlder
              ? "上へ戻ると、古いものを読み込みます"
              : "これより前はありません"}
        </li>
        {timeline.error && (
          <li className="flex flex-wrap items-center justify-center gap-2 py-2 text-center text-sm text-danger-fg">
            {timeline.error}
            <Button variant="link" onClick={() => void timeline.syncLatest()}>
              読み直す
            </Button>
          </li>
        )}
        {timeline.loaded && entries.length === 0 && (
          <li className="my-auto py-12 text-center text-fg-muted">
            まだ誰も話していません。
            <br />
            下のキーを押している間、声がルームの全員に届きます。
          </li>
        )}
        {entries.map((entry, i) => {
          const continued = continuesPrevious(entries[i - 1], entry);
          return entry.type === "caption" ? (
            <CaptionItem key={entry.key} session={session} entry={entry} myLanguage={myLanguage} continued={continued} />
          ) : (
            <MediaItem key={entry.key} session={session} entry={entry} continued={continued} />
          );
        })}
      </ol>
    </div>
  );
}

function senderOf(entry: TimelineEntry): string {
  return entry.type === "caption" ? entry.speakerIdentity : entry.event.sender_id;
}

// 前の行と同じ人の、間を置かない続きなら、名前と時刻を省いて1つの発言のように見せる
function continuesPrevious(prev: TimelineEntry | undefined, entry: TimelineEntry): boolean {
  return (
    prev !== undefined &&
    senderOf(prev) === senderOf(entry) &&
    entry.at.getTime() - prev.at.getTime() < GROUP_WINDOW_MS
  );
}

// 消す操作と確認。ask で確認のダイアログを開き、確定したら消す。失敗したら理由を返す
function useDelete(session: RoomSession, entry: TimelineEntry, what: string) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const run = async () => {
    setConfirming(false);
    setDeleting(true);
    setError(undefined);
    try {
      await session.deleteEntry(entry);
    } catch (e) {
      setError(e instanceof NotSavedYetError ? "まだ履歴に保存されていません。少し待ってからやり直してください。" : errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };
  return {
    what,
    confirming,
    ask: () => setConfirming(true),
    cancel: () => setConfirming(false),
    deleting,
    error,
    run,
    can: session.canDeleteEntry(entry),
  };
}

// タイムラインの1行。左に時刻、右に話した人と中身を置く(議事録のように、時刻の列で追える)。
// 続きの行は名前と時刻を省く
function FeedRow({
  at,
  head,
  continued,
  children,
}: {
  at: Date;
  head: ReactNode;
  continued: boolean;
  children: ReactNode;
}) {
  return (
    <li className={cx("group grid gap-x-4 sm:grid-cols-[4.5rem_1fr]", continued ? "pt-2.5" : "mt-3 border-t border-border pt-3")}>
      <time
        dateTime={at.toISOString()}
        className={cx("hidden pt-0.5 text-right text-xs text-fg-muted sm:block", continued && "sm:invisible")}
      >
        {formatTime(at)}
      </time>
      <div className="grid min-w-0 gap-1">
        {!continued && head}
        {children}
      </div>
    </li>
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
  remove: ReturnType<typeof useDelete>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-bold">{name}</span>
      <span className="text-fg-muted">{icon}</span>
      {/* 幅の狭い画面では、時刻を名前の横に出す */}
      <span className="text-xs text-fg-muted sm:hidden">{formatTime(at)}</span>
      {children}
      {remove.can && (
        <Button
          variant="link"
          className="ml-auto text-xs text-fg-muted sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          disabled={remove.deleting}
          onClick={remove.ask}
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
    </div>
  );
}

const kindIconClass = "size-3.5";

// 音声の発話とテキスト入力。履歴の行も、届いたばかりの字幕も同じ形で出す。
// 訳があれば訳を大きく、原文を小さく添える(読むのは訳で、原文は確かめるため)
function CaptionItem({
  session,
  entry,
  myLanguage,
  continued,
}: {
  session: RoomSession;
  entry: Extract<TimelineEntry, { type: "caption" }>;
  myLanguage: Language;
  continued: boolean;
}) {
  const remove = useDelete(session, entry, "テキスト");
  // 話者と同じ言語なら訳は無い(Agent が作らない)
  const translation = entry.originalLanguage === myLanguage ? undefined : entry.translations.get(myLanguage);
  const language = entry.originalLanguage
    ? (LANGUAGE_LABELS[entry.originalLanguage as Language] ?? entry.originalLanguage)
    : undefined;

  return (
    <FeedRow
      at={entry.at}
      continued={continued}
      head={
        <FeedHead
          name={session.displayName(entry.speakerIdentity)}
          at={entry.at}
          remove={remove}
          icon={
            entry.isText ? (
              <Keyboard aria-label="テキスト" className={kindIconClass} />
            ) : (
              <Mic aria-label="音声" className={kindIconClass} />
            )
          }
        >
          {language && <span className="text-xs text-fg-muted">{language}</span>}
        </FeedHead>
      }
    >
      {entry.deleted ? (
        <p className={deletedTextClass}>{DELETED_TEXT_LABEL}</p>
      ) : (
        <>
          {/* 確定する前の字幕は薄く出す */}
          {translation && (
            <p className={cx("text-lg leading-snug font-medium whitespace-pre-wrap", !translation.isFinal && "opacity-55")}>
              {translation.text}
            </p>
          )}
          {entry.original && (
            <p
              className={cx(
                "whitespace-pre-wrap",
                translation ? "text-sm text-fg-muted" : "text-lg leading-snug font-medium",
                !entry.original.isFinal && "opacity-55",
              )}
            >
              {entry.original.text || <span className="text-fg-muted">(聞き取れませんでした)</span>}
            </p>
          )}
        </>
      )}
      {remove.error && <p className="text-sm text-danger-fg">{remove.error}</p>}
    </FeedRow>
  );
}

const deletedTextClass = "text-sm text-fg-muted italic";
const mediaClass = "block max-h-72 max-w-full rounded-md border border-border object-cover sm:max-w-80";

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
  const remove = useDelete(session, entry, deletionWhat(event));

  return (
    <FeedRow
      at={entry.at}
      continued={continued}
      head={
        <FeedHead
          name={session.displayName(event.sender_id)}
          at={entry.at}
          remove={remove}
          icon={<Image aria-label="画像・動画・ファイル" className={kindIconClass} />}
        />
      }
    >
      <MediaBody event={event} />
      {remove.error && <p className="text-sm text-danger-fg">{remove.error}</p>}
    </FeedRow>
  );
}

function MediaBody({ event }: { event: TimelineEvent }) {
  const [failed, setFailed] = useState(false);
  const media = event.media;
  if (event.deleted || !media) {
    return <p className={deletedTextClass}>{deletedLabel(event)}</p>;
  }
  if (media.media_type === "file" || failed) {
    // ファイルはダウンロードだけ(Content-Disposition: attachment で置いてある)。
    // 画像・動画を表示できなかったときも、ダウンロードのリンクにする。
    // 配信の応答にヘッダーが無くても、ルームの画面から離れないよう、新しいタブで開く
    return (
      <p className="flex w-fit max-w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm break-all">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <a href={media.url} download={media.file_name ?? true} target="_blank" rel="noreferrer">
          {media.file_name ?? (media.media_type === "file" ? "ファイル" : "ダウンロード")}
        </a>
        <span className="shrink-0 text-fg-muted">{formatBytes(media.size_bytes)}</span>
      </p>
    );
  }
  // 縦横比の枠を先に取り、読み終えても周りがずれないようにする
  const aspect = media.width && media.height ? `${media.width} / ${media.height}` : undefined;
  if (media.media_type === "video") {
    // 一覧ではサムネイル(無ければ枠)だけを読み、本体は再生してから読む
    return (
      <div className="relative w-fit">
        <video
          className={mediaClass}
          style={{ aspectRatio: aspect }}
          src={media.url}
          poster={media.thumbnail_url ?? undefined}
          controls
          preload="none"
          onError={() => setFailed(true)}
        />
        {media.duration_ms != null && (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-sm bg-overlay px-1.5 text-xs text-on-overlay">
            {formatDuration(media.duration_ms)}
          </span>
        )}
      </div>
    );
  }
  return (
    <a href={media.url} target="_blank" rel="noreferrer" className="w-fit">
      <img
        className={mediaClass}
        style={{ aspectRatio: aspect }}
        src={media.thumbnail_url ?? media.url}
        alt="送られた画像"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </a>
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
    <ul className={outgoingListClass}>
      {items.map(({ t, label }) => (
        <li key={t.messageId} className={outgoingRowClass}>
          <span className="min-w-0 truncate">{t.text}</span>
          <Badge tone={t.state === "sending" || t.state === "delivered" ? "neutral" : "danger"}>{label}</Badge>
        </li>
      ))}
    </ul>
  );
}

// 送信中の画像・動画・ファイル(送った本人にだけ出す)
function OutgoingMediaList({ uploader }: { uploader: Uploader }) {
  const items = uploader.items;
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className={outgoingListClass}>
      {items.map((item) => (
        <li key={item.localId} className={outgoingRowClass}>
          <span className="min-w-0 truncate">{item.source.name}</span>
          <Badge tone={item.state === "failed" ? "danger" : "neutral"}>{outgoingMediaLabel(item)}</Badge>
          {item.state !== "failed" && item.progress !== undefined && (
            <progress className="w-24" max={1} value={item.progress} aria-label="進み具合" />
          )}
          {item.cancellable && (
            <Button variant="link" className="text-xs" onClick={() => uploader.cancel(item)}>
              取りやめる
            </Button>
          )}
          {item.state === "failed" && item.retryable && (
            <Button variant="link" className="text-xs" onClick={() => uploader.retry(item)}>
              やり直す
            </Button>
          )}
          {item.state === "failed" && (
            <Button variant="link" className="text-xs" onClick={() => uploader.dismiss(item)}>
              取り消す
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

const outgoingListClass = "grid gap-1 text-sm";
const outgoingRowClass = "flex items-center gap-2";

function outgoingMediaLabel(item: OutgoingMedia<File, Blob>): string {
  switch (item.state) {
    case "preparing":
      // 進み具合が出るのは動画の変換(H.264 の MP4 にしている)の間だけ
      return item.progress === undefined ? "準備中" : `変換中 ${Math.floor(item.progress * 100)}%`;
    case "uploading":
      return item.progress === undefined ? "送信中" : `送信中 ${Math.floor(item.progress * 100)}%`;
    case "completing":
      return "保存中";
    case "done":
      return "送信済み";
    case "failed":
      return `送れませんでした: ${item.error ?? "理由不明"}`;
  }
}

// 画面の下の操作の台。上から、いまの通話の表示灯、送信中のもの、テキスト入力、PTT のキー
function Console({
  session,
  uploader,
  myIdentity,
  myLanguage,
  onFiles,
}: {
  session: RoomSession;
  uploader: Uploader | undefined;
  myIdentity: string;
  myLanguage: Language;
  onFiles: (files: Iterable<File>) => void;
}) {
  return (
    <div className="border-t border-border bg-surface">
      <div className={cx(columnClass, "grid gap-3 pt-3 pb-4")}>
        <OnAir session={session} myIdentity={myIdentity} myLanguage={myLanguage} />
        <OutgoingTexts session={session} />
        {uploader && <OutgoingMediaList uploader={uploader} />}
        <Controls session={session} onFiles={onFiles} />
      </div>
    </div>
  );
}

// いま声が流れているか。自分が送っていれば TX(赤)、ほかの人の確定していない字幕が流れていれば RX(緑)、
// どちらでもなければ消灯。高さを変えず、灯りが替わるだけにする(下のキーが動かないように)
function OnAir({ session, myIdentity, myLanguage }: { session: RoomSession; myIdentity: string; myLanguage: Language }) {
  const receiving = session.entries.findLast(
    (e): e is Extract<TimelineEntry, { type: "caption" }> =>
      e.type === "caption" &&
      !e.isText &&
      e.speakerIdentity !== myIdentity &&
      e.original !== undefined &&
      !e.original.isFinal,
  );

  let lampClass = "bg-border-strong";
  let label = "待機中";
  let detail: ReactNode = <span className="text-fg-muted">話している人はいません</span>;
  let rowClass = "bg-surface-muted";
  if (session.talking) {
    lampClass = "bg-live motion-safe:animate-pulse";
    label = "送話中";
    detail = "あなたの声がルームの全員に届いています";
    rowClass = "bg-surface-muted";
  } else if (receiving) {
    const translation =
      receiving.originalLanguage === myLanguage ? undefined : receiving.translations.get(myLanguage);
    lampClass = "bg-rx motion-safe:animate-pulse";
    label = "受信中";
    detail = (
      <>
        <span className="font-bold">{session.displayName(receiving.speakerIdentity)}</span>{" "}
        <span className="text-fg-muted">{(translation ?? receiving.original)?.text}</span>
      </>
    );
    rowClass = "bg-rx-soft";
  }

  return (
    <div
      className={cx("flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors", rowClass)}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-full", lampClass)} />
      <span
        className={cx(
          "shrink-0 font-bold",
          session.talking ? "text-live" : receiving ? "text-rx-fg" : "text-fg-muted",
        )}
      >
        {label}
      </span>
      <span className="min-w-0 truncate">{detail}</span>
    </div>
  );
}

// PTT、テキスト入力、ファイルの添付。PTT はボタンを押している間か、テキスト欄の外で Space を押している間
function Controls({ session, onFiles }: { session: RoomSession; onFiles: (files: Iterable<File>) => void }) {
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return el?.closest("input, textarea, select, [contenteditable]") != null;
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTyping(e)) {
        e.preventDefault();
        void session.startAudio();
        session.setPressing(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && session.pressing) {
        e.preventDefault();
        session.setPressing(false);
      }
    };
    // 押したままタブを離れたら、離したことにする(マイクを開けたままにしない)
    const release = () => {
      if (session.pressing) {
        session.setPressing(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, [session]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (session.textSender.submit(text)) {
      setText("");
    }
  };

  const onTextKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Enter で送り、Shift+Enter で改行する。変換の確定の Enter では送らない
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      onSubmit(e);
    }
  };

  const disabled = !session.connected;
  return (
    <>
      <form className="grid grid-cols-[auto_1fr_auto] items-end gap-2" onSubmit={onSubmit}>
        <Button
          className="px-3"
          title="画像・動画・ファイルを送る(10GB まで)"
          aria-label="画像・動画・ファイルを送る"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip aria-hidden="true" className="size-4" />
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <Textarea
          className="max-h-40 min-h-10 resize-none field-sizing-content"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onTextKeyDown}
          placeholder="テキストを送る"
          title="Enter で送信、Shift+Enter で改行"
          aria-label="テキスト"
          rows={1}
          disabled={disabled}
        />
        <Button type="submit" disabled={disabled || text.trim() === ""}>
          <SendHorizontal aria-hidden="true" className="size-4" />
          送信
        </Button>
      </form>
      <PttButton
        className="w-full"
        state={session.talking ? "talking" : session.pressing ? "pressing" : "idle"}
        shortcut="Space"
        disabled={disabled}
        aria-pressed={session.pressing}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          void session.startAudio();
          session.setPressing(true);
        }}
        onPointerUp={() => session.setPressing(false)}
        onPointerCancel={() => session.setPressing(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {session.talking ? "送話中" : session.pressing ? "マイクを準備中…" : "押して話す"}
      </PttButton>
    </>
  );
}
