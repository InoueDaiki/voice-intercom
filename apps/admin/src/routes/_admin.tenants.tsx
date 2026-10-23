import { Alert, Button, Card, Field, Input, PageHeader, Table, Td, Th } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";

import { useCreateTenant, useTenants } from "../queries.ts";
import { errorMessage, formatDateTime } from "../rooms.ts";

// services/api の TenantId と同じ制約
const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

// テナントの一覧と作成(運営者)。ユーザーの所属はユーザーの画面で決める
export default function Tenants() {
  const tenants = useTenants();
  return (
    <section className="grid max-w-3xl gap-8">
      <PageHeader title="テナント" description="テナントを作り、ユーザーの画面でユーザーをテナントに入れます。" />
      <TenantForm />
      {tenants.isPending && <p className="text-fg-muted">読み込み中…</p>}
      {tenants.isError && <Alert tone="danger">テナントを取得できません: {errorMessage(tenants.error)}</Alert>}
      {tenants.isSuccess &&
        (tenants.data.length === 0 ? (
          <p className="text-fg-muted">テナントはまだありません。</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名前</Th>
                <Th>ID</Th>
                <Th>作成日時</Th>
              </tr>
            </thead>
            <tbody>
              {tenants.data.map((t) => (
                <tr key={t.tenant_id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td>
                    <code>{t.tenant_id}</code>
                  </Td>
                  <Td className="text-fg-muted">{formatDateTime(t.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ))}
    </section>
  );
}

function TenantForm() {
  const create = useCreateTenant();
  const [tenantId, setTenantId] = useState("");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const idError = TENANT_ID_PATTERN.test(tenantId)
    ? undefined
    : "英小文字・数字・ハイフンの 2〜32 文字にしてください(先頭と末尾はハイフンにしない)";
  const nameError = name.trim() === "" ? "名前を入力してください" : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (idError || nameError) {
      return;
    }
    create.mutate(
      { tenant_id: tenantId, name: name.trim() },
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
        <h2>テナントを作る</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="ID"
            hint="Connect の申請で相手に伝える ID です。作った後は変えられません。"
            error={touched ? idError : undefined}
          >
            <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="名前" error={touched ? nameError : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {create.isError && <Alert tone="danger">作れません: {errorMessage(create.error)}</Alert>}
        <div>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            作る
          </Button>
        </div>
      </Card>
    </form>
  );
}
