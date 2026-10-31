// 外から開かれたパスを、画面のルートに直す。
// ログインとログアウトの戻り先(voiceintercom://callback、voiceintercom://signout)は expo-auth-session と
// expo-web-browser が受け取るが、Android では Expo Router にも届くので、一覧へ送る(無いパスの画面を出さない)
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(?:voiceintercom:\/\/)?\/?(?:callback|signout)(?:[/?#]|$)/.test(path) ? "/" : path;
}
