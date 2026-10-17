import { describe, expect, it } from "vitest";

import { cognitoBranding, cognitoColor } from "./cognito.ts";
import { oklch } from "./color.ts";

// settings の中の、色の値(キーが Color で終わるもの)を全部集める
function colorValues(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    return /color$/i.test(key) ? [value] : [];
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => colorValues(v, k));
  }
  return [];
}

describe("cognitoColor", () => {
  it("不透明な色は ff を足す", () => {
    expect(cognitoColor(oklch(1, 0, 0))).toBe("ffffffff");
  });

  it("半透明の色は不透明度をそのまま付ける", () => {
    expect(cognitoColor(oklch(0, 0, 0, 0.5))).toBe("00000080");
  });
});

describe("cognitoBranding", () => {
  it("色はすべて rrggbbaa の形", () => {
    const values = colorValues(cognitoBranding());
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("明暗の両方の値を持つ", () => {
    const { components } = cognitoBranding();
    expect(components.primaryButton.lightMode.defaults.backgroundColor).not.toBe(
      components.primaryButton.darkMode.defaults.backgroundColor,
    );
  });
});
