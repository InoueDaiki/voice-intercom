import { Link } from "react-router";

import { useRooms } from "../queries.ts";
import { errorMessage, formatDateTime } from "../rooms.ts";

export default function RoomList() {
  const rooms = useRooms();

  return (
    <section>
      <div className="page-header">
        <h1>ルーム</h1>
        <Link className="button" to="/rooms/new">
          ルームを作る
        </Link>
      </div>
      {rooms.isPending && <p>読み込み中…</p>}
      {rooms.isError && (
        <div className="error" role="alert">
          <p>ルームの一覧を取得できません: {errorMessage(rooms.error)}</p>
          <button type="button" onClick={() => void rooms.refetch()}>
            再読み込み
          </button>
        </div>
      )}
      {rooms.isSuccess &&
        (rooms.data.length === 0 ? (
          <p className="muted">ルームはまだありません。</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名前</th>
                <th>ID</th>
                <th className="num">人数</th>
                <th>更新日時</th>
              </tr>
            </thead>
            <tbody>
              {[...rooms.data]
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .map((room) => (
                  <tr key={room.room_id}>
                    <td>
                      <Link to={`/rooms/${encodeURIComponent(room.room_id)}`}>{room.name}</Link>
                    </td>
                    <td>
                      <code>{room.room_id}</code>
                    </td>
                    <td className="num">{room.member_ids.length}</td>
                    <td>{formatDateTime(room.updated_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
    </section>
  );
}
