import { useId, useState } from "react";
import { Link, useParams } from "react-router";

import type { TimelineEvent, TimelineKind, TimelineMedia, User } from "../adminApi.ts";
import { useRoom, useTimeline, useUsers } from "../queries.ts";
import { errorMessage, formatBytes, formatTime, languageLabel } from "../rooms.ts";

const KIND_LABELS: Record<TimelineKind, string> = {
  utterance: "音声",
  text: "テキスト",
  media: "画像・動画",
};

// 言語の絞り込みで「原文の言語が不明(null)」を選ぶときの値
const UNKNOWN_LANGUAGE = "__unknown__";

// 画面に出す1件。同じ utterance_id の区切りは、古い順に並べて1つの発話にまとめる
interface Entry {
  key: string;
  // まとめた区切り(utterance 以外は1件だけ)。segment_index の昇順
  events: TimelineEvent[];
}

// 新しい順の events を、表示の単位にまとめる。発話は、いちばん新しい区切りの位置に置く
// (間に別の人の発言が挟まっても、区切りがばらばらにならないように)
function toEntries(events: TimelineEvent[]): Entry[] {
  const entries: Entry[] = [];
  const byUtterance = new Map<string, Entry>();
  for (const event of events) {
    const utteranceId = event.kind === "utterance" ? event.utterance_id : undefined;
    if (!utteranceId) {
      entries.push({ key: event.event_id, events: [event] });
      continue;
    }
    const entry = byUtterance.get(utteranceId);
    if (entry) {
      entry.events.push(event);
    } else {
      const created = { key: `utterance:${utteranceId}`, events: [event] };
      byUtterance.set(utteranceId, created);
      entries.push(created);
    }
  }
  for (const entry of byUtterance.values()) {
    entry.events.sort(
      (a, b) => (a.segment_index ?? 0) - (b.segment_index ?? 0) || a.event_id.localeCompare(b.event_id),
    );
  }
  return entries;
}

export function RoomTimeline() {
  const roomId = useParams().roomId ?? "";
  const room = useRoom(roomId);
  const timeline = useTimeline(roomId);
  const users = useUsers();
  const [kind, setKind] = useState<TimelineKind | "">("");
  const [language, setLanguage] = useState("");
  const kindId = useId();
  const languageId = useId();

  const back = (
    <p>
      <Link to={`/rooms/${encodeURIComponent(roomId)}`}>← ルームの詳細</Link>
    </p>
  );
  const title = <h1>{room.data ? `${room.data.name} の履歴` : `ルーム「${roomId}」の履歴`}</h1>;

  if (timeline.isPending) {
    return (
      <section>
        {back}
        {title}
        <p>読み込み中…</p>
      </section>
    );
  }
  if (timeline.isError && !timeline.isFetchNextPageError) {
    return (
      <section>
        {back}
        {title}
        <div className="error" role="alert">
          <p>履歴を取得できません: {errorMessage(timeline.error)}</p>
          <button type="button" onClick={() => void timeline.refetch()}>
            再読み込み
          </button>
        </div>
      </section>
    );
  }

  const usersById = new Map((users.data ?? []).map((u) => [u.user_id, u]));
  const all = timeline.data?.pages.flatMap((page) => page.items) ?? [];
  // 絞り込みの選択肢は、読み込んだ分に出てくる言語だけにする
  const languages = [...new Set(all.map((e) => e.language ?? UNKNOWN_LANGUAGE))].sort((a, b) =>
    a === UNKNOWN_LANGUAGE ? 1 : b === UNKNOWN_LANGUAGE ? -1 : languageLabel(a).localeCompare(languageLabel(b), "ja"),
  );
  const filtered = all.filter(
    (e) =>
      (kind === "" || e.kind === kind) &&
      (language === "" || (e.language ?? UNKNOWN_LANGUAGE) === language),
  );
  const entries = toEntries(filtered);

  return (
    <section>
      {back}
      {title}

      <div className="row filters">
        <label htmlFor={kindId}>種類</label>
        <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value as TimelineKind | "")}>
          <option value="">すべて</option>
          {(Object.keys(KIND_LABELS) as TimelineKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <label htmlFor={languageId}>原文の言語</label>
        <select id={languageId} value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">すべて</option>
          {languages.map((code) => (
            <option key={code} value={code}>
              {code === UNKNOWN_LANGUAGE ? "不明" : languageLabel(code)}
            </option>
          ))}
        </select>
        <span className="muted">
          読み込んだ {all.length}件中 {filtered.length}件
        </span>
      </div>

      {all.length === 0 ? (
        <p className="muted">履歴はまだありません。</p>
      ) : entries.length === 0 ? (
        <p className="muted">読み込んだ履歴の中に、当てはまるものはありません。</p>
      ) : (
        <ol className="timeline">
          {entries.map((entry) => (
            <TimelineEntry
              key={entry.key}
              events={entry.events}
              sender={usersById.get(entry.events[0]!.sender_id)}
              usersPending={users.isPending}
            />
          ))}
        </ol>
      )}

      <div className="row more">
        {timeline.isFetchNextPageError && (
          <p className="error" role="alert">
            続きを取得できません: {errorMessage(timeline.error)}
          </p>
        )}
        {timeline.hasNextPage ? (
          <button type="button" onClick={() => void timeline.fetchNextPage()} disabled={timeline.isFetchingNextPage}>
            {timeline.isFetchingNextPage ? "読み込み中…" : "もっと見る"}
          </button>
        ) : (
          all.length > 0 && <p className="muted">これより古い履歴はありません。</p>
        )}
      </div>
    </section>
  );
}

interface EntryProps {
  // 1件、または同じ発話の区切り(古い順)
  events: TimelineEvent[];
  sender: User | undefined;
  usersPending: boolean;
}

function TimelineEntry({ events, sender, usersPending }: EntryProps) {
  const first = events[0]!;
  const last = events.at(-1)!;
  const segmented = events.length > 1;
  // 訳文は言語ごとに、区切りの順に並べる
  const translationLanguages = [...new Set(events.flatMap((e) => Object.keys(e.translations)))].sort((a, b) =>
    languageLabel(a).localeCompare(languageLabel(b), "ja"),
  );

  return (
    <li className={`timeline-entry kind-${first.kind}`}>
      <div className="timeline-head">
        <time dateTime={first.occurred_at} title={segmented ? `${formatTime(first.occurred_at)} 〜 ${formatTime(last.occurred_at)}` : undefined}>
          {formatTime(first.occurred_at)}
        </time>
        <span className="sender">
          {sender ? (
            sender.display_name
          ) : (
            // ユーザー一覧にいない(読み込み中か、削除されたユーザー)ときは sub を出す
            <span className="muted" title={first.sender_id}>
              {usersPending ? "読み込み中…" : first.sender_id}
            </span>
          )}
        </span>
        <span className="tag">{KIND_LABELS[first.kind]}</span>
        <span className="tag">{languageLabel(first.language)}</span>
        {segmented && <span className="muted">{events.length}つの区切り</span>}
      </div>

      {events.some((e) => e.text !== "") && (
        <p className="timeline-text">
          {events.map((e) => (
            <span key={e.event_id} className="segment" title={segmented ? `区切り ${(e.segment_index ?? 0) + 1}` : undefined}>
              {e.text}
            </span>
          ))}
        </p>
      )}

      {events.map((e) => e.media && <MediaView key={e.event_id} media={e.media} />)}

      {translationLanguages.length > 0 && (
        <details className="translations">
          <summary>訳文({translationLanguages.length}言語)</summary>
          <dl className="meta">
            {translationLanguages.map((code) => (
              <div key={code} className="translation">
                <dt>{languageLabel(code)}</dt>
                <dd>
                  {events.map(
                    (e) =>
                      e.translations[code] !== undefined && (
                        <span key={e.event_id} className="segment">
                          {e.translations[code]}
                        </span>
                      ),
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </li>
  );
}

// 画像は縮小画像(なければ本体)を出し、クリックで本体を開く。動画はその場で再生する。
// 読み込めないときは「プレビューなし」にして、本体へのリンクだけを残す
function MediaView({ media }: { media: TimelineMedia }) {
  const [failed, setFailed] = useState(false);
  const isImage = media.content_type.startsWith("image/");
  const isVideo = media.content_type.startsWith("video/");
  const info = (
    <span className="muted">
      {media.content_type}、{formatBytes(media.size_bytes)}
    </span>
  );

  if (failed || (!isImage && !isVideo)) {
    return (
      <div className="media">
        <div className="media-placeholder">プレビューなし</div>
        <a href={media.url} target="_blank" rel="noreferrer">
          本体を開く
        </a>{" "}
        {info}
      </div>
    );
  }
  return (
    <div className="media">
      {isImage ? (
        <a href={media.url} target="_blank" rel="noreferrer" title="本体を開く">
          <img src={media.thumbnail_url ?? media.url} alt="送信された画像" loading="lazy" onError={() => setFailed(true)} />
        </a>
      ) : (
        <video controls preload="metadata" src={media.url} onError={() => setFailed(true)} />
      )}
      <div>{info}</div>
    </div>
  );
}
