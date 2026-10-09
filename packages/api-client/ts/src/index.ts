// REST API のクライアント。型は src/gen/schema.ts(生成物)から取る
import createFetchClient from "openapi-fetch";

import type { components, paths } from "./gen/schema.ts";

export type Schemas = components["schemas"];
export type { paths };

export interface ApiClientOptions {
  baseUrl: string;
  // 呼び出しのたびにアクセストークンを返す(更新はアプリ側の OIDC クライアントに任せる)
  getAccessToken: () => Promise<string>;
}

export function createApiClient({ baseUrl, getAccessToken }: ApiClientOptions) {
  const client = createFetchClient<paths>({ baseUrl });
  client.use({
    async onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${await getAccessToken()}`);
      return request;
    },
  });
  return client;
}
