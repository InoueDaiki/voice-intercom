import { useQuery } from "@tanstack/react-query";
import { Badge, Card, PageHeader } from "@voice-intercom/ui-web";

import { api } from "../api.ts";

export default function Home() {
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
      <PageHeader title="ホーム" />
      <Card className="max-w-md">
        <dl className="flex items-center justify-between gap-4 text-sm">
          <dt className="font-medium">API</dt>
          <dd>
            {health.isPending && <Badge>確認中…</Badge>}
            {health.isError && <Badge tone="danger">接続できません({health.error.message})</Badge>}
            {health.isSuccess && <Badge tone="success">{health.data.status}</Badge>}
          </dd>
        </dl>
      </Card>
    </section>
  );
}
