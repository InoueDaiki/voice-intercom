// 音声中の帯。音声をつないだルームが1つでもあれば、どの画面でも下に出す
// (設計メモの「ユーザーの3つの状態の表し方」)。
// - ルームごとに、いま声が流れているか(TX・RX の灯り)と、そのルームだけに話す PTT、切る操作を並べる
// - 主の PTT(音声をつないだ全部のルームに届く)は、音声をつないだルームの画面では、その画面の下にある。
//   ほかの画面では、この帯に出す
// - ルームの並びはたためる。幅の狭い画面では、たたんで始める(画面の下を取りすぎないよう)。たたんでいても、
//   どこかで声が流れていれば見出しの灯りでわかる
import type { RoomConnection, RoomHub, RoomSession } from "@voice-intercom/client-core";
import { Button, cx, PttButton, SignalLamp, type SignalState } from "@voice-intercom/ui-web";
import { ChevronDown, Headphones, Mic, PhoneOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { receivingCaption } from "./receiving.ts";
import { pressAll, pressOne, useRoomHub } from "./roomHub.tsx";

export function AudioDock({ currentRoomId, myIdentity }: { currentRoomId: string | undefined; myIdentity: string }) {
  const hub = useRoomHub();
  // ビルドのとき(index.html を作るとき)は window が無い
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 40rem)").matches);
  const rooms = hub.audioRooms;
  if (rooms.length === 0) {
    return null;
  }
  // 音声をつないだルームの画面には、主の PTT がある
  const showMainPtt = !rooms.some((r) => r.roomId === currentRoomId);
  const states = rooms.map((r) => signalOf(r.session, myIdentity));
  const overall: SignalState = states.includes("tx") ? "tx" : states.includes("rx") ? "rx" : "off";
  return (
    <section aria-label="音声中のルーム" className="border-t border-border bg-surface">
      <div className="mx-auto grid w-full max-w-3xl gap-1 px-4 py-2 sm:px-6">
        {/* 長いルーム名で帯ごと横に広がらないよう、grid の項目を中身の幅より狭められるようにする */}
        <h2 className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            className="flex h-8 w-full items-center gap-2 rounded-sm text-left text-sm font-bold focus-visible:outline-2 focus-visible:outline-fg"
            onClick={() => setOpen(!open)}
          >
            <Headphones aria-hidden="true" className="size-4 shrink-0" />
            音声中
            <span className="font-normal text-fg-muted">{rooms.length}ルーム</span>
            {!open && <SignalLamp state={overall} />}
            {!open && (
              <span className="min-w-0 flex-1 truncate font-normal text-fg-muted">
                {rooms.map((r) => r.roomName).join("、")}
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={cx("ml-auto size-4 shrink-0 text-fg-muted transition-transform", open && "rotate-180")}
            />
          </button>
        </h2>
        {open && (
          <ul className="grid max-h-40 gap-1 overflow-y-auto">
            {rooms.map((r, i) => (
              <AudioRoomRow
                key={r.roomId}
                hub={hub}
                room={r}
                signal={states[i] ?? "off"}
                myIdentity={myIdentity}
                current={r.roomId === currentRoomId}
              />
            ))}
          </ul>
        )}
        {showMainPtt && <MainPtt hub={hub} className="mt-1" />}
      </div>
    </section>
  );
}

// 音声をつないだ全部のルームに届く PTT
export function MainPtt({ hub, className }: { hub: RoomHub; className?: string }) {
  const rooms = hub.audioRooms;
  const talking = rooms.some((r) => r.session.talking);
  const pressing = hub.pressingAny;
  const connected = rooms.some((r) => r.session.connected);
  // 2つ以上つないでいるときは、全部に届くことを文言で示す
  const target = rooms.length > 1 ? `(${rooms.length}ルーム)` : "";
  return (
    <PttButton
      className={cx("w-full", className)}
      state={talking ? "talking" : pressing ? "pressing" : "idle"}
      shortcut="Space"
      disabled={!connected}
      aria-pressed={pressing}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pressAll(hub, true);
      }}
      onPointerUp={() => pressAll(hub, false)}
      onPointerCancel={() => pressAll(hub, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {talking ? `送話中${target}` : pressing ? "マイクを準備中…" : `押して話す${target}`}
    </PttButton>
  );
}

// ルームでいま声が流れているか。自分が送っていれば TX、ほかの人が話していれば RX
export function signalOf(session: RoomSession, myIdentity: string): SignalState {
  if (session.talking) {
    return "tx";
  }
  return receivingCaption(session, myIdentity) ? "rx" : "off";
}

function AudioRoomRow({
  hub,
  room,
  signal,
  myIdentity,
  current,
}: {
  hub: RoomHub;
  room: RoomConnection;
  signal: SignalState;
  myIdentity: string;
  current: boolean;
}) {
  const { session } = room;
  let status: ReactNode = session.connected ? "待機中" : "接続中…";
  if (signal === "tx") {
    status = <span className="font-bold text-live">送話中</span>;
  } else if (signal === "rx") {
    const receiving = receivingCaption(session, myIdentity);
    status = (
      <span className="font-bold text-rx-fg">{receiving && session.displayName(receiving.speakerIdentity)}</span>
    );
  }
  return (
    <li className="flex h-10 items-center gap-2 text-sm">
      <SignalLamp state={signal} />
      {current ? (
        <span className="min-w-0 truncate font-bold">{room.roomName}</span>
      ) : (
        <Link to={`/rooms/${encodeURIComponent(room.roomId)}`} className="min-w-0 truncate font-bold">
          {room.roomName}
        </Link>
      )}
      <span className="min-w-0 flex-1 truncate text-fg-muted">{status}</span>
      {/* このルームだけに話す。押している間だけ */}
      <Button
        size="sm"
        className="touch-none"
        disabled={!session.connected}
        aria-pressed={session.pressing}
        title={`${room.roomName} だけに話す(押している間)`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pressOne(session, true);
        }}
        onPointerUp={() => pressOne(session, false)}
        onPointerCancel={() => pressOne(session, false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mic aria-hidden="true" className="size-4" />
        <span className="max-sm:sr-only">ここだけ</span>
      </Button>
      <Button
        icon
        size="sm"
        variant="ghost"
        aria-label={`${room.roomName} の音声を切る`}
        title="音声を切る"
        onClick={() => void hub.setAudio(room.roomId, room.roomName, false)}
      >
        <PhoneOff aria-hidden="true" className="size-4" />
      </Button>
    </li>
  );
}
