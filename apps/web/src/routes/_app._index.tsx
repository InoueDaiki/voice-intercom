import { Link } from "react-router";

import { errorMessage, useRooms } from "../queries.ts";

// 自分がメンバーのルームの一覧
export default function RoomList() {
  const rooms = useRooms();
  return (
    <section>
      <h1>ルーム</h1>
      {rooms.isPending && <p>読み込み中…</p>}
      {rooms.isError && (
        <div className="error" role="alert">
          <p>ルームの一覧を取得できません: {errorMessage(rooms.error)}</p>
          <button type="button" onClick={() => void rooms.refetch()}>
            再読み込み
          </button>
        </div>
      )}
      {rooms.isSuccess && rooms.data.length === 0 && (
        <p className="muted">入れるルームがありません。管理者にメンバーに加えてもらってください。</p>
      )}
      {rooms.isSuccess && rooms.data.length > 0 && (
        <ul className="room-list">
          {rooms.data.map((room) => (
            <li key={room.room_id}>
              <Link to={`/rooms/${encodeURIComponent(room.room_id)}`}>
                <span className="room-name">{room.name}</span>
                <span className="muted">{room.member_ids.length}人</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
