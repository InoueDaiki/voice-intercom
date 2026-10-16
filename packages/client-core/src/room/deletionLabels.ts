import type { TimelineEvent } from "../api.ts";

// 消したテキスト、画像、動画、ファイルの表示(履歴とルームの表示で同じ言い方にする)
export const DELETED_TEXT_LABEL = "削除されたテキスト";
export const DELETED_IMAGE_LABEL = "削除された画像";
export const DELETED_VIDEO_LABEL = "削除された動画";
export const DELETED_FILE_LABEL = "削除されたファイル";

// 墓石の行の「削除された…」
export function deletedLabel(event: TimelineEvent): string {
  if (event.kind !== "media") {
    return DELETED_TEXT_LABEL;
  }
  switch (event.deleted?.media_type) {
    case "video":
      return DELETED_VIDEO_LABEL;
    case "file":
      return DELETED_FILE_LABEL;
    default:
      return DELETED_IMAGE_LABEL;
  }
}

// 消す操作と確認に出す「何を」(「この画像を削除」など)
export function deletionWhat(event: TimelineEvent): string {
  if (event.kind !== "media") {
    return "テキスト";
  }
  switch (event.media?.media_type) {
    case "video":
      return "動画";
    case "file":
      return "ファイル";
    default:
      return "画像";
  }
}
