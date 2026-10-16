import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "react-oidc-context";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigate } from "react-router";

import { getUserManager } from "./auth.ts";
import "./index.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>voice-intercom 管理コンソール</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// ルートに clientLoader を置くと、ビルドで作る index.html には HydrateFallback だけが入り、
// App(ログインの処理)はブラウザでだけ描く
export function clientLoader() {
  return null;
}

export function HydrateFallback() {
  return <main className="centered">読み込み中…</main>;
}

export default function App() {
  const navigate = useNavigate();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // 401 / 403 を繰り返さないよう、再試行は1回にする
          queries: { retry: 1 },
        },
      }),
  );
  return (
    <AuthProvider
      userManager={getUserManager()}
      // ログイン後、ログイン前に開いていたパス(signinRedirect の state)に戻る
      onSigninCallback={(user) => {
        const path = typeof user?.state === "string" ? user.state : "/";
        void navigate(path, { replace: true });
      }}
    >
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </AuthProvider>
  );
}
