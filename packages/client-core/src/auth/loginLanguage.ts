// ログイン画面(Cognito のマネージドログイン)の言語。/oauth2/authorize の lang に付ける。
// Cognito は lang が無いと英語で出すので、端末の言語の好み(Web は navigator.languages)から選ぶ。
// 模擬 OIDC サーバーは lang を無視する。

// Cognito のマネージドログインが訳している言語
// (https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html#managed-login-localization)
const SUPPORTED = ["de", "en", "es", "fr", "id", "nl", "it", "ja", "ko", "pt-BR", "zh-CN", "zh-TW"] as const;

export type LoginLanguage = (typeof SUPPORTED)[number];

// 好みの順に見て、最初に合うものを返す。どれも合わなければ英語
export function loginLanguage(preferred: readonly string[]): LoginLanguage {
  for (const tag of preferred) {
    const match = matchLanguage(tag);
    if (match) {
      return match;
    }
  }
  return "en";
}

function matchLanguage(tag: string): LoginLanguage | undefined {
  const lower = tag.toLowerCase();
  const exact = SUPPORTED.find((s) => s.toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  const [base, ...rest] = lower.split("-");
  if (base === "zh") {
    // 繁体字(zh-Hant、台湾・香港・マカオ)とそれ以外(簡体字)に分ける
    return rest.some((s) => ["hant", "tw", "hk", "mo"].includes(s)) ? "zh-TW" : "zh-CN";
  }
  if (base === "pt") {
    return "pt-BR";
  }
  return SUPPORTED.find((s) => s === base);
}
