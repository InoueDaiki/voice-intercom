import type { TimelineEvent } from "../api.ts";

// 消したテキスト、画像、動画の表示(履歴とルームの表示で同じ言い方にする)
export const DELETED_TEXT_LABEL = "削除されたテキスト";
export const DELETED_IMAGE_LABEL = "削除された画像";
export const DELETED_VIDEO_LABEL = "削除された動画";

// 墓石の行の「削除された…」
export function deletedLabel(event: TimelineEvent): string {
  if (event.kind !== "media") {
    return DELETED_TEXT_LABEL;
  }
  return event.deleted?.media_type === "video" ? DELETED_VIDEO_LABEL : DELETED_IMAGE_LABEL;
}

// 消す操作と確認に出す「何を」(「この画像を削除」など)
export function deletionWhat(event: TimelineEvent): string {
  if (event.kind !== "media") {
    return "テキスト";
  }
  return event.media?.content_type === "video/mp4" ? "動画" : "画像";
}
