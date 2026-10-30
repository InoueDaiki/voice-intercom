import {
  apiMediaBackend,
  DELETED_TEXT_LABEL,
  deletedLabel,
  deletionWhat,
  type Language,
  MediaUploader,
  outgoingTextLabel,
  type Room,
  type RoomConnection,
  RoomSession,
  type TimelineEntry,
  type TimelineEvent,
  type User,
} from "@voice-intercom/client-core";
import {
  captionLanguageLabel,
  captionTranslation,
  continuesPrevious,
  type DeleteEntry,
  errorMessage,
  formatBytes,
  formatDuration,
  formatTime,
  joinErrorMessage,
  outgoingMediaLabel,
  PAGE_LIMIT,
  receivingCaption,
  useDeleteEntry,
  useMe,
  useObservable,
  useRoom,
  useRoomHub,
  useRoomMutation,
} from "@voice-intercom/client-react";
import {
  Alert,
  BackIcon,
  backLinkClass,
  Badge,
  Button,
  buttonClass,
  ConfirmDialog,
  cx,
  KeyButton,
  SignalLamp,
  type SignalState,
  Textarea,
} from "@voice-intercom/ui-web";
import {
  Archive,
  FileText,
  Headphones,
  Image,
  Keyboard,
  Mic,
  Paperclip,
  PhoneOff,
  SendHorizontal,
  Settings,
  Users,
} from "lucide-react";
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
import { MainPtt } from "../AudioDock.tsx";
import { RoomKindBadge } from "../RoomKind.tsx";
import { webMediaPreparer, xhrSignedPut } from "../webMedia.ts";

// 上端からこれより近づいたら、古いほうを読み足す(ピクセル)
const LOAD_OLDER_THRESHOLD = 200;

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
  if (!room.data.member_ids.includes(myIdentity)) {
    return <JoinRoom room={room.data} />;
  }
  if (room.data.archived_at) {
    return <ArchivedRoom key={roomId} room={room.data} me={me.data} myIdentity={myIdentity} />;
  }
  return <RoomScreen key={roomId} room={room.data} me={me.data} myIdentity={myIdentity} />;
}

const roomMessageClass = "mx-auto max-w-3xl px-4 py-6 text-fg-muted";

function BackLink() {
  return (
    <Link to="/" className={backLinkClass}>
      <BackIcon />
      ルームの一覧
    </Link>
  );
}

// 画面の上の、ルームの名前と種別と設定への入り口
function RoomHeader({ room, children }: { room: Room; children?: ReactNode }) {
  return (
    <header className="border-b border-border">
      <div className={cx(columnClass, "grid gap-1 py-3")}>
        <BackLink />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="min-w-0 truncate">{room.name}</h1>
          <RoomKindBadge kind={room.kind} />
          {children}
          <Link
            to={`/rooms/${encodeURIComponent(room.room_id)}/settings`}
            className={buttonClass({ variant: "ghost", size: "sm", className: "ml-auto" })}
          >
            <Settings aria-hidden="true" className="size-4" />
            メンバーと設定
          </Link>
        </div>
      </div>
    </header>
  );
}

// メンバーでない Public のルーム(一覧から開いた、リンクを受け取った)。参加すれば入れる
function JoinRoom({ room }: { room: Room }) {
  const join = useRoomMutation(room.room_id, () => api.joinRoom(room.room_id));
  return (
    <section className={cx(roomMessageClass, "grid gap-3")}>
      <BackLink />
      <h1 className="text-fg">{room.name}</h1>
      <p>
        {room.kind === "public"
          ? `このルームにはまだ参加していません(${room.member_ids.length}人が参加しています)。`
          : "このルームのメンバーではありません。"}
      </p>
      {join.isError && <Alert tone="danger">参加できませんでした: {errorMessage(join.error)}</Alert>}
      {room.kind === "public" && !room.archived_at && (
        <div>
          <Button variant="primary" disabled={join.isPending} onClick={() => join.mutate(undefined)}>
            参加する
          </Button>
        </div>
      )}
    </section>
  );
}

// アーカイブしたルーム。履歴を読むだけで、つながない
function ArchivedRoom({ room, me, myIdentity }: { room: Room; me: User; myIdentity: string }) {
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
  }, [room.room_id, room.name, me.language, myIdentity]);
  return (
    <section className="flex h-full flex-col">
      <RoomHeader room={room} />
      {session ? <Timeline session={session} myLanguage={me.language} readOnly /> : <div className="flex-1" />}
      <div className="border-t border-border bg-surface">
        <p className={cx(columnClass, "flex items-center gap-2 py-4 text-sm text-fg-muted")}>
          <Archive aria-hidden="true" className="size-4 shrink-0" />
          アーカイブしたルームです。履歴を読めますが、話したり送ったりはできません。
        </p>
      </div>
    </section>
  );
}

// ルームの画面。開いている間はデータだけでつなぎ(タイムラインを見て、テキストと画像を送れる)、
// 「音声をつなぐ」でマイクとスピーカーも使う。音声をつないだら、画面を離れてもつないだまま(RoomHub)。
// タブを裏に回したとき・画面を消したときは RoomKeeper が受け持つ(PTT を離す、戻ったら入り直す、画面を消させない)
function RoomScreen({ room, me, myIdentity }: { room: Room; me: User; myIdentity: string }) {
  const roomId = room.room_id;
  const roomName = room.name;
  const hub = useRoomHub();
  const [connection, setConnection] = useState<RoomConnection>();
  const [uploader, setUploader] = useState<Uploader>();
  const [dragging, setDragging] = useState(false);
  const session = connection?.session;
  const keeper = connection?.keeper;
  useObservable(session);
  useObservable(keeper);
  useObservable(uploader);
  const joinError = keeper?.joinError === undefined ? undefined : joinErrorMessage(keeper.joinError);
  // 切断された後は、戻ったときに自動で入り直す。見えたまま切断されたときは、ここから入り直す
  const rejoinAction = keeper && session?.canRejoin && (
    <Button size="sm" onClick={() => void keeper.rejoin()}>
      入り直す
    </Button>
  );

  useEffect(() => {
    const c = hub.open(roomId, roomName);
    const s = c.session;
    const u: Uploader = new MediaUploader({
      roomId,
      backend: apiMediaBackend(api, xhrSignedPut),
      preparer: webMediaPreparer,
      // 送ったものは、配信を待たずにすぐタイムラインに出す
      onCompleted: (event) => s.addMedia([event]),
    });
    setConnection(c);
    setUploader(u);
    // 画面を離れたら、アップロードは取りやめる。音声をつないでいなければ切る
    return () => {
      u.dispose();
      hub.close(roomId);
    };
  }, [hub, roomId, roomName]);

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
      <RoomHeader room={room}>
        {session && <RoomStatus session={session} rejoining={keeper?.rejoining ?? false} />}
      </RoomHeader>
      {(joinError ||
        session?.error ||
        session?.warning ||
        keeper?.awayNotice ||
        (session && !session.canPlaybackAudio)) && (
        <div className={cx(columnClass, "grid gap-2 pt-3")}>
          {(joinError ?? session?.error) && (
            <Alert tone="danger" action={rejoinAction}>
              {joinError ?? session?.error}
            </Alert>
          )}
          {session?.warning && <p className="text-sm text-fg-muted">{session.warning}</p>}
          {keeper?.awayNotice && (
            // 隠れていた間の声は聞けていないかもしれない。控えめに、字幕と履歴で追えることだけを示す
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-fg-muted">
              画面を離れていた間の声は、聞こえていなかったかもしれません。字幕と履歴で追えます。
              <Button variant="link" className="text-xs" onClick={() => keeper.dismissAwayNotice()}>
                閉じる
              </Button>
            </p>
          )}
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
        <Console
          session={session}
          uploader={uploader}
          myIdentity={myIdentity}
          myLanguage={me.language}
          onFiles={sendFiles}
          onAudio={(enabled) => void hub.setAudio(roomId, roomName, enabled)}
        />
      )}
    </section>
  );
}

// 画面の中身の列。タイムラインと操作の台で、同じ幅と余白にそろえる
const columnClass = "mx-auto w-full max-w-3xl px-4 sm:px-6";

function RoomStatus({ session, rejoining }: { session: RoomSession; rejoining: boolean }) {
  if (!session.connected) {
    if (rejoining) {
      return <Badge tone="neutral">つなぎ直し中…</Badge>;
    }
    return <Badge tone={session.error ? "danger" : "neutral"}>{session.error ? "切断" : "接続中…"}</Badge>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
      {session.audio && (
        <span className="inline-flex items-center gap-1 font-medium text-fg">
          <Headphones aria-hidden="true" className="size-4" />
          音声中
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <Users aria-hidden="true" className="size-4" />
        {session.participantCount}人
      </span>
      {session.agentPresent ? (
        <span>翻訳あり</span>
      ) : (
        // dev では使っていない間 Agent を止めているので、起動を待つことがある(設計メモの「Agent の scale to zero」)
        <span title="翻訳の Agent の起動に1〜2分かかることがあります">翻訳の準備中</span>
      )}
    </span>
  );
}

// 履歴と、入室してから届いたものを1本にしたタイムライン。新しいものが下に来る。
// 下端を見ていれば新しいものを追いかけ、上端に近づいたら古いほうを読み足す
// readOnly はアーカイブしたルーム(話したり送ったりできない)
function Timeline({ session, myLanguage, readOnly = false }: { session: RoomSession; myLanguage: Language; readOnly?: boolean }) {
  const entries = session.entries;
  const timeline = session.timeline;
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
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

  // 画像の読み込みなどで、描き直さずに高さが変わったときも、下端を見ていれば追いかける
  useEffect(() => {
    const el = listRef.current;
    const content = contentRef.current;
    if (!el || !content) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current && heightBeforeOlder.current === undefined) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

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
      <ol ref={contentRef} className={cx(columnClass, "flex min-h-full flex-col py-4")}>
        {/* 何も無いときは、下の案内だけを出す */}
        {(!timeline.loaded || timeline.loadingOlder || entries.length > 0) && (
          <li className="py-2 text-center text-xs text-fg-muted">
            {!timeline.loaded || timeline.loadingOlder
              ? "読み込み中…"
              : timeline.hasOlder
                ? "上へ戻ると、古いものを読み込みます"
                : "これより前はありません"}
          </li>
        )}
        {timeline.error && (
          <li className="flex flex-wrap items-center justify-center gap-2 py-2 text-center text-sm text-danger-fg">
            {timeline.error}
            <Button variant="link" onClick={() => void timeline.syncLatest()}>
              読み直す
            </Button>
          </li>
        )}
        {timeline.loaded && entries.length === 0 && (
          // 文の区切りで折り返す(幅の狭い画面で、語の途中で切れないように)
          <li className="my-auto py-12 text-center text-fg-muted">
            {readOnly ? "履歴はありません。" : "まだ誰も話していません。"}
            <br />
            {readOnly ? null : session.audio ? (
              <>
                <span className="inline-block">「押して話す」を押している間、</span>
                <span className="inline-block">声がルームの全員に届きます。</span>
              </>
            ) : (
              <>
                <span className="inline-block">テキストはこのまま送れます。</span>
                <span className="inline-block">声で話すときは「音声をつなぐ」を押します。</span>
              </>
            )}
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
  remove: DeleteEntry;
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
  const remove = useDeleteEntry(session, entry, "テキスト");
  // 話者と同じ言語なら訳は無い(Agent が作らない)
  const translation = captionTranslation(entry, myLanguage);
  const language = captionLanguageLabel(entry);

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
  const remove = useDeleteEntry(session, entry, deletionWhat(event));

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

// 画面の下の操作の台。上から、いまの通話の表示灯、送信中のもの、テキスト入力、PTT のキー
function Console({
  session,
  uploader,
  myIdentity,
  myLanguage,
  onFiles,
  onAudio,
}: {
  session: RoomSession;
  uploader: Uploader | undefined;
  myIdentity: string;
  myLanguage: Language;
  onFiles: (files: Iterable<File>) => void;
  onAudio: (enabled: boolean) => void;
}) {
  return (
    <div className="border-t border-border bg-surface">
      <div className={cx(columnClass, "grid gap-3 pt-3 pb-4")}>
        {session.audio && <OnAir session={session} myIdentity={myIdentity} myLanguage={myLanguage} />}
        <OutgoingTexts session={session} />
        {uploader && <OutgoingMediaList uploader={uploader} />}
        <Controls session={session} onFiles={onFiles} />
        <AudioControls session={session} onAudio={onAudio} />
      </div>
    </div>
  );
}

// 音声をつないでいなければ「音声をつなぐ」、つないでいれば PTT(音声をつないだ全部のルームに届く)と「音声を切る」。
// PTT の場所に置き、状態が替わっても下の段が動かないようにする
function AudioControls({ session, onAudio }: { session: RoomSession; onAudio: (enabled: boolean) => void }) {
  const hub = useRoomHub();
  if (!session.audio) {
    return (
      <KeyButton
        className="w-full"
        icon={<Headphones aria-hidden="true" />}
        detail="マイクとスピーカーを使います"
        disabled={!session.connected || session.switchingAudio}
        onClick={() => {
          // 自動再生の制限を、利用者の操作の中で外しておく
          void session.startAudio();
          onAudio(true);
        }}
      >
        {session.switchingAudio ? "つないでいます…" : "音声をつなぐ"}
      </KeyButton>
    );
  }
  return (
    <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
      <MainPtt hub={hub} />
      <Button className="h-auto" title="マイクとスピーカーを使うのをやめる" onClick={() => onAudio(false)}>
        <PhoneOff aria-hidden="true" className="size-4" />
        <span className="max-sm:sr-only">音声を切る</span>
      </Button>
    </div>
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
  let detail: ReactNode = <span className="text-fg-muted">話している人はいません</span>;
  let rowClass = "bg-surface-muted";
  if (session.talking) {
    signal = "tx";
    label = "送話中";
    // 幅の狭い画面でも1行に収まる長さにする
    detail = audioRooms > 1 ? `音声中の${audioRooms}ルームに届いています` : "ルームの全員に届いています";
    rowClass = "bg-surface-muted";
  } else if (receiving) {
    const translation = captionTranslation(receiving, myLanguage);
    signal = "rx";
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
      <SignalLamp state={signal} />
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

// テキスト入力と、ファイルの添付。音声をつないでいなくても使える
function Controls({ session, onFiles }: { session: RoomSession; onFiles: (files: Iterable<File>) => void }) {
  const [text, setText] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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
          icon
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
          className="max-h-40 resize-none field-sizing-content"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onTextKeyDown}
          placeholder="テキストを送る"
          title="Enter で送信、Shift+Enter で改行"
          aria-label="テキスト"
          rows={1}
          disabled={disabled}
        />
        {/* 幅の狭い画面ではアイコンだけにして、入力欄の幅を取る */}
        <Button type="submit" className="max-sm:w-10 max-sm:px-0" disabled={disabled || text.trim() === ""}>
          <SendHorizontal aria-hidden="true" className="size-4" />
          <span className="max-sm:sr-only">送信</span>
        </Button>
      </form>
    </>
  );
}
