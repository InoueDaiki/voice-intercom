import type { Room } from "@voice-intercom/client-core";
import { Alert, Badge, Button, buttonClass, LoadErrorAlert, PageHeader } from "@voice-intercom/ui-web";
import { ChevronRight, Headphones, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { api } from "../api.ts";
import { errorMessage, useJoinableRooms, useMe, useRoomMutation, useRooms } from "../queries.ts";
import { ROOM_KINDS } from "../RoomKind.tsx";
import { useRoomHub } from "../roomHub.tsx";

// ルームの一覧。自分のルーム(参加している)、参加できるルーム(テナントの Public)、アーカイブの3つに分ける
// (設計メモの「ユーザーの3つの状態の表し方」)
export default function RoomList() {
  const me = useMe();
  const hasTenant = me.data?.tenant_id != null;
  const rooms = useRooms();
  const joinable = useJoinableRooms(hasTenant);
  const active = rooms.data?.filter((r) => !r.archived_at) ?? [];
  const archived = rooms.data?.filter((r) => r.archived_at) ?? [];

  return (
    <section className="mx-auto grid max-w-3xl gap-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="ルーム"
        description="ルームを開くと、字幕とテキストを見て送れます。声で話すときは、ルームで「音声をつなぐ」を押します。"
        actions={
          hasTenant && (
            <Link to="/rooms/new" className={buttonClass({ variant: "primary" })}>
              <Plus aria-hidden="true" className="size-4" />
              ルームを作る
            </Link>
          )
        }
      />
      {!hasTenant && me.data && (
        <Alert tone="warning">テナントに所属していません。運営者に所属を決めてもらうと、ルームを使えます。</Alert>
      )}
      {rooms.isPending && <p className="text-fg-muted">読み込み中…</p>}
      {rooms.isError && (
        <LoadErrorAlert onRetry={() => void rooms.refetch()}>
          ルームの一覧を取得できません: {errorMessage(rooms.error)}
        </LoadErrorAlert>
      )}
      {rooms.isSuccess && (
        <RoomSection title="自分のルーム">
          {active.length === 0 ? (
            <p className="text-fg-muted">参加しているルームはありません。ルームを作るか、下の一覧から参加してください。</p>
          ) : (
            <RoomRows rooms={active} />
          )}
        </RoomSection>
      )}
      {joinable.isSuccess && joinable.data.length > 0 && (
        <RoomSection title="参加できるルーム" description="テナントの誰でも参加できる Public のルームです。">
          <RoomRows rooms={joinable.data} joinable />
        </RoomSection>
      )}
      {archived.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-bold text-fg-muted">アーカイブ({archived.length})</summary>
          <div className="pt-3">
            <RoomRows rooms={archived} />
          </div>
        </details>
      )}
    </section>
  );
}

function RoomSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2>{title}</h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// カードを並べず、1枚の面を線で区切る(行は同じ種類のものなので)
function RoomRows({ rooms, joinable = false }: { rooms: Room[]; joinable?: boolean }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {rooms.map((room) => (
        <li key={room.room_id}>{joinable ? <JoinableRow room={room} /> : <RoomRow room={room} />}</li>
      ))}
    </ul>
  );
}

function RoomName({ room }: { room: Room }) {
  const { label, Icon } = ROOM_KINDS[room.kind];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Icon aria-label={label} className="size-4 shrink-0 text-fg-muted" />
      <span className="truncate text-lg font-bold">{room.name}</span>
    </span>
  );
}

function RoomRow({ room }: { room: Room }) {
  const hub = useRoomHub();
  const audio = hub.get(room.room_id)?.session.audio ?? false;
  return (
    <Link
      to={`/rooms/${encodeURIComponent(room.room_id)}`}
      className="group flex items-center gap-4 px-4 py-4 text-fg no-underline hover:bg-surface-muted"
    >
      <RoomName room={room} />
      {audio && (
        <Badge tone="neutral">
          <Headphones aria-hidden="true" className="size-3.5" />
          音声中
        </Badge>
      )}
      <span className="text-sm text-fg-muted">{room.member_ids.length}人</span>
      <ChevronRight aria-hidden="true" className="size-5 text-fg-muted group-hover:text-fg" />
    </Link>
  );
}

function JoinableRow({ room }: { room: Room }) {
  const navigate = useNavigate();
  const join = useRoomMutation(room.room_id, () => api.joinRoom(room.room_id));
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <RoomName room={room} />
      <span className="text-sm text-fg-muted">{room.member_ids.length}人</span>
      {join.isError && <span className="text-sm text-danger-fg">{errorMessage(join.error)}</span>}
      <Button
        size="sm"
        disabled={join.isPending}
        onClick={() => join.mutate(undefined, { onSuccess: () => void navigate(`/rooms/${encodeURIComponent(room.room_id)}`) })}
      >
        参加する
      </Button>
    </div>
  );
}
