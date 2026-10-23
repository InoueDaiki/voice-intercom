import { Alert, Button, buttonClass, PageHeader, Table, Td, Th } from "@voice-intercom/ui-web";
import { Link } from "react-router";

import { useRooms } from "../queries.ts";
import { errorMessage, formatDateTime } from "../rooms.ts";

export default function RoomList() {
  const rooms = useRooms();

  return (
    <section>
      <PageHeader
        title="ルーム"
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
                <Th shrink>ID</Th>
                <Th align="end" shrink>
                  人数
                </Th>
                <Th shrink>更新日時</Th>
              </tr>
            </thead>
            <tbody>
              {[...rooms.data]
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .map((room) => (
                  <tr key={room.room_id}>
                    {/* 名前の列は、幅の狭い画面でも読める幅を取る */}
                    <Td className="min-w-40">
                      <Link to={`/rooms/${encodeURIComponent(room.room_id)}`} className="font-medium">
                        {room.name}
                      </Link>
                    </Td>
                    <Td shrink>
                      <code>{room.room_id}</code>
                    </Td>
                    <Td align="end" shrink>
                      {room.member_ids.length}
                    </Td>
                    <Td shrink className="text-fg-muted">
                      {formatDateTime(room.updated_at)}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ))}
    </section>
  );
}
