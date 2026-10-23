import { Alert, BackIcon, backLinkClass, Button, Card, ConfirmDialog, LoadErrorAlert, PageHeader } from "@voice-intercom/ui-web";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError, type RoomUpdate } from "../adminApi.ts";
import { useDeleteRoom, useRoom, useUpdateRoom } from "../queries.ts";
import { RoomForm } from "../RoomForm.tsx";
import { errorMessage, formatDateTime } from "../rooms.ts";

export default function RoomDetail() {
  const roomId = useParams().roomId ?? "";
  const navigate = useNavigate();
  const room = useRoom(roomId);
  const update = useUpdateRoom(roomId);
  const remove = useDeleteRoom(roomId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const back = (
    <Link to="/rooms" className={backLinkClass}>
      <BackIcon />
      ルームの一覧
    </Link>
  );

  if (room.isPending) {
    return (
      <section>
        <PageHeader title="ルーム" back={back} />
        <p className="text-fg-muted">読み込み中…</p>
      </section>
    );
  }
  if (room.isError) {
    return (
      <section>
        <PageHeader title={`ルーム「${roomId}」`} back={back} />
        <LoadErrorAlert
          onRetry={() => void room.refetch()}
          // 無いルームは読み込み直しても出てこない
          retryable={!(room.error instanceof ApiError && room.error.status === 404)}
        >
          {errorMessage(room.error)}
        </LoadErrorAlert>
      </section>
    );
  }

  const current = room.data;

  const onDelete = () => {
    setConfirmingDelete(false);
    remove.mutate(undefined, { onSuccess: () => void navigate("/rooms", { replace: true }) });
  };

  return (
    <section className="grid max-w-2xl gap-8">
      <div>
        <PageHeader title={current.name} back={back} />
        <Card>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-fg-muted">ID</dt>
            <dd>
              <code>{current.room_id}</code>
            </dd>
            <dt className="text-fg-muted">作成日時</dt>
            <dd>{formatDateTime(current.created_at)}</dd>
            <dt className="text-fg-muted">更新日時</dt>
            <dd>{formatDateTime(current.updated_at)}</dd>
          </dl>
        </Card>
      </div>

      <div className="grid gap-3">
        <h2>編集</h2>
        {update.isSuccess && !update.isPending && <Alert tone="success">保存しました。</Alert>}
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
      </div>

      <div className="grid gap-3">
        <h2>削除</h2>
        <Card tone="danger" className="grid justify-items-start gap-3">
          <p className="text-sm">ルームを削除すると、メンバーはこのルームに入れなくなります。</p>
          {remove.error && <Alert tone="danger">削除できません: {errorMessage(remove.error)}</Alert>}
          <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={remove.isPending}>
            {remove.isPending ? "削除中…" : "このルームを削除"}
          </Button>
          {/* 消すと元に戻せないので、名前と ID を見せて確かめる */}
          <ConfirmDialog
            open={confirmingDelete}
            tone="danger"
            title={`ルーム「${current.name}」を削除しますか?`}
            description={`ID: ${current.room_id}。今ルームにいる人は切られ、話した履歴と送った画像・動画も消えます。元に戻せません。`}
            confirmLabel="削除する"
            onConfirm={onDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        </Card>
      </div>
    </section>
  );
}
