// 外から開かれたパスを、画面のルートに直す。
// ログインの戻り先(voiceintercom://callback)は expo-auth-session が受け取るが、Android では Expo Router にも
// 届くので、一覧へ送る(無いパスの画面を出さない)
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(?:voiceintercom:\/\/)?\/?callback(?:[/?#]|$)/.test(path) ? "/" : path;
}
