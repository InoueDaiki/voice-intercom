import { Alert, Button, Field, Select, Table, Td, Th } from "@voice-intercom/ui-web";
import { useState } from "react";

import { errorMessage, LANGUAGE_LABELS } from "./rooms.ts";
import { useUsers } from "./queries.ts";

interface Props {
  memberIds: string[];
  onChange: (memberIds: string[]) => void;
  disabled?: boolean;
}

// ルームのメンバーの一覧と、ユーザー一覧からの追加・削除
export function MemberEditor({ memberIds, onChange, disabled }: Props) {
  const users = useUsers();
  const [selected, setSelected] = useState("");

  const byId = new Map((users.data ?? []).map((u) => [u.user_id, u]));
  const candidates = (users.data ?? [])
    .filter((u) => !memberIds.includes(u.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));

  const add = () => {
    if (selected && !memberIds.includes(selected)) {
      onChange([...memberIds, selected]);
    }
    setSelected("");
  };

  return (
    <fieldset className="grid gap-3 rounded-lg border border-border bg-surface p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">メンバー({memberIds.length}人)</legend>
      {users.isError && <Alert tone="danger">ユーザー一覧を取得できません: {errorMessage(users.error)}</Alert>}
      {memberIds.length === 0 ? (
        <p className="text-sm text-fg-muted">メンバーはいません。</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>表示名</Th>
              <Th>言語</Th>
              <Th shrink aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {memberIds.map((id) => {
              const user = byId.get(id);
              return (
                <tr key={id}>
                  <Td>
                    {user ? (
                      user.display_name
                    ) : (
                      // ユーザー一覧にいない(読み込み中か、削除されたユーザー)ときは sub を出す
                      <span className="text-fg-muted" title={id}>
                        {users.isPending ? "読み込み中…" : `不明なユーザー(${id})`}
                      </span>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{user ? LANGUAGE_LABELS[user.language] : ""}</Td>
                  <Td shrink>
                    <Button size="sm" variant="ghost" onClick={() => onChange(memberIds.filter((m) => m !== id))}>
                      外す
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="追加するユーザー" className="min-w-60 flex-1">
          <Select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={!users.isSuccess || candidates.length === 0}
          >
            <option value="">
              {users.isPending
                ? "読み込み中…"
                : candidates.length === 0
                  ? "追加できるユーザーはいません"
                  : "選んでください"}
            </option>
            {candidates.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name}({LANGUAGE_LABELS[u.language]})
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={add} disabled={!selected}>
          追加
        </Button>
      </div>
    </fieldset>
  );
}
