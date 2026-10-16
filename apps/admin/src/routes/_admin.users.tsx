import { useId, useState } from "react";
import { Link } from "react-router";

import { ApiError, type Room } from "../adminApi.ts";
import { useRooms, useUsers } from "../queries.ts";
import { errorMessage, formatDateTime, LANGUAGE_LABELS } from "../rooms.ts";

export default function UserList() {
  const users = useUsers();
  const rooms = useRooms();
  const [filter, setFilter] = useState("");
  const filterId = useId();

  // user_id → 所属しているルーム(ルーム一覧の member_ids と突き合わせる)
  const roomsByUser = new Map<string, Room[]>();
  for (const room of rooms.data ?? []) {
    for (const id of room.member_ids) {
      roomsByUser.set(id, [...(roomsByUser.get(id) ?? []), room]);
    }
  }

  const needle = filter.trim().toLocaleLowerCase();
  const shown = [...(users.data ?? [])]
    .filter((u) => needle === "" || u.display_name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));

  return (
    <section>
      <h1>ユーザー</h1>
      <p className="muted">アプリでプロフィール(表示名と言語)を登録したユーザーです。</p>
      {users.isPending && <p>読み込み中…</p>}
      {users.isError && (
        <div className="error" role="alert">
          <p>
            ユーザーの一覧を取得できません:{" "}
            {users.error instanceof ApiError && users.error.status === 403
              ? "ユーザーの一覧を見る権限がありません。"
              : errorMessage(users.error)}
          </p>
          <button type="button" onClick={() => void users.refetch()}>
            再読み込み
          </button>
        </div>
      )}
      {users.isSuccess &&
        (users.data.length === 0 ? (
          <p className="muted">登録したユーザーはまだいません。</p>
        ) : (
          <>
            <div className="row filters">
              <label htmlFor={filterId}>名前で絞り込む</label>
              <input
                id={filterId}
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="表示名の一部"
              />
              <span className="muted">
                {users.data.length}人中 {shown.length}人
              </span>
            </div>
            {rooms.isError && (
              <p className="error" role="alert">
                ルームの一覧を取得できないため、所属しているルームを出せません: {errorMessage(rooms.error)}
              </p>
            )}
            {shown.length === 0 ? (
              <p className="muted">「{filter}」に当てはまるユーザーはいません。</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>表示名</th>
                    <th>言語</th>
                    <th>ユーザー ID</th>
                    <th>登録日時</th>
                    <th>所属しているルーム</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((user) => {
                    const joined = roomsByUser.get(user.user_id) ?? [];
                    return (
                      <tr key={user.user_id}>
                        <td>{user.display_name}</td>
                        <td>{LANGUAGE_LABELS[user.language]}</td>
                        <td>
                          <code>{user.user_id}</code>
                        </td>
                        <td>{formatDateTime(user.created_at)}</td>
                        <td>
                          {rooms.isPending && <span className="muted">読み込み中…</span>}
                          {rooms.isSuccess &&
                            (joined.length === 0 ? (
                              <span className="muted">なし</span>
                            ) : (
                              <ul className="inline-list">
                                {joined.map((room) => (
                                  <li key={room.room_id}>
                                    <Link to={`/rooms/${encodeURIComponent(room.room_id)}`}>{room.name}</Link>
                                  </li>
                                ))}
                              </ul>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        ))}
    </section>
  );
}
