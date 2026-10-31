import { LANGUAGE_LABELS } from "@voice-intercom/client-core";
import { errorMessage, roomNameError, useCreateRoom, useUsers } from "@voice-intercom/client-react";
import { Alert, BackIcon, backLinkClass, Button, Card, CheckboxList, ChoiceGroup, Field, Input, PageHeader } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";
import { useAuth } from "react-oidc-context";
import { Link, useNavigate } from "react-router";

import { ROOM_KINDS } from "../RoomKind.tsx";

// ルームを作る。作った人がオーナーになる。Connect はテナントの管理者が管理コンソールで申請する
export default function NewRoom() {
  const create = useCreateRoom();
  const users = useUsers();
  const navigate = useNavigate();
  const myIdentity = useAuth().user?.profile.sub;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"public" | "private">("private");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const trimmed = name.trim();
  const invalid = roomNameError(trimmed);
  // 名前の順に並べ、同じ名前の人を見分けられるよう話す言語を添える
  const others = (users.data ?? [])
    .filter((u) => u.user_id !== myIdentity)
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"))
    .map((u) => ({ value: u.user_id, label: u.display_name, description: LANGUAGE_LABELS[u.language] }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) {
      return;
    }
    create.mutate(
      { name: trimmed, kind, memberIds },
      { onSuccess: (room) => void navigate(`/rooms/${encodeURIComponent(room.room_id)}`, { replace: true }) },
    );
  };

  return (
    <section className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <PageHeader
        title="ルームを作る"
        back={
          <Link to="/" className={backLinkClass}>
            <BackIcon />
            ルームの一覧
          </Link>
        }
        description="作った人がオーナーになります。オーナーはメンバーを招待でき、ほかの人をオーナーにもできます。"
      />
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Card className="grid gap-4">
          <Field label="名前" error={name !== "" ? invalid : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ChoiceGroup
            legend="種類"
            name="kind"
            value={kind}
            onChange={setKind}
            options={(["private", "public"] as const).map((k) => {
              const { label, description, Icon } = ROOM_KINDS[k];
              return { value: k, label, description, icon: <Icon aria-hidden="true" className="size-4" /> };
            })}
          />
          {users.isPending && <p className="text-sm text-fg-muted">ユーザーを読み込み中…</p>}
          {users.isError && <p className="text-sm text-danger-fg">ユーザーを取得できません: {errorMessage(users.error)}</p>}
          {users.data && (
            <CheckboxList
              legend="一緒に入れる人"
              hint="あとからでも招待できます。"
              options={others}
              value={memberIds}
              onChange={setMemberIds}
              selectedLabel={(n) => `${n}人を選んでいます`}
              emptyMessage="テナントにほかのユーザーはいません。"
              noMatchMessage={(q) => `「${q}」に当てはまる人はいません。`}
            />
          )}
        </Card>
        {create.isError && <Alert tone="danger">作れませんでした: {errorMessage(create.error)}</Alert>}
        <div>
          <Button type="submit" variant="primary" disabled={create.isPending || invalid !== undefined}>
            作る
          </Button>
        </div>
      </form>
    </section>
  );
}
