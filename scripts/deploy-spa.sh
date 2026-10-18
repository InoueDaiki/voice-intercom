#!/usr/bin/env bash
# 管理コンソール(apps/admin)か Web 版クライアント(apps/web)をビルドし、配信の S3 に置いて、
# CloudFront のキャッシュを無効にする。
#   scripts/deploy-spa.sh web dev     # mise run deploy:web dev
#   scripts/deploy-spa.sh admin dev   # mise run deploy:admin dev
# ビルドの設定(VITE_*)と送り先は terraform output から取るので、先にその環境を apply しておく。
set -euo pipefail

app="${1:?使い方: scripts/deploy-spa.sh <web|admin> <env>}"
env="${2:?使い方: scripts/deploy-spa.sh <web|admin> <env>}"
case "$app" in
  web | admin) ;;
  *)
    echo "アプリは web か admin: $app" >&2
    exit 1
    ;;
esac
root="$(cd "$(dirname "$0")/.." && pwd)"
tf_dir="$root/infra/envs/$env"

output() {
  terraform -chdir="$tf_dir" output -raw "$1"
}

if ! bucket="$(output "${app}_site_bucket" 2>/dev/null)"; then
  echo "terraform output に ${app}_site_bucket がありません。先に $env 環境を apply してください" >&2
  exit 1
fi
distribution_id="$(output "${app}_site_distribution_id")"
url="$(output "${app}_url")"

# ビルドに埋め込む設定(apps/<app>/src/config.ts)。.env のローカル向けの値(OIDC_ISSUER など)より優先する
VITE_OIDC_ISSUER="$(output oidc_issuer)"
VITE_OIDC_CLIENT_ID="$(terraform -chdir="$tf_dir" output -json cognito_client_ids | jq -r --arg app "$app" '.[$app]')"
# Cognito のログアウトは標準の end_session_endpoint ではないので、<hosted_ui_url>/logout を渡す
VITE_OIDC_LOGOUT_URL="$(output cognito_hosted_ui_url)/logout"
VITE_API_BASE_URL="$(output api_endpoint)"
export VITE_OIDC_ISSUER VITE_OIDC_CLIENT_ID VITE_OIDC_LOGOUT_URL VITE_API_BASE_URL
unset VITE_API_MOCK

echo "ビルド: apps/$app"
echo "  VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER"
echo "  VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID"
echo "  VITE_OIDC_LOGOUT_URL=$VITE_OIDC_LOGOUT_URL"
echo "  VITE_API_BASE_URL=$VITE_API_BASE_URL"
rm -rf "$root/apps/$app/build"
pnpm --dir "$root/apps/$app" build

out="$root/apps/$app/build/client"

# 名前にハッシュが付いたファイル(assets/)を先に置く。新しい index.html が、まだ無いファイルを指さないように
aws s3 sync "$out/assets" "s3://$bucket/assets" \
  --cache-control "public, max-age=31536000, immutable"
# index.html は毎回確かめさせる(CloudFront の既定のキャッシュポリシーでは最短 1 秒になる)
aws s3 cp "$out/index.html" "s3://$bucket/index.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
# 今のビルドに無いファイルを消す(上で置いたものは同じなので、置き直さない)。
# 開いたままのタブが古いファイルを読みに行くと失敗するので、そのときは再読み込みする
aws s3 sync "$out" "s3://$bucket" --delete --exclude "index.html" --exclude "assets/*"
aws s3 sync "$out/assets" "s3://$bucket/assets" --delete \
  --cache-control "public, max-age=31536000, immutable"

aws cloudfront create-invalidation --distribution-id "$distribution_id" --paths "/*" \
  --query "Invalidation.Id" --output text

echo
echo "デプロイしました: $url"
