// タイムラインの表示のための決め方(行のまとめ方、訳の選び方、送信中のものの文言、行の削除)
import {
  LANGUAGE_LABELS,
  type Language,
  type OutgoingMedia,
  type RoomSession,
  type TimelineEntry,
} from "@voice-intercom/client-core";
import { useState } from "react";

import { deleteErrorMessage } from "./errors.ts";
import type { CaptionEntry } from "./receiving.ts";

// 同じ人の続けての発言を、名前を出さずにまとめる間隔(ミリ秒)
const GROUP_WINDOW_MS = 60_000;

export function senderOf(entry: TimelineEntry): string {
  return entry.type === "caption" ? entry.speakerIdentity : entry.event.sender_id;
}

// 前の行と同じ人の、間を置かない続きなら、名前と時刻を省いて1つの発言のように見せる
export function continuesPrevious(prev: TimelineEntry | undefined, entry: TimelineEntry): boolean {
  return (
    prev !== undefined &&
    senderOf(prev) === senderOf(entry) &&
    entry.at.getTime() - prev.at.getTime() < GROUP_WINDOW_MS
  );
}

// 自分の言語の訳。話者と同じ言語なら訳は無い(Agent が作らない)
export function captionTranslation(entry: CaptionEntry, myLanguage: Language) {
  return entry.originalLanguage === myLanguage ? undefined : entry.translations.get(myLanguage);
}

// 話した言語の名前(無ければ undefined)
export function captionLanguageLabel(entry: CaptionEntry): string | undefined {
  return entry.originalLanguage
    ? (LANGUAGE_LABELS[entry.originalLanguage as Language] ?? entry.originalLanguage)
    : undefined;
}

// 送信中の画像・動画・ファイルの状態の文言
export function outgoingMediaLabel<S, P>(item: OutgoingMedia<S, P>): string {
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

// 消す操作と確認。ask で確認のダイアログを開き、確定したら消す。失敗したら理由を返す
export function useDeleteEntry(session: RoomSession, entry: TimelineEntry, what: string) {
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
      setError(deleteErrorMessage(e));
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

export type DeleteEntry = ReturnType<typeof useDeleteEntry>;
