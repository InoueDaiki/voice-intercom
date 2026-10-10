import { useId, useState } from "react";

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
  const selectId = useId();

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
    <fieldset className="members" disabled={disabled}>
      <legend>メンバー({memberIds.length}人)</legend>
      {users.isError && <p className="error">ユーザー一覧を取得できません: {errorMessage(users.error)}</p>}
      {memberIds.length === 0 ? (
        <p className="muted">メンバーはいません。</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>表示名</th>
              <th>言語</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {memberIds.map((id) => {
              const user = byId.get(id);
              return (
                <tr key={id}>
                  <td>
                    {user ? (
                      user.display_name
                    ) : (
                      // ユーザー一覧にいない(読み込み中か、削除されたユーザー)ときは sub を出す
                      <span className="muted" title={id}>
                        {users.isPending ? "読み込み中…" : `不明なユーザー(${id})`}
                      </span>
                    )}
                  </td>
                  <td>{user ? LANGUAGE_LABELS[user.language] : ""}</td>
                  <td className="actions">
                    <button type="button" onClick={() => onChange(memberIds.filter((m) => m !== id))}>
                      外す
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="row">
        <label htmlFor={selectId}>追加するユーザー</label>
        <select
          id={selectId}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!users.isSuccess || candidates.length === 0}
        >
          <option value="">
            {users.isPending ? "読み込み中…" : candidates.length === 0 ? "追加できるユーザーはいません" : "選んでください"}
          </option>
          {candidates.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.display_name}({LANGUAGE_LABELS[u.language]})
            </option>
          ))}
        </select>
        <button type="button" onClick={add} disabled={!selected}>
          追加
        </button>
      </div>
    </fieldset>
  );
}
