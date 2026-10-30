// API のクライアント(client-core の createClientApi)を画面に渡す。ログインの仕方が端末で違うので、
// 各アプリが作って ApiProvider で渡す
import type { ClientApi } from "@voice-intercom/client-core";
import { createContext, type ReactNode, useContext } from "react";

const ApiContext = createContext<ClientApi | undefined>(undefined);

export function ApiProvider({ api, children }: { api: ClientApi; children: ReactNode }) {
  return <ApiContext value={api}>{children}</ApiContext>;
}

export function useApi(): ClientApi {
  const api = useContext(ApiContext);
  if (!api) {
    throw new Error("ApiProvider の中で使う");
  }
  return api;
}
