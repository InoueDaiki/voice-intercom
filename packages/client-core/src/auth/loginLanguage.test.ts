import { describe, expect, it } from "vitest";

import { loginLanguage } from "./loginLanguage.ts";

describe("loginLanguage", () => {
  it("訳がある言語はそのまま選ぶ", () => {
    expect(loginLanguage(["ja"])).toBe("ja");
    expect(loginLanguage(["pt-BR"])).toBe("pt-BR");
  });

  it("地域つきの言語は、言語の部分で合わせる", () => {
    expect(loginLanguage(["ja-JP"])).toBe("ja");
    expect(loginLanguage(["en-US"])).toBe("en");
    expect(loginLanguage(["pt-PT"])).toBe("pt-BR");
  });

  it("中国語は繁体字と簡体字に分ける", () => {
    expect(loginLanguage(["zh-Hant-HK"])).toBe("zh-TW");
    expect(loginLanguage(["zh-TW"])).toBe("zh-TW");
    expect(loginLanguage(["zh-Hans-CN"])).toBe("zh-CN");
    expect(loginLanguage(["zh"])).toBe("zh-CN");
  });

  it("訳が無い言語は飛ばして、次の好みを見る", () => {
    expect(loginLanguage(["vi", "th", "ko"])).toBe("ko");
  });

  it("どれも合わなければ英語", () => {
    expect(loginLanguage(["vi"])).toBe("en");
    expect(loginLanguage([])).toBe("en");
  });
});
