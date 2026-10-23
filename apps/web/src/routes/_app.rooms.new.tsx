import { Alert, BackIcon, backLinkClass, Button, Card, Checkbox, ChoiceGroup, Field, Input, PageHeader } from "@voice-intercom/ui-web";
import { useState, type FormEvent } from "react";
import { useAuth } from "react-oidc-context";
import { Link, useNavigate } from "react-router";

import { errorMessage, useCreateRoom, useUsers } from "../queries.ts";
import { ROOM_KINDS } from "../RoomKind.tsx";

// services/api の RoomName と同じ上限
const ROOM_NAME_MAX = 100;

// ルームを作る。作った人がオーナーになる。Connect はテナントの管理者が管理コンソールで申請する
export default function NewRoom() {
  const create = useCreateRoom();
  const users = useUsers();
  const navigate = useNavigate();
  const myIdentity = useAuth().user?.profile.sub;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"public" | "private">("private");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());

  const trimmed = name.trim();
  const invalid =
    trimmed === ""
      ? "名前を入力してください"
      : [...trimmed].length > ROOM_NAME_MAX
        ? `名前は${ROOM_NAME_MAX}文字以内にしてください`
        : undefined;
  const others = users.data?.filter((u) => u.user_id !== myIdentity) ?? [];

  const toggle = (userId: string) => {
    const next = new Set(memberIds);
    if (!next.delete(userId)) {
      next.add(userId);
    }
    setMemberIds(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) {
      return;
    }
    create.mutate(
      { name: trimmed, kind, memberIds: [...memberIds] },
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
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">一緒に入れる人(あとからでも招待できます)</legend>
            {users.isPending && <p className="text-sm text-fg-muted">読み込み中…</p>}
            {users.isError && <p className="text-sm text-danger-fg">ユーザーを取得できません: {errorMessage(users.error)}</p>}
            {users.isSuccess && others.length === 0 && <p className="text-sm text-fg-muted">テナントにほかのユーザーはいません。</p>}
            {others.length > 0 && (
              <ul className="grid max-h-60 gap-1 overflow-y-auto">
                {others.map((u) => (
                  <li key={u.user_id}>
                    <Checkbox label={u.display_name} checked={memberIds.has(u.user_id)} onChange={() => toggle(u.user_id)} />
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
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
