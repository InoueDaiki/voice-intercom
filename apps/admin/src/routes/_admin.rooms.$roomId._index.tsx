import { Link, useNavigate, useParams } from "react-router";

import type { RoomUpdate } from "../adminApi.ts";
import { useDeleteRoom, useRoom, useUpdateRoom } from "../queries.ts";
import { RoomForm } from "../RoomForm.tsx";
import { errorMessage, formatDateTime } from "../rooms.ts";

export default function RoomDetail() {
  const roomId = useParams().roomId ?? "";
  const navigate = useNavigate();
  const room = useRoom(roomId);
  const update = useUpdateRoom(roomId);
  const remove = useDeleteRoom(roomId);

  const back = (
    <p>
      <Link to="/rooms">← ルームの一覧</Link>
    </p>
  );

  if (room.isPending) {
    return (
      <section>
        {back}
        <p>読み込み中…</p>
      </section>
    );
  }
  if (room.isError) {
    return (
      <section>
        {back}
        <h1>ルーム「{roomId}」</h1>
        <div className="error" role="alert">
          <p>{errorMessage(room.error)}</p>
          <button type="button" onClick={() => void room.refetch()}>
            再読み込み
          </button>
        </div>
      </section>
    );
  }

  const current = room.data;

  const onDelete = () => {
    // 消すと元に戻せないので、名前と ID を見せて確かめる
    if (!window.confirm(`ルーム「${current.name}」(${current.room_id})を削除します。元に戻せません。よろしいですか?`)) {
      return;
    }
    remove.mutate(undefined, { onSuccess: () => void navigate("/rooms", { replace: true }) });
  };

  return (
    <section>
      {back}
      <h1>{current.name}</h1>
      <dl className="meta">
        <dt>ID</dt>
        <dd>
          <code>{current.room_id}</code>
        </dd>
        <dt>作成日時</dt>
        <dd>{formatDateTime(current.created_at)}</dd>
        <dt>更新日時</dt>
        <dd>{formatDateTime(current.updated_at)}</dd>
      </dl>
      <p>
        <Link className="button" to={`/rooms/${encodeURIComponent(current.room_id)}/timeline`}>
          履歴を見る
        </Link>
      </p>

      <h2>編集</h2>
      {update.isSuccess && !update.isPending && <p className="success">保存しました。</p>}
      <RoomForm
        // 保存した後はサーバーの値でフォームを作り直す
        key={current.updated_at}
        initial={current}
        editableId={false}
        submitLabel="保存"
        pending={update.isPending}
        serverError={update.error ? errorMessage(update.error) : undefined}
        onSubmit={(values) => {
          // 変えた項目だけを送る
          const body: RoomUpdate = {};
          if (values.name !== current.name) {
            body.name = values.name;
          }
          if (values.member_ids.join("\n") !== current.member_ids.join("\n")) {
            body.member_ids = values.member_ids;
          }
          update.mutate(body);
        }}
      />

      <h2>削除</h2>
      <div className="danger">
        <p>ルームを削除すると、メンバーはこのルームに入れなくなります。</p>
        {remove.error && (
          <p className="error" role="alert">
            削除できません: {errorMessage(remove.error)}
          </p>
        )}
        <button type="button" className="danger-button" onClick={onDelete} disabled={remove.isPending}>
          {remove.isPending ? "削除中…" : "このルームを削除"}
        </button>
      </div>
    </section>
  );
}
