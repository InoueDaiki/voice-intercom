import { expect, test } from "vitest";

import { mediaEvent, ownText, tombstoneOf } from "../testing/fixtures.ts";
import { deletedLabel, deletionWhat } from "./deletionLabels.ts";

test("種類ごとの言い方", () => {
  expect(deletedLabel(tombstoneOf(ownText("2026-10-13T00:00:01.000Z")))).toBe("削除されたテキスト");
  const image = mediaEvent("2026-10-13T00:00:02.000Z");
  expect(deletedLabel(tombstoneOf(image))).toBe("削除された画像");
  expect(deletedLabel(tombstoneOf(image, true))).toBe("削除された動画");
  expect(deletionWhat(image)).toBe("画像");
  expect(deletionWhat(mediaEvent("t", { video: true }))).toBe("動画");
  expect(deletionWhat(ownText("2026-10-13T00:00:01.000Z"))).toBe("テキスト");
  // ファイル(画像・動画でないもの)
  const file = mediaEvent("2026-10-13T00:00:03.000Z");
  file.media = { ...file.media!, content_type: "application/pdf", media_type: "file", file_name: "a.pdf" };
  expect(deletionWhat(file)).toBe("ファイル");
  expect(deletedLabel({ ...tombstoneOf(file), deleted: { deleted_at: "x", media_type: "file" } })).toBe("削除されたファイル");
});
