#!/usr/bin/env bash
# 統合テスト(room_flow_test.dart)の相手役。devContainer のリポジトリのルートで動かす。
# アプリの利用者がルームに入るのを待ち、英語の話者として WAV を流す(PTT と同じ流れ)。
# ルームはアプリのトークン(Agent のディスパッチ入り)で作らせるため、先には入らない。
set -euo pipefail
room=${1:-mobile-test}
user=${2:-alice}
wait_joined() {
  uv run python - "$room" "$user" <<'PY'
import asyncio, os, sys
from livekit import api

async def main(room: str, user: str) -> None:
    lk = api.LiveKitAPI(os.environ["LIVEKIT_URL"].replace("ws", "http", 1))
    try:
        for _ in range(900):
            try:
                res = await lk.room.list_participants(api.ListParticipantsRequest(room=room))
                if any(p.identity == user for p in res.participants):
                    return
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
