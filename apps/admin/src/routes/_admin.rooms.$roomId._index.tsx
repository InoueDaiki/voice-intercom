import { Alert, BackIcon, backLinkClass, Button, Card, ConfirmDialog, LoadErrorAlert, PageHeader } from "@voice-intercom/ui-web";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { adminApi, ApiError, type MemberRole, type Room, type RoomUpdate } from "../adminApi.ts";
import { MemberEditor } from "../MemberEditor.tsx";
import { useDeleteRoom, useMe, useRoom, useRoomMembers, useRoomMutation, useUsers } from "../queries.ts";
import { RoomForm } from "../RoomForm.tsx";
import { DELETE_INCOMPLETE_MESSAGE, errorMessage, formatDateTime, isIncomplete, ROOM_KIND_LABELS } from "../rooms.ts";

export default function RoomDetail() {
  const roomId = useParams().roomId ?? "";
  const room = useRoom(roomId);
  const me = useMe();

  const back = (
    <Link to="/rooms" className={backLinkClass}>
      <BackIcon />
      ルームの一覧
    </Link>
  );

  if (room.isPending || me.isPending) {
    return (
      <section>
        <PageHeader title="ルーム" back={back} />
        <p className="text-fg-muted">読み込み中…</p>
      </section>
    );
  }
  const current = room.data;
  // 無いルームは読み込み直しても出てこない
  const gone = room.error instanceof ApiError && room.error.status === 404;
  // 読み直しの失敗なら、持っている値で表示を続ける。無くなったときは続けない
  if (current === undefined || gone) {
    return (
      <section>
        <PageHeader title={`ルーム「${roomId}」`} back={back} />
        <LoadErrorAlert onRetry={() => void room.refetch()} retryable={!gone}>
          {room.error ? errorMessage(room.error) : "ルームを取得できません"}
        </LoadErrorAlert>
      </section>
    );
  }
  const myTenant = me.data?.tenant_id ?? undefined;
  const pending = current.connect_status === "pending";
  // 削除の途中のルームは、メンバーの一覧も編集も 404 になる。残る操作は削除の続きだけ
  const deleting = Boolean(current.deleting_at);

  return (
    <section className="grid max-w-3xl gap-8">
      <div>
        <PageHeader title={current.name} back={back} />
        <RoomSummary room={current} />
      </div>
      {deleting ? null : pending ? (
        <Alert tone="warning">
          Connect の申請中です。相手のテナントの管理者が受けると使えます。<Link to="/connect">Connect の申請</Link>
        </Alert>
      ) : (
        <>
          <RoomEdit room={current} />
          <RoomMembers room={current} myTenant={myTenant} />
          <RoomArchive room={current} />
        </>
      )}
      {/* 削除の途中のルームが見えるのは、消せる管理者だけ。503 の知らせが消えないよう、同じ場所に置き続ける */}
      {(deleting || (current.tenant_id === myTenant && !pending)) && <RoomDelete room={current} />}
    </section>
  );
}

function RoomSummary({ room }: { room: Room }) {
  return (
    <Card>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-fg-muted">ID</dt>
        <dd>
          <code>{room.room_id}</code>
        </dd>
        <dt className="text-fg-muted">種別</dt>
        <dd>
          {ROOM_KIND_LABELS[room.kind].label}
          <span className="ml-2 text-fg-muted">{ROOM_KIND_LABELS[room.kind].description}</span>
        </dd>
        <dt className="text-fg-muted">テナント</dt>
        <dd>
          <code>{room.tenant_id}</code>
          {room.connect_tenant_id && (
            <>
              {" "}と <code>{room.connect_tenant_id}</code>
            </>
          )}
        </dd>
        {room.deleting_at && (
          <>
            <dt className="text-fg-muted">削除を始めた日時</dt>
            <dd>{formatDateTime(room.deleting_at)}</dd>
          </>
        )}
        {room.archived_at && (
          <>
            <dt className="text-fg-muted">アーカイブ</dt>
            <dd>{formatDateTime(room.archived_at)}</dd>
          </>
        )}
        <dt className="text-fg-muted">作成日時</dt>
        <dd>{formatDateTime(room.created_at)}</dd>
        <dt className="text-fg-muted">更新日時</dt>
        <dd>{formatDateTime(room.updated_at)}</dd>
      </dl>
    </Card>
  );
}

function RoomEdit({ room }: { room: Room }) {
  const update = useRoomMutation(room.room_id, (body: RoomUpdate) => adminApi.updateRoom(room.room_id, body));
  return (
    <div className="grid gap-3">
      <h2>編集</h2>
      {update.isSuccess && !update.isPending && <Alert tone="success">保存しました。</Alert>}
      <RoomForm
        // 保存した後はサーバーの値でフォームを作り直す
        key={room.updated_at}
        initial={{ name: room.name, kind: room.kind }}
        submitLabel="保存"
        pending={update.isPending}
        serverError={update.error ? errorMessage(update.error) : undefined}
        onSubmit={(values) => {
          // 変えた項目だけを送る
          const body: RoomUpdate = {};
          if (values.name !== room.name) {
            body.name = values.name;
          }
          if (values.kind !== room.kind && values.kind !== "connect") {
            body.kind = values.kind;
          }
          update.mutate(body);
        }}
      />
    </div>
  );
}

// 変えられるのは自分のテナントの人だけ(Connect では相手のテナントの人を変えない)
function RoomMembers({ room, myTenant }: { room: Room; myTenant: string | undefined }) {
  const members = useRoomMembers(room.room_id);
  const users = useUsers();
  const put = useRoomMutation(room.room_id, ({ userId, role }: { userId: string; role: MemberRole }) =>
    adminApi.putRoomMember(room.room_id, userId, role),
  );
  const remove = useRoomMutation(room.room_id, (userId: string) => adminApi.deleteRoomMember(room.room_id, userId));
  const error = put.error ?? remove.error;

  // 404 は、ほかの管理者が削除を始めたとき。useRoomMembers がルームを読み直し、削除の案内に変わる
  if (members.error instanceof ApiError && members.error.status === 404) {
    return <p className="text-fg-muted">読み込み中…</p>;
  }

  return (
    <div className="grid gap-3">
      <h2>メンバー{members.data && `(${members.data.length}人)`}</h2>
      {members.isError && (
        <LoadErrorAlert onRetry={() => void members.refetch()}>
          メンバーを取得できません: {errorMessage(members.error)}
        </LoadErrorAlert>
      )}
      {users.isError && (
        <LoadErrorAlert onRetry={() => void users.refetch()}>
          ユーザー一覧を取得できません: {errorMessage(users.error)}
        </LoadErrorAlert>
      )}
      {error && <Alert tone="danger">変えられませんでした: {errorMessage(error)}</Alert>}
      <MemberEditor
        members={(members.data ?? []).map((m) => ({
          user_id: m.user_id,
          role: m.role,
          display_name: m.display_name,
          // 移す前の行(テナントが無い)は、ルームを作ったテナントの人として扱う
          locked: (m.tenant_id || room.tenant_id) !== myTenant,
        }))}
        users={users.data}
        usersPending={users.isPending || members.isPending}
        disabled={put.isPending || remove.isPending}
        onAdd={(userId) => put.mutate({ userId, role: "member" })}
        onRemove={(userId) => remove.mutate(userId)}
        onSetRole={(userId, role) => put.mutate({ userId, role })}
      />
    </div>
  );
}

function RoomArchive({ room }: { room: Room }) {
  const archive = useRoomMutation(room.room_id, () => adminApi.archiveRoom(room.room_id));
  const unarchive = useRoomMutation(room.room_id, () => adminApi.unarchiveRoom(room.room_id));
  const [confirming, setConfirming] = useState(false);
  const error = archive.error ?? unarchive.error;
  return (
    <div className="grid gap-3">
      <h2>アーカイブ</h2>
      <Card className="grid justify-items-start gap-3">
        <p className="text-sm">
          {room.archived_at
            ? "アーカイブしています。メンバーは履歴を読めますが、入ったり送ったりはできません。"
            : "アーカイブすると、今ルームにいる人は切られ、履歴を読むだけのルームになります。メンバーはそのまま残り、後で戻せます。"}
        </p>
        {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
        {room.archived_at ? (
          <Button disabled={unarchive.isPending} onClick={() => unarchive.mutate(undefined)}>
            アーカイブを戻す
          </Button>
        ) : (
          <Button disabled={archive.isPending} onClick={() => setConfirming(true)}>
            アーカイブする
          </Button>
        )}
        <ConfirmDialog
          open={confirming}
          title={`ルーム「${room.name}」をアーカイブしますか?`}
          description="今ルームにいる人は切られます。履歴は消えず、後で戻せます。"
          confirmLabel="アーカイブする"
          onConfirm={() => {
            setConfirming(false);
            archive.mutate(undefined);
          }}
          onCancel={() => setConfirming(false)}
        />
      </Card>
    </div>
  );
}

// ルームを作ったテナントの管理者だけが消せる。後始末が途中で止まったら、同じ DELETE で続きを消す
function RoomDelete({ room }: { room: Room }) {
  const navigate = useNavigate();
  const remove = useDeleteRoom(room.room_id);
  const [confirming, setConfirming] = useState(false);
  const incomplete = isIncomplete(remove.error);
  const resuming = Boolean(room.deleting_at) || incomplete;
  const run = () => remove.mutate(undefined, { onSuccess: () => void navigate("/rooms", { replace: true }) });
  return (
    <div className="grid gap-3">
      <h2>削除</h2>
      <Card tone="danger" className="grid justify-items-start gap-3">
        {resuming ? (
          <Alert tone="warning" className="w-full">
            {incomplete
              ? DELETE_INCOMPLETE_MESSAGE
              : "このルームの削除は途中で止まっています。メンバーはもう入れませんが、履歴や画像・動画が残っているかもしれません。「削除を続ける」を押すと続きを消します。"}
          </Alert>
        ) : (
          <p className="text-sm">ルームを削除すると、メンバーはこのルームに入れなくなります。</p>
        )}
        {remove.error && !incomplete && <Alert tone="danger">削除できません: {errorMessage(remove.error)}</Alert>}
        <Button variant="danger" onClick={resuming ? run : () => setConfirming(true)} disabled={remove.isPending}>
          {remove.isPending ? "削除中…" : resuming ? "削除を続ける" : "このルームを削除"}
        </Button>
        {/* 消すと元に戻せないので、名前と ID を見せて確かめる */}
        <ConfirmDialog
          open={confirming}
          tone="danger"
          title={`ルーム「${room.name}」を削除しますか?`}
          description={`ID: ${room.room_id}。今ルームにいる人は切られ、話した履歴と送った画像・動画も消えます。元に戻せません。`}
          confirmLabel="削除する"
          onConfirm={() => {
            setConfirming(false);
            run();
          }}
          onCancel={() => setConfirming(false)}
        />
      </Card>
    </div>
  );
}
