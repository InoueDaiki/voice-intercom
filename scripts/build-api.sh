#!/usr/bin/env bash
# Lambda(services/api)に載せるディレクトリを .build/api に作る。
# 依存パッケージは Lambda の環境(Linux arm64、Python 3.14)向けのホイールを入れる。
# zip にするのは Terraform(archive_file)。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/.build/api"

rm -rf "$out"
mkdir -p "$out"

uv export --frozen --package voice-intercom-api --no-dev --no-emit-workspace --no-hashes \
  --output-file "$root/.build/api-requirements.txt" >/dev/null
uv pip install --quiet \
  --requirements "$root/.build/api-requirements.txt" \
  --target "$out" \
  --python-platform aarch64-manylinux2014 \
  --python-version 3.14 \
  --only-binary :all:

cp -R "$root/services/api/src/voice_intercom_api" "$out/"
# 開発用のローカルサーバー(mise run api)は Lambda に要らない
rm -f "$out/voice_intercom_api/local_server.py"
find "$out" -name __pycache__ -type d -prune -exec rm -rf {} +

echo "built: $out"
