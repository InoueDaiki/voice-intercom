"""Agent が呼ぶ API の代わりに、受けた内容を表示する。

- 履歴の保存(PUT /rooms/{room_id}/timeline/{source_id})
- 話し始めとテキストの通知(POST /rooms/{room_id}/notifications/speaking、…/text)

API がなくても、Agent が履歴を保存する流れ(トークン、そろったら1回、再送)と、話し始めの
通知の流れ(間引き、やり直し)を確かめるのに使う。
トークンは署名を確かめずに claims を表示するだけ(検証は API の担当)。
--fail で 503 を、--not-found で 404 を返し、再送や 404 の扱いを確かめられる(両方のパスで共通)。

使い方は services/agent/README.md を参照する。
"""

import argparse
import base64
import json
import sys

from aiohttp import web


def token_claims(header: str) -> dict[str, object]:
    """Bearer トークンの claims(署名は確かめない)。"""
    _, _, token = header.partition(" ")
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except IndexError, ValueError:
        return {}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--port", type=int, default=3000)
    p.add_argument("--fail", type=int, default=0, help="最初のこの回数だけ 503 を返す")
    p.add_argument("--not-found", action="store_true", help="いつも 404(ルームがない)を返す")
    args = p.parse_args()
    # 出力をファイルや pipe に向けても、届いたときに表示する
    sys.stdout.reconfigure(line_buffering=True)  # pyright: ignore[reportAttributeAccessIssue]
    remaining_failures = [args.fail]

    def fail_status() -> int | None:
        """--fail と --not-found に従って返す失敗のステータス。無ければ None。"""
        if args.not_found:
            return 404
        if remaining_failures[0] > 0:
            remaining_failures[0] -= 1
            return 503
        return None

    async def put(request: web.Request) -> web.Response:
        room_id = request.match_info["room_id"]
        source_id = request.match_info["source_id"]
        body = await request.json()
        claims = token_claims(request.headers.get("Authorization", ""))
        print(f"PUT {room_id} / {source_id}")
        print(f"  token: client_id={claims.get('client_id')} scope={claims.get('scope')}")
        print("  " + json.dumps(body, ensure_ascii=False, indent=2).replace("\n", "\n  "))
        if status := fail_status():
            print(f"  → {status} を返した")
            return web.json_response({"message": "わざと失敗"}, status=status)
        event_id = f"{body.get('occurred_at')}#{source_id}"
        return web.json_response({"room_id": room_id, "event_id": event_id, **body})

    async def notification(request: web.Request) -> web.Response:
        room_id = request.match_info["room_id"]
        kind = request.match_info["kind"]
        body = await request.json()
        claims = token_claims(request.headers.get("Authorization", ""))
        print(f"POST {room_id} / notifications/{kind}")
        print(f"  token: client_id={claims.get('client_id')} scope={claims.get('scope')}")
        print("  " + json.dumps(body, ensure_ascii=False, indent=2).replace("\n", "\n  "))
        if status := fail_status():
            print(f"  → {status} を返した")
            return web.json_response({"message": "わざと失敗"}, status=status)
        # 通知は送らない。present_ids に入っていない人がいないものとして答える
        return web.json_response({"sent": 0, "skipped": 0})

    app = web.Application()
    app.router.add_put("/rooms/{room_id}/timeline/{source_id}", put)
    app.router.add_post("/rooms/{room_id}/notifications/{kind}", notification)
    web.run_app(app, port=args.port)


if __name__ == "__main__":
    main()
