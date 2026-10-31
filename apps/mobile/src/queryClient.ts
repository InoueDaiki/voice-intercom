// データの取得のキャッシュ。画面(RootLayout)とログイン(auth.ts)で同じものを使い、ログアウトで前の人のデータを消す
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    // 401 / 403 を繰り返さないよう、再試行は1回にする
    queries: { retry: 1 },
  },
});
