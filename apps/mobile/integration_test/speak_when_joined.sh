#!/usr/bin/env bash
# 統合テスト(room_flow_test.dart)の相手役。devContainer のリポジトリのルートで動かす。
# アプリの利用者がルームに入るのを待ち、英語の話者として WAV を流す(PTT と同じ流れ)。
# ルームはアプリのトークン(Agent のディスパッチ入り)で作らせるため、先には入らない。
# 前の実行の利用者が(切断の検出が遅れて)ルームに残っていることがあるので、
# このスクリプトを起動した後に入った(joined_at が起動より後の)参加者だけを待つ。
set -euo pipefail
room=${1:-mobile-test}
user=${2:-alice}
wait_joined() {
  uv run python - "$room" "$user" <<'PY'
import asyncio, os, sys, time
from livekit import api

async def main(room: str, user: str) -> None:
    lk = api.LiveKitAPI(os.environ["LIVEKIT_URL"].replace("ws", "http", 1))
    # LiveKit のサーバーとこのスクリプトは同じ Docker の VM の時計を使う
    started_ms = int(time.time() * 1000)
    stale_reported = False
    try:
        for _ in range(900):
            try:
                res = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
                for p in res.participants:
                    if p.identity != user:
                        continue
                    # joined_at_ms が無い古いサーバーでは秒(joined_at)で比べる
                    joined_ms = p.joined_at_ms or p.joined_at * 1000
                    if joined_ms >= started_ms - (0 if p.joined_at_ms else 999):
                        return
                    if not stale_reported:
                        print(f"前の実行の {user} が残っている。入り直すのを待つ", flush=True)
                        stale_reported = True
            except api.TwirpError:
                pass
            await asyncio.sleep(1)
        sys.exit("利用者が入ってこなかった")
    finally:
        await lk.aclose()

asyncio.run(main(*sys.argv[1:]))
PY
}
wait_joined
echo "入室を確認した。10秒後に話す"
sleep 10
a=services/agent/poc/audio
uv run services/agent/devtools/publish_wav.py --room "$room" --language en --identity speaker-en \
  $a/en-01.wav $a/en-02.wav
