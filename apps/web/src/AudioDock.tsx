// 音声中の帯。音声をつないだルームが1つでもあれば、どの画面でも下に出す
// (設計メモの「ユーザーの3つの状態の表し方」)。
// - ルームごとに、いま声が流れているか(TX・RX の灯り)と、そのルームだけに話す PTT、切る操作を並べる
// - 主の PTT(音声をつないだ全部のルームに届く)は、音声をつないだルームの画面では、その画面の下にある。
//   ほかの画面では、この帯に出す
// - ルームの並びはたためる。幅の狭い画面では、たたんで始める(画面の下を取りすぎないよう)。たたんでいても、
//   どこかで声が流れていれば見出しの灯りでわかる
import type { RoomConnection, RoomHub } from "@voice-intercom/client-core";
import {
  connectionState,
  mainPttState,
  pressAll,
  pressOne,
  receivingCaption,
  signalOf,
  useRoomHub,
} from "@voice-intercom/client-react";
import { Button, cx, PttButton, SignalLamp, type SignalState } from "@voice-intercom/ui-web";
import { ChevronDown, Headphones, Mic, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

// 押している間だけ話すキーの、押す・離す。押したままキーが消えたら(画面を移った、音声を切った、言語を変えた)、
// 離す操作は届かないので、ここで離す。Space で話しているときは、キーが消えても止めない
function useHoldKey(press: (value: boolean) => void) {
  const held = useRef<() => void>(undefined);
  const release = () => {
    held.current?.();
    held.current = undefined;
  };
  // 最後に押したときの press で離す(押している間に hub が替わっても、押した先を離す)
  useEffect(() => () => held.current?.(), []);
  return {
    down: () => {
      held.current = () => press(false);
      press(true);
    },
    up: release,
  };
}

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
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            // 文字の頭を下の行にそろえ、余白の分だけ外へ広げる
            className="-mx-3 w-[calc(100%+1.5rem)] justify-start text-left"
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
          </Button>
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
  const { state, label, connected } = mainPttState(hub);
  const key = useHoldKey((value) => pressAll(hub, value));
  return (
    <PttButton
      className={cx("w-full", className)}
      state={state}
      shortcut="Space"
      disabled={!connected}
      aria-pressed={hub.pressingAny}
      data-ptt
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        key.down();
      }}
      onPointerUp={key.up}
      onPointerCancel={key.up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </PttButton>
  );
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
  const { session, keeper } = room;
  const key = useHoldKey((value) => pressOne(session, value));
  const connection = connectionState(room);
  let status: ReactNode =
    connection === "connected"
      ? "待機中"
      : connection === "connecting"
        ? "接続中…"
        : connection === "rejoining"
          ? "つなぎ直し中…"
          : "切断";
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
      {keeper.canRejoin && (
        <Button variant="link" className="text-xs" onClick={() => void keeper.rejoin()}>
          入り直す
        </Button>
      )}
      {/* このルームだけに話す。押している間だけ */}
      <Button
        size="sm"
        className="touch-none"
        disabled={!session.connected}
        aria-pressed={session.pressing}
        data-ptt
        title={`${room.roomName} だけに話す(押している間)`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          key.down();
        }}
        onPointerUp={key.up}
        onPointerCancel={key.up}
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
