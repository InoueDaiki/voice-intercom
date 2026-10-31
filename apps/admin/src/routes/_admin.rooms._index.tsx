import { Badge, Button, buttonClass, LoadErrorAlert, PageHeader, Table, Td, Th } from "@voice-intercom/ui-web";
import { Link } from "react-router";

import type { Room } from "../adminApi.ts";
import { useDeleteRoom, useRooms } from "../queries.ts";
import { DELETE_INCOMPLETE_MESSAGE, errorMessage, formatDateTime, isIncomplete, ROOM_KIND_LABELS, roomState } from "../rooms.ts";

// 自分のテナントに関わるルーム(作ったものと、相手になっている Connect)
export default function RoomList() {
  const rooms = useRooms();

  return (
    <section>
      <PageHeader
        title="ルーム"
        description="自分のテナントのルームと、ほかのテナントとの Connect のルームです。"
        actions={
          <Link className={buttonClass({ variant: "primary" })} to="/rooms/new">
            ルームを作る
          </Link>
        }
      />
      {rooms.isPending && <p className="text-fg-muted">読み込み中…</p>}
      {rooms.isError && (
        <LoadErrorAlert onRetry={() => void rooms.refetch()}>
          ルームの一覧を取得できません: {errorMessage(rooms.error)}
        </LoadErrorAlert>
      )}
      {rooms.data &&
        (rooms.data.length === 0 ? (
          <p className="text-fg-muted">ルームはまだありません。</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名前</Th>
                <Th shrink>種別</Th>
                <Th align="end" shrink>
                  人数
                </Th>
                <Th align="end" shrink>
                  オーナー
                </Th>
                <Th shrink>更新日時</Th>
              </tr>
            </thead>
            <tbody>
              {[...rooms.data]
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .map((room) => {
                  const state = roomState(room);
                  return (
                    <tr key={room.room_id}>
                      {/* 名前の列は、幅の狭い画面でも読める幅を取る */}
                      <Td className="min-w-40">
                        <Link to={`/rooms/${encodeURIComponent(room.room_id)}`} className="font-medium">
                          {room.name}
                        </Link>
                        {state === "deleting" && (
                          <Badge tone="danger" className="ml-2">
                            削除中
                          </Badge>
                        )}
                        {state === "pending" && (
                          <Badge tone="warning" className="ml-2">
                            申請中
                          </Badge>
                        )}
                        {state === "archived" && (
                          <Badge tone="neutral" className="ml-2">
                            アーカイブ
                          </Badge>
                        )}
                        {state === "deleting" && <ContinueDelete room={room} />}
                      </Td>
                      <Td shrink>{ROOM_KIND_LABELS[room.kind].label}</Td>
                      <Td align="end" shrink>
                        {room.member_ids.length}
                      </Td>
                      <Td align="end" shrink>
                        {room.owner_ids.length}
                      </Td>
                      <Td shrink className="text-fg-muted">
                        {formatDateTime(room.updated_at)}
                      </Td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        ))}
    </section>
  );
}

// 削除が途中で止まったルームの、続きの操作。確認は最初の削除で済んでいるので、もう聞かない
function ContinueDelete({ room }: { room: Room }) {
  const remove = useDeleteRoom(room.room_id);
  return (
    <div className="mt-1 grid justify-items-start gap-1">
      <span className="text-xs text-fg-muted">
        {isIncomplete(remove.error) ? DELETE_INCOMPLETE_MESSAGE : "削除が途中で止まっています。"}
      </span>
      {remove.error && !isIncomplete(remove.error) && (
        <span className="text-xs text-danger-fg">続けられません: {errorMessage(remove.error)}</span>
      )}
      <Button size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
        {remove.isPending ? "削除中…" : "削除を続ける"}
      </Button>
    </div>
  );
}
