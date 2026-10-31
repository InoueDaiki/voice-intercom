import { describe, expect, it } from "vitest";

import { redirectSystemPath } from "./app/+native-intent.ts";

describe("redirectSystemPath", () => {
  it.each(["voiceintercom://callback?code=1", "voiceintercom://signout", "/signout", "signout"])("%s は一覧へ送る", (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe("/");
  });

  it("ほかのパスはそのまま", () => {
    expect(redirectSystemPath({ path: "/rooms/signout", initial: false })).toBe("/rooms/signout");
  });
});
