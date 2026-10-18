import { describe, expect, it } from "vitest";
import { LANGUAGES, LANGUAGE_CODES, groupVoices, languageOf, type VoiceLike } from "./languages.ts";
import { remainingText, snapToWordStart } from "./text.ts";

const voice = (name: string, lang: string): VoiceLike => ({
  name,
  lang,
  localService: true,
  default: false,
  voiceURI: name,
});

describe("languageOf", () => {
  it("地域や区切りの違いを吸収する", () => {
    expect(languageOf("ja-JP")).toBe("ja");
    expect(languageOf("en_US")).toBe("en");
    expect(languageOf("PT-br")).toBe("pt");
    expect(languageOf("zh-TW")).toBe("zh");
  });

  it("古いインドネシア語のコードを読み替える", () => {
    expect(languageOf("in-ID")).toBe("id");
  });

  it("13言語でなければ null", () => {
    expect(languageOf("th-TH")).toBeNull();
    expect(languageOf("")).toBeNull();
  });
});

describe("groupVoices", () => {
  it("13言語ごとに分け、声が無い言語は空の配列にする", () => {
    const { byLanguage, others } = groupVoices([
      voice("Kyoko", "ja-JP"),
      voice("Samantha", "en-US"),
      voice("Daniel", "en-GB"),
      voice("Kanya", "th-TH"),
    ]);
    expect(byLanguage.size).toBe(13);
    expect(byLanguage.get("ja")?.map((v) => v.name)).toEqual(["Kyoko"]);
    expect(byLanguage.get("en")?.map((v) => v.name)).toEqual(["Samantha", "Daniel"]);
    expect(byLanguage.get("hi")).toEqual([]);
    expect(others.map((v) => v.name)).toEqual(["Kanya"]);
  });

  it("言語の一覧はコードの一覧と同じ並び", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual([...LANGUAGE_CODES]);
  });
});

describe("remainingText", () => {
  it("読んでいる語の先頭から後ろを返す", () => {
    expect(remainingText("Please send two more people", 12)).toBe("two more people");
  });

  it("boundary が無ければ全文、範囲の外なら空", () => {
    expect(remainingText("abc", null)).toBe("abc");
    expect(remainingText("abc", 3)).toBe("");
    expect(remainingText("abc", -1)).toBe("");
  });
});

describe("snapToWordStart", () => {
  it("語の途中なら、その語の先頭に戻す", () => {
    expect(snapToWordStart("send two more", 7)).toBe(5);
    expect(snapToWordStart("send two more", 5)).toBe(5);
    expect(snapToWordStart("send two more", 2)).toBe(0);
  });

  it("空白の無い文では位置をそのまま使い、範囲に収める", () => {
    expect(snapToWordStart("田中さん、無線機を", 4)).toBe(4);
    expect(snapToWordStart("abc", 99)).toBe(3);
  });
});
