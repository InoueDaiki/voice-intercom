import { useQuery } from "@tanstack/react-query";

import { api } from "../api.ts";

export function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/health");
      if (error) {
        throw new Error("API がエラーを返した");
      }
      return data;
    },
  });

  return (
    <section>
      <h1>ホーム</h1>
      <dl>
        <dt>API</dt>
        <dd>
          {health.isPending && "確認中…"}
          {health.isError && `接続できません(${health.error.message})`}
          {health.isSuccess && health.data.status}
        </dd>
      </dl>
    </section>
  );
}
