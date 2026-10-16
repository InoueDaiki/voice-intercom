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
});
