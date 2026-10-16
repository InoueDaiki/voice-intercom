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
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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

type Uploader = MediaUploader<File, Blob>;

export default function RoomPage() {
  const roomId = useParams().roomId ?? "";
  const room = useRoom(roomId);
  const me = useMe();
  const { user } = useAuth();
  const myIdentity = user?.profile.sub;

  if (room.isPending || me.isPending) {
    return <p>読み込み中…</p>;
  }
  if (room.isError) {
    return (
      <section>
        <BackLink />
        <p className="error" role="alert">
          ルームを開けません: {errorMessage(room.error)}
        </p>
      </section>
    );
  }
  if (!me.data || !myIdentity) {
    return <p className="error">プロフィールが登録されていません。</p>;
  }
  return <RoomScreen key={roomId} roomId={roomId} roomName={room.data.name} me={me.data} myIdentity={myIdentity} />;
}

function BackLink() {
  return (
    <Link to="/" className="back">
      ← ルームの一覧
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
      className={dragging ? "room dragging" : "room"}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className="room-header">
        <BackLink />
        <h1>{roomName}</h1>
        {session && <RoomStatus session={session} />}
      </div>
      {joinError && (
        <p className="error" role="alert">
          {joinError}
        </p>
      )}
      {session?.error && !joinError && (
        <p className="error" role="alert">
          {session.error}
        </p>
      )}
      {session?.warning && <p className="muted">{session.warning}</p>}
      {session && !session.canPlaybackAudio && (
        <p className="notice">
          ブラウザが音の再生を止めています。
          <button type="button" onClick={() => void session.startAudio()}>
            音を出す
          </button>
        </p>
      )}
      {session && <Timeline session={session} myLanguage={me.language} />}
      {session && <OutgoingTexts session={session} />}
      {uploader && <OutgoingMediaList uploader={uploader} />}
      {session && <Controls session={session} onFiles={sendFiles} />}
    </section>
  );
}

function RoomStatus({ session }: { session: RoomSession }) {
  if (!session.connected) {
    return <span className="tag">{session.error ? "切断" : "入室中…"}</span>;
  }
  return (
    <span className="row">
      <span className="tag">{session.participantCount}人</span>
      <span className={session.agentPresent ? "tag" : "tag muted"}>
        {session.agentPresent ? "翻訳あり" : "翻訳の準備中"}
      </span>
    </span>
  );
}

// 履歴と、入室してから届いたものを1本にしたタイムライン。新しいものが下に来る。
// 下端を見ていれば新しいものを追いかけ、上端に近づいたら古いほうを読み足す
function Timeline({ session, myLanguage }: { session: RoomSession; myLanguage: Language }) {
  const entries = session.entries;
  const timeline = session.timeline;
  const listRef = useRef<HTMLOListElement>(null);
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
    <ol
      className="feed"
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        if (el.scrollTop < LOAD_OLDER_THRESHOLD) {
          loadOlder();
        }
      }}
    >
      <li className="feed-edge muted">
        {!timeline.loaded || timeline.loadingOlder
          ? "読み込み中…"
          : timeline.hasOlder
            ? "上へ戻ると、古いものを読み込みます"
            : "これより前はありません"}
      </li>
      {timeline.error && (
        <li className="feed-edge error">
          {timeline.error}
          <button type="button" className="link-button" onClick={() => void timeline.syncLatest()}>
            読み直す
          </button>
        </li>
      )}
      {timeline.loaded && entries.length === 0 && (
        <li className="muted">まだ何もありません。PTT を押して話すか、テキストやファイルを送ってください。</li>
      )}
      {entries.map((entry) =>
        entry.type === "caption" ? (
          <CaptionItem key={entry.key} session={session} entry={entry} myLanguage={myLanguage} />
        ) : (
          <MediaItem key={entry.key} session={session} entry={entry} />
        ),
      )}
    </ol>
  );
}

// 消す操作と確認。失敗したら理由を返す
function useDelete(session: RoomSession, entry: TimelineEntry, what: string) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const run = async () => {
    if (!window.confirm(`この${what}を削除しますか?`)) {
      return;
    }
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
  return { deleting, error, run, can: session.canDeleteEntry(entry) };
}

// 音声の発話とテキスト入力。履歴の行も、届いたばかりの字幕も同じ形で出す
function CaptionItem({
  session,
  entry,
  myLanguage,
}: {
  session: RoomSession;
  entry: Extract<TimelineEntry, { type: "caption" }>;
  myLanguage: Language;
}) {
  const remove = useDelete(session, entry, "テキスト");
  // 話者と同じ言語なら訳は無い(Agent が作らない)
  const translation = entry.originalLanguage === myLanguage ? undefined : entry.translations.get(myLanguage);

  return (
    <li className={`feed-item ${entry.isText ? "kind-text" : "kind-utterance"}`}>
      <div className="feed-head">
        <span className="sender">{session.displayName(entry.speakerIdentity)}</span>
        <span className="muted">{formatTime(entry.at)}</span>
        {entry.isText && <span className="tag">テキスト</span>}
        {entry.originalLanguage && (
          <span className="tag">{LANGUAGE_LABELS[entry.originalLanguage as Language] ?? entry.originalLanguage}</span>
        )}
        {remove.can && (
          <button type="button" className="link-button" disabled={remove.deleting} onClick={() => void remove.run()}>
            削除
          </button>
        )}
      </div>
      {entry.deleted ? (
        <p className="deleted">{DELETED_TEXT_LABEL}</p>
      ) : (
        <>
          {entry.original && (
            <p className={entry.original.isFinal ? "original" : "original pending"}>
              {entry.original.text || <span className="muted">(聞き取れませんでした)</span>}
            </p>
          )}
          {translation && (
            <p className={translation.isFinal ? "translation" : "translation pending"}>{translation.text}</p>
          )}
        </>
      )}
      {remove.error && <p className="error">{remove.error}</p>}
    </li>
  );
}

// 画像・動画・ファイル
function MediaItem({ session, entry }: { session: RoomSession; entry: Extract<TimelineEntry, { type: "media" }> }) {
  const event = entry.event;
  const remove = useDelete(session, entry, deletionWhat(event));

  return (
    <li className="feed-item kind-media">
      <div className="feed-head">
        <span className="sender">{session.displayName(event.sender_id)}</span>
        <span className="muted">{formatTime(entry.at)}</span>
        {remove.can && (
          <button type="button" className="link-button" disabled={remove.deleting} onClick={() => void remove.run()}>
            削除
          </button>
        )}
      </div>
      <MediaBody event={event} />
      {remove.error && <p className="error">{remove.error}</p>}
    </li>
  );
}

function MediaBody({ event }: { event: TimelineEvent }) {
  const [failed, setFailed] = useState(false);
  const media = event.media;
  if (event.deleted || !media) {
    return <p className="deleted">{deletedLabel(event)}</p>;
  }
  if (media.media_type === "file" || failed) {
    // ファイルはダウンロードだけ(Content-Disposition: attachment で置いてある)。
    // 画像・動画を表示できなかったときも、ダウンロードのリンクにする。
    // 配信の応答にヘッダーが無くても、ルームの画面から離れないよう、新しいタブで開く
    return (
      <p className="file">
        <span aria-hidden="true">📄</span>{" "}
        <a href={media.url} download={media.file_name ?? true} target="_blank" rel="noreferrer">
          {media.file_name ?? (media.media_type === "file" ? "ファイル" : "ダウンロード")}
        </a>{" "}
        <span className="muted">{formatBytes(media.size_bytes)}</span>
      </p>
    );
  }
  // 縦横比の枠を先に取り、読み終えても周りがずれないようにする
  const aspect = media.width && media.height ? `${media.width} / ${media.height}` : undefined;
  if (media.media_type === "video") {
    // 一覧ではサムネイル(無ければ枠)だけを読み、本体は再生してから読む
    return (
      <div className="media-box">
        <video
          className="media"
          style={{ aspectRatio: aspect }}
          src={media.url}
          poster={media.thumbnail_url ?? undefined}
          controls
          preload="none"
          onError={() => setFailed(true)}
        />
        {media.duration_ms != null && <span className="duration">{formatDuration(media.duration_ms)}</span>}
      </div>
    );
  }
  return (
    <a href={media.url} target="_blank" rel="noreferrer">
      <img
        className="media"
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
    <ul className="outgoing">
      {items.map(({ t, label }) => (
        <li key={t.messageId}>
          <span className="outgoing-text">{t.text}</span>
          <span className={t.state === "sending" || t.state === "delivered" ? "tag" : "tag error"}>{label}</span>
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
    <ul className="outgoing">
      {items.map((item) => (
        <li key={item.localId}>
          <span className="outgoing-text">{item.source.name}</span>
          <span className={item.state === "failed" ? "tag error" : "tag"}>{outgoingMediaLabel(item)}</span>
          {item.state !== "failed" && item.progress !== undefined && (
            <progress max={1} value={item.progress} aria-label="進み具合" />
          )}
          {item.state === "failed" && item.retryable && (
            <button type="button" className="link-button" onClick={() => uploader.retry(item)}>
              やり直す
            </button>
          )}
          {item.state === "failed" && (
            <button type="button" className="link-button" onClick={() => uploader.dismiss(item)}>
              取り消す
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function outgoingMediaLabel(item: OutgoingMedia<File, Blob>): string {
  switch (item.state) {
    case "preparing":
      return "準備中";
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
    <div className="controls">
      <button
        type="button"
        className={session.talking ? "ptt talking" : session.pressing ? "ptt pressing" : "ptt"}
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
        {session.talking ? "話しています" : "押して話す(Space)"}
      </button>
      <form className="text-form" onSubmit={onSubmit}>
        <button
          type="button"
          className="attach"
          title="画像・動画・ファイルを送る(10GB まで)"
          aria-label="画像・動画・ファイルを送る"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          📎
        </button>
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
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onTextKeyDown}
          placeholder="テキストを入力(Enter で送信、Shift+Enter で改行)"
          rows={2}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || text.trim() === ""}>
          送信
        </button>
      </form>
    </div>
  );
}
