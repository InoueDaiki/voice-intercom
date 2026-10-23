import { Alert, Badge, Button, buttonClass, PageHeader, Table, Td, Th } from "@voice-intercom/ui-web";
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
        <Alert
          tone="danger"
          action={
            <Button size="sm" onClick={() => void rooms.refetch()}>
              再読み込み
            </Button>
          }
        >
          ルームの一覧を取得できません: {errorMessage(rooms.error)}
        </Alert>
      )}
      {rooms.isSuccess &&
        (rooms.data.length === 0 ? (
          <p className="text-fg-muted">ルームはまだありません。</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>名前</Th>
                <Th>種別</Th>
                <Th align="end">人数</Th>
                <Th align="end">オーナー</Th>
                <Th>更新日時</Th>
              </tr>
            </thead>
            <tbody>
              {[...rooms.data]
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .map((room) => {
                  const state = roomState(room);
                  return (
                    <tr key={room.room_id}>
                      <Td>
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
                      <Td>{ROOM_KIND_LABELS[room.kind].label}</Td>
                      <Td align="end">{room.member_ids.length}</Td>
                      <Td align="end">{room.owner_ids.length}</Td>
                      <Td className="text-fg-muted">{formatDateTime(room.updated_at)}</Td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        ))}
    </section>
  );
}
