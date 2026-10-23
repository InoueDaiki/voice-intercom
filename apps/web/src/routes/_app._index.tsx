import { LoadErrorAlert, PageHeader } from "@voice-intercom/ui-web";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { errorMessage, useRooms } from "../queries.ts";

// 自分がメンバーのルームの一覧
export default function RoomList() {
  const rooms = useRooms();
  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader title="ルーム" description="入るルームを選んでください。" />
      {rooms.isPending && <p className="text-fg-muted">読み込み中…</p>}
      {rooms.isError && (
        <LoadErrorAlert onRetry={() => void rooms.refetch()}>
          ルームの一覧を取得できません: {errorMessage(rooms.error)}
        </LoadErrorAlert>
      )}
      {rooms.isSuccess && rooms.data.length === 0 && (
        <p className="text-fg-muted">入れるルームがありません。管理者にメンバーに加えてもらってください。</p>
      )}
      {rooms.isSuccess && rooms.data.length > 0 && (
        // カードを並べず、1枚の面を線で区切る(行は同じ種類のものなので)
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {rooms.data.map((room) => (
            <li key={room.room_id}>
              <Link
                to={`/rooms/${encodeURIComponent(room.room_id)}`}
                className="group flex items-center gap-4 px-4 py-4 text-fg no-underline hover:bg-surface-muted"
              >
                <span className="min-w-0 flex-1 truncate text-lg font-bold">{room.name}</span>
                <span className="text-sm text-fg-muted">{room.member_ids.length}人</span>
                <ChevronRight aria-hidden="true" className="size-5 text-fg-muted group-hover:text-fg" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
