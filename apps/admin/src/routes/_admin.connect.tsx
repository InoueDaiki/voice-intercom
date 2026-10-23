import { Alert, Button, Card, Field, Input, PageHeader, Table, Td, Th } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";

import { adminApi, type ConnectRequest } from "../adminApi.ts";
import { useConnectMutation, useConnectRequests } from "../queries.ts";
import { errorMessage, formatDateTime, validateRoomName } from "../rooms.ts";

// Connect の申請(設計メモの「Connect の申請」)。相手のテナントの ID を打って申請し、
// 相手の管理者が受けると Connect のルームができる。申請した人と受けた人がオーナーになり、
// それぞれ自分のテナントのメンバーを出し入れする
export default function Connect() {
  const requests = useConnectRequests();
  const incoming = requests.data?.filter((r) => r.direction === "incoming") ?? [];
  const outgoing = requests.data?.filter((r) => r.direction === "outgoing") ?? [];

  return (
    <section className="grid max-w-3xl gap-8">
      <PageHeader
        title="Connect"
        description="ほかのテナントの人と一緒に使うルームを、相手のテナントに申請します。相手の管理者が受けるとルームができ、申請した人と受けた人がオーナーになります。"
      />
      <RequestForm />
      {requests.isPending && <p className="text-fg-muted">読み込み中…</p>}
      {requests.isError && <Alert tone="danger">申請を取得できません: {errorMessage(requests.error)}</Alert>}
      {requests.isSuccess && (
        <>
          <div className="grid gap-3">
            <h2>届いている申請</h2>
            {incoming.length === 0 ? (
              <p className="text-sm text-fg-muted">届いている申請はありません。</p>
            ) : (
              <RequestTable requests={incoming} />
            )}
          </div>
          <div className="grid gap-3">
            <h2>出している申請</h2>
            {outgoing.length === 0 ? (
              <p className="text-sm text-fg-muted">出している申請はありません。</p>
            ) : (
              <RequestTable requests={outgoing} />
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RequestForm() {
  const [tenantId, setTenantId] = useState("");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const create = useConnectMutation((body: { tenant_id: string; name: string }) => adminApi.createConnectRequest(body));
  const nameError = validateRoomName(name);
  const tenantError = tenantId.trim() === "" ? "相手のテナントの ID を入力してください" : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameError || tenantError) {
      return;
    }
    create.mutate(
      { tenant_id: tenantId.trim(), name: name.trim() },
      {
        onSuccess: () => {
          setTenantId("");
          setName("");
          setTouched(false);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <Card className="grid gap-4">
        <h2>申請する</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="相手のテナントの ID" hint="相手の管理者に聞いてください。" error={touched ? tenantError : undefined}>
            <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="ルームの名前" error={touched ? nameError : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {create.isError && <Alert tone="danger">申請できません: {errorMessage(create.error)}</Alert>}
        {create.isSuccess && <Alert tone="success">申請しました。相手の管理者が受けるとルームができます。</Alert>}
        <div>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            申請する
          </Button>
        </div>
      </Card>
    </form>
  );
}

function RequestTable({ requests }: { requests: ConnectRequest[] }) {
  const accept = useConnectMutation((roomId: string) => adminApi.acceptConnectRequest(roomId));
  const remove = useConnectMutation((roomId: string) => adminApi.deleteConnectRequest(roomId));
  const error = accept.error ?? remove.error;
  const busy = accept.isPending || remove.isPending;
  return (
    <>
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      <Table>
        <thead>
          <tr>
            <Th>ルームの名前</Th>
            <Th>申請したテナント</Th>
            <Th>相手のテナント</Th>
            <Th>申請日時</Th>
            <Th shrink aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.room.room_id}>
              <Td className="font-medium">{r.room.name}</Td>
              <Td>{r.from_tenant_name}</Td>
              <Td>{r.to_tenant_name}</Td>
              <Td className="text-fg-muted">{formatDateTime(r.room.created_at)}</Td>
              <Td shrink>
                <span className="flex gap-1">
                  {r.direction === "incoming" && (
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => accept.mutate(r.room.room_id)}>
                      受ける
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove.mutate(r.room.room_id)}>
                    {r.direction === "incoming" ? "断る" : "取り下げる"}
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
