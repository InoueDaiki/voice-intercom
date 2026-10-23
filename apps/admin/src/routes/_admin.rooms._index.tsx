import { Badge, buttonClass, LoadErrorAlert, PageHeader, Table, Td, Th } from "@voice-intercom/ui-web";
import { Link } from "react-router";

import { useRooms } from "../queries.ts";
import { errorMessage, formatDateTime, ROOM_KIND_LABELS, roomState } from "../rooms.ts";

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
      {rooms.isSuccess &&
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
