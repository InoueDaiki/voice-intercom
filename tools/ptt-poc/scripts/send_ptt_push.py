# /// script
# requires-python = ">=3.14"
# dependencies = ["httpx[http2]==0.28.1", "pyjwt[crypto]==2.15.1"]
# ///
"""Push to Talk の push(apns-push-type: pushtotalk)を APNs に直接送る(spike 用)。

宛先はアプリの画面の「push の宛先」に出るトークン(チャンネルに参加すると届く。
FCM のトークンとは別物)。APNs の認証キー(.p8)は Apple Developer の Keys で作る。
リポジトリには置かない(.gitignore で *.p8 を外している)。

    uv run --script tools/ptt-poc/scripts/send_ptt_push.py --token <トークン> --speaker user2
    uv run --script tools/ptt-poc/scripts/send_ptt_push.py --token <トークン> --leave

キーの場所などは環境変数(.env)でも渡せる:
APNS_KEY_FILE、APNS_KEY_ID、APPLE_TEAM_ID、PTT_POC_BUNDLE_ID。
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx
import jwt

HOSTS = {
    "sandbox": "https://api.sandbox.push.apple.com",
    "production": "https://api.push.apple.com",
}


def provider_token(key_file: Path, key_id: str, team_id: str) -> str:
    # APNs のトークン認証。ES256 で署名し、1時間まで使える
    return jwt.encode(
        {"iss": team_id, "iat": int(time.time())},
        key_file.read_text(),
        algorithm="ES256",
        headers={"kid": key_id},
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--token", required=True, help="アプリに出る PTT の push の宛先(16進)")
    parser.add_argument("--speaker", default="だれか", help="システムの画面に出す話者の名前")
    parser.add_argument("--leave", action="store_true", help="チャンネルから出させる")
    parser.add_argument("--room", help="payload に入れるルームの ID(アプリは記録に出すだけ)")
    parser.add_argument("--env", choices=HOSTS, default="sandbox", help="開発のビルドは sandbox")
    parser.add_argument("--key-file", type=Path, default=os.environ.get("APNS_KEY_FILE"))
    parser.add_argument("--key-id", default=os.environ.get("APNS_KEY_ID"))
    parser.add_argument("--team-id", default=os.environ.get("APPLE_TEAM_ID"))
    parser.add_argument(
        "--bundle-id", default=os.environ.get("PTT_POC_BUNDLE_ID", "dev.voiceintercom.pttpoc")
    )
    args = parser.parse_args()

    missing = [name for name in ("key_file", "key_id", "team_id") if not getattr(args, name)]
    if missing:
        parser.error(f"足りない: {', '.join('--' + m.replace('_', '-') for m in missing)}")

    payload: dict[str, object] = {"leave": True} if args.leave else {"speaker": args.speaker}
    if args.room:
        payload["room"] = args.room
    headers = {
        "authorization": f"bearer {provider_token(args.key_file, args.key_id, args.team_id)}",
        "apns-push-type": "pushtotalk",
        "apns-topic": f"{args.bundle_id}.voip-ptt",
        # Push to Talk の push は、すぐ届けるか捨てる(Apple の決まり)
        "apns-priority": "10",
        "apns-expiration": "0",
    }
    sent_at = time.time()
    with httpx.Client(http2=True, timeout=10) as client:
        res = client.post(
            f"{HOSTS[args.env]}/3/device/{args.token}", headers=headers, content=json.dumps(payload)
        )
    # アプリの記録(UNIX 時間のミリ秒)と突き合わせるため、送った時刻を出す
    apns_id = res.headers.get("apns-id")
    print(f"sentAtMs={sent_at * 1000:.0f} status={res.status_code} apns-id={apns_id}")
    if res.status_code != 200:
        print(res.text, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
