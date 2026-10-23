import { Badge, Button, Field, Select, Table, Td, Th } from "@voice-intercom/ui-web";
import { useState } from "react";

import type { MemberRole, User } from "./adminApi.ts";
import { LANGUAGE_LABELS } from "./rooms.ts";

export interface EditorMember {
  user_id: string;
  role: MemberRole;
  // 表示名(相手のテナントの人は、ユーザー一覧にいないので、ここから出す)
  display_name?: string | null;
  // 変えられない(Connect の相手のテナントの人)
  locked?: boolean;
}

interface Props {
  members: EditorMember[];
  // 名前と言語を引く(自分のテナントのユーザー。足せる人の候補にもなる)
  users: User[] | undefined;
  usersPending: boolean;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  // 無ければ役割を変える操作を出さない(作成のとき)
  onSetRole?: (userId: string, role: MemberRole) => void;
  disabled?: boolean;
}

// ルームのメンバーの一覧と、ユーザー一覧からの追加・削除・役割の切り替え
export function MemberEditor({ members, users, usersPending, onAdd, onRemove, onSetRole, disabled }: Props) {
  const [selected, setSelected] = useState("");
  const memberIds = new Set(members.map((m) => m.user_id));
  const byId = new Map((users ?? []).map((u) => [u.user_id, u]));
  const candidates = (users ?? [])
    .filter((u) => !memberIds.has(u.user_id))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
  const owners = members.filter((m) => m.role === "owner");
  // 最後のオーナーは外せず、メンバーにも戻せない(サーバーも 409 を返す)
  const isLastOwner = (m: EditorMember) => m.role === "owner" && owners.length === 1;

  const add = () => {
    if (selected) {
      onAdd(selected);
    }
    setSelected("");
  };

  return (
    <fieldset className="grid gap-3 rounded-lg border border-border bg-surface p-4" disabled={disabled}>
      {/* 見出しは呼び出し側が置く(人数も添える) */}
      <legend className="sr-only">メンバー({members.length}人)</legend>
      {members.length === 0 ? (
        <p className="text-sm text-fg-muted">メンバーはいません。</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>表示名</Th>
              <Th>言語</Th>
              <Th>役割</Th>
              <Th shrink aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const user = byId.get(m.user_id);
              return (
                <tr key={m.user_id}>
                  <Td>
                    {user || m.display_name ? (
                      (user?.display_name ?? m.display_name)
                    ) : (
                      // ユーザー一覧にいない(相手のテナント、読み込み中、削除されたユーザー)ときは sub を出す
                      <span className="text-fg-muted" title={m.user_id}>
                        {usersPending ? "読み込み中…" : m.locked ? `相手のテナントの人(${m.user_id})` : `不明なユーザー(${m.user_id})`}
                      </span>
                    )}
                  </Td>
                  <Td className="text-fg-muted">{user ? LANGUAGE_LABELS[user.language] : ""}</Td>
                  <Td>
                    {m.role === "owner" ? <Badge tone="primary">オーナー</Badge> : <span className="text-fg-muted">メンバー</span>}
                    {m.locked && (
                      <Badge tone="neutral" className="ml-1">
                        相手のテナント
                      </Badge>
                    )}
                  </Td>
                  <Td shrink>
                    {!m.locked && (
                      <span className="flex gap-1">
                        {onSetRole && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isLastOwner(m)}
                            onClick={() => onSetRole(m.user_id, m.role === "owner" ? "member" : "owner")}
                          >
                            {m.role === "owner" ? "メンバーに戻す" : "オーナーにする"}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={isLastOwner(m)} onClick={() => onRemove(m.user_id)}>
                          外す
                        </Button>
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="追加するユーザー(自分のテナントの人)" className="min-w-60 flex-1">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!users || candidates.length === 0}>
            <option value="">
              {usersPending ? "読み込み中…" : candidates.length === 0 ? "追加できるユーザーはいません" : "選んでください"}
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
