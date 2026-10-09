import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "react-oidc-context";
import { RouterProvider } from "react-router";

import { userManager } from "./auth.ts";
import "./index.css";
import { router } from "./router.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    // 401 / 403 を繰り返さないよう、再試行は1回にする
    queries: { retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider
      userManager={userManager}
      // ログイン後、ログイン前に開いていたパス(signinRedirect の state)に戻る
      onSigninCallback={(user) => {
        const path = typeof user?.state === "string" ? user.state : "/";
        void router.navigate(path, { replace: true });
      }}
    >
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
);
