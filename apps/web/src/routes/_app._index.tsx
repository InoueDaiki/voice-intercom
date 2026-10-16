import { Alert, Button, PageHeader } from "@voice-intercom/ui-web";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { errorMessage, useRooms } from "../queries.ts";

// 自分がメンバーのルームの一覧
export default function RoomList() {
  const rooms = useRooms();
  return (
    <section className="mx-auto max-w-2xl">
      <PageHeader title="ルーム" />
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
      {rooms.isSuccess && rooms.data.length === 0 && (
        <p className="text-fg-muted">入れるルームがありません。管理者にメンバーに加えてもらってください。</p>
      )}
      {rooms.isSuccess && rooms.data.length > 0 && (
        <ul className="grid gap-2">
          {rooms.data.map((room) => (
            <li key={room.room_id}>
              <Link
                to={`/rooms/${encodeURIComponent(room.room_id)}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-fg no-underline transition-colors hover:border-primary hover:no-underline"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{room.name}</span>
                <span className="text-sm text-fg-muted">{room.member_ids.length}人</span>
                <ChevronRight aria-hidden="true" className="size-4 text-fg-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
