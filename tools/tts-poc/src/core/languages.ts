// 翻訳言語(設計メモの「選べる翻訳言語」の13言語)と、声の言語の突き合わせ。DOM を使わない。

export const LANGUAGE_CODES = [
  "es",
  "pt",
  "fr",
  "ja",
  "ru",
  "zh",
  "de",
  "ko",
  "hi",
  "id",
  "vi",
  "it",
  "en",
] as const;

export type LangCode = (typeof LANGUAGE_CODES)[number];

export interface Language {
  code: LangCode;
  name: string;
  /** 声を選ばずに読むときに `utterance.lang` に入れる BCP 47 のタグ */
  tag: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: "es", name: "スペイン語", tag: "es-ES" },
  { code: "pt", name: "ポルトガル語", tag: "pt-BR" },
  { code: "fr", name: "フランス語", tag: "fr-FR" },
  { code: "ja", name: "日本語", tag: "ja-JP" },
  { code: "ru", name: "ロシア語", tag: "ru-RU" },
  { code: "zh", name: "中国語", tag: "zh-CN" },
  { code: "de", name: "ドイツ語", tag: "de-DE" },
  { code: "ko", name: "韓国語", tag: "ko-KR" },
  { code: "hi", name: "ヒンディー語", tag: "hi-IN" },
  { code: "id", name: "インドネシア語", tag: "id-ID" },
  { code: "vi", name: "ベトナム語", tag: "vi-VN" },
  { code: "it", name: "イタリア語", tag: "it-IT" },
  { code: "en", name: "英語", tag: "en-US" },
];

/** SpeechSynthesisVoice のうち、ここで使う項目(テストで作れるように型だけ切り出す) */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  voiceURI: string;
}

// 古い言語コードや、言語の別名を13言語のコードに寄せる
const ALIASES: Record<string, string> = {
  in: "id", // Android の古い表記(in-ID)
  cmn: "zh",
};

/**
 * 声の `lang`("ja-JP"、"en_US"、"in-ID" など)から、13言語のコードを返す。13言語でなければ null。
 * Android の Chrome は区切りが "_" のことがあるので、"-" と同じに扱う。
 */
export function languageOf(lang: string): LangCode | null {
  const primary = lang.trim().toLowerCase().replaceAll("_", "-").split("-")[0] ?? "";
  const code = ALIASES[primary] ?? primary;
  return (LANGUAGE_CODES as readonly string[]).includes(code) ? (code as LangCode) : null;
}

/** 声を13言語に振り分ける。13言語に当たらない声は `others` に入れる */
export function groupVoices<V extends VoiceLike>(
  voices: readonly V[],
): { byLanguage: Map<LangCode, V[]>; others: V[] } {
  const byLanguage = new Map<LangCode, V[]>(LANGUAGE_CODES.map((c) => [c, []]));
  const others: V[] = [];
  for (const v of voices) {
    const code = languageOf(v.lang);
    if (code) byLanguage.get(code)?.push(v);
    else others.push(v);
  }
  return { byLanguage, others };
}
