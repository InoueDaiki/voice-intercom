import {
  ApiError,
  type CaptionSegment,
  DELETED_TEXT_LABEL,
  deletedLabel,
  deletionWhat,
  LANGUAGE_LABELS,
  type Language,
  mergeRoomFeed,
  NotSavedYetError,
  outgoingTextLabel,
  RoomSession,
  type TimelineEvent,
  type User,
} from "@voice-intercom/client-core";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAuth } from "react-oidc-context";
import { Link, useParams } from "react-router";

import { api } from "../api.ts";
import { errorMessage, useMe, useRoom } from "../queries.ts";
import { webRoomPlatform } from "../roomPlatform.ts";
import { useObservable } from "../useObservable.ts";

// 入室したときとつなぎ直したときに読む、履歴の先頭のページの件数
const RECENT_LIMIT = 50;

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
  const [joinError, setJoinError] = useState<string>();
  useObservable(session);

  useEffect(() => {
    const fetchRecent = async () => (await api.listTimeline(roomId, { limit: RECENT_LIMIT })).items;
    const s = new RoomSession({
      myIdentity,
      myLanguage: me.language,
      roomName,
      platform: webRoomPlatform,
      fetchRecentTimeline: fetchRecent,
      fetchTimelineEvent: (eventId) => api.getTimelineEvent(roomId, eventId),
      deleteTimelineEvent: (eventId) => api.deleteTimelineEvent(roomId, eventId),
    });
    // 入室とつなぎ直しのときに履歴を読み、切れていた間の画像・動画と削除を埋める
    const fillGap = () => {
      fetchRecent()
        .then((rows) => s.applyTimeline(rows))
        .catch((e: unknown) => console.warn("履歴を読めなかった", e));
    };
    s.onReconnected = fillGap;
    setSession(s);
    setJoinError(undefined);
    let cancelled = false;
    (async () => {
      const token = await api.createLiveKitToken(roomId);
      if (cancelled) {
        return;
      }
      await s.connect(token.server_url, token.participant_token);
      fillGap();
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
      s.dispose();
    };
  }, [roomId, roomName, me.language, myIdentity]);

  return (
    <section className="room">
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
      {session && <Feed session={session} myLanguage={me.language} />}
      {session && <OutgoingTexts session={session} />}
      {session && <Controls session={session} />}
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

// 字幕と画像・動画を時刻の順に。新しいものが下に来るので、下端を見ていれば追いかける
function Feed({ session, myLanguage }: { session: RoomSession; myLanguage: Language }) {
  const entries = mergeRoomFeed(session.captions.segments, session.media.items);
  const listRef = useRef<HTMLOListElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  return (
    <ol
      className="feed"
      ref={listRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {entries.length === 0 && <li className="muted">まだ何もありません。PTT を押して話すか、テキストを送ってください。</li>}
      {entries.map((entry) =>
        entry.type === "caption" ? (
          <CaptionItem key={`c-${entry.segment.segmentId}`} session={session} segment={entry.segment} myLanguage={myLanguage} />
        ) : (
          <MediaItem key={`m-${entry.event.event_id}`} session={session} event={entry.event} />
        ),
      )}
    </ol>
  );
}

function CaptionItem({ session, segment, myLanguage }: { session: RoomSession; segment: CaptionSegment; myLanguage: Language }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  // 話者と同じ言語なら訳は届かない(Agent が作らない)
  const translation = segment.originalLanguage === myLanguage ? undefined : segment.translations.get(myLanguage);

  const onDelete = async () => {
    if (!window.confirm("このテキストを削除しますか?")) {
      return;
    }
    setDeleting(true);
    setError(undefined);
    try {
      await session.deleteOwnText(segment);
    } catch (e) {
      setError(e instanceof NotSavedYetError ? "まだ履歴に保存されていません。少し待ってからやり直してください。" : errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <li className={`feed-item ${segment.isText ? "kind-text" : "kind-utterance"}`}>
      <div className="feed-head">
        <span className="sender">{session.displayName(segment.speakerIdentity)}</span>
        <span className="muted">{formatTime(segment.receivedAt)}</span>
        {segment.isText && <span className="tag">テキスト</span>}
        {segment.originalLanguage && (
          <span className="tag">{LANGUAGE_LABELS[segment.originalLanguage as Language] ?? segment.originalLanguage}</span>
        )}
        {session.canDeleteCaption(segment) && (
          <button type="button" className="link-button" disabled={deleting} onClick={() => void onDelete()}>
            削除
          </button>
        )}
      </div>
      {segment.deleted ? (
        <p className="deleted">{DELETED_TEXT_LABEL}</p>
      ) : (
        <>
          {segment.original && (
            <p className={segment.original.isFinal ? "original" : "original pending"}>{segment.original.text}</p>
          )}
          {translation && (
            <p className={translation.isFinal ? "translation" : "translation pending"}>{translation.text}</p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </li>
  );
}

// 画像・動画(送るのはまだ。受け取ったもの、履歴にあるものを出す)
function MediaItem({ session, event }: { session: RoomSession; event: TimelineEvent }) {
  const [error, setError] = useState<string>();
  const media = event.media;
  const what = deletionWhat(event);

  const onDelete = async () => {
    if (!window.confirm(`この${what}を削除しますか?`)) {
      return;
    }
    setError(undefined);
    try {
      await session.deleteOwnMedia(event);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <li className="feed-item kind-media">
      <div className="feed-head">
        <span className="sender">{session.displayName(event.sender_id)}</span>
        <span className="muted">{formatTime(new Date(event.occurred_at))}</span>
        {session.canDeleteMedia(event) && (
          <button type="button" className="link-button" onClick={() => void onDelete()}>
            削除
          </button>
        )}
      </div>
      {event.deleted || !media ? (
        <p className="deleted">{deletedLabel(event)}</p>
      ) : media.content_type.startsWith("video/") ? (
        // 一覧ではサムネイル(無ければ枠)だけを読み、本体は再生してから読む
        <video className="media" src={media.url} poster={media.thumbnail_url ?? undefined} controls preload="none" />
      ) : (
        <a href={media.url} target="_blank" rel="noreferrer">
          <img className="media" src={media.thumbnail_url ?? media.url} alt="送られた画像" loading="lazy" />
        </a>
      )}
      {error && <p className="error">{error}</p>}
    </li>
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

// PTT とテキスト入力。PTT はボタンを押している間か、テキスト欄の外で Space を押している間
function Controls({ session }: { session: RoomSession }) {
  const [text, setText] = useState("");

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

function formatTime(d: Date): string {
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
