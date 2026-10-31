#!/usr/bin/env bash
# Agent(services/agent)のイメージを linux/arm64 でビルドし、ECR に push する。
#   scripts/push-agent.sh dev   # または prod
# 送り先の ECR は terraform output から取るので、先にその環境を apply しておく(prod の初回は、ECR だけを作る。README を参照)。
# prod には origin/main と同じコミットの main ブランチからだけ push する。
# タグはコミットのハッシュ(ECR はタグの上書きを禁じている)。最後に、apply に渡すタグを表示する。
set -euo pipefail

env="${1:?使い方: scripts/push-agent.sh <dev|prod>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

# 未コミットの変更があると、同じタグで中身の違うイメージができてしまう
if [[ -n "$(git -C "$root" status --porcelain)" ]]; then
  echo "未コミットの変更があります。コミットしてから実行してください" >&2
  exit 1
fi
if [[ "$env" == "prod" ]]; then
  branch="$(git -C "$root" branch --show-current)"
  if [[ "$branch" != "main" ]]; then
    echo "prod には main ブランチからだけ push できます(今: ${branch:-detached HEAD})" >&2
    exit 1
  fi
  # レビューを通っていないローカルのコミットや、古い main を prod に出さない
  git -C "$root" fetch --quiet origin main
  if [[ "$(git -C "$root" rev-parse HEAD)" != "$(git -C "$root" rev-parse origin/main)" ]]; then
    echo "prod には origin/main と同じコミットからだけ push できます" >&2
    exit 1
  fi
fi
tag="$(git -C "$root" rev-parse --short=12 HEAD)"

repo="$(terraform -chdir="$root/infra/envs/$env" output -raw agent_repository_url)"
registry="${repo%%/*}"
region="$(cut -d. -f4 <<<"$registry")"

aws ecr get-login-password --region "$region" |
  docker login --username AWS --password-stdin "$registry"

# 同じタグがもうあれば、ビルドし直さない。ビルドするのは「そのタグが無い」ときだけで、認証切れなどは止める
if describe_error="$(aws ecr describe-images --region "$region" --repository-name "${repo#*/}" \
  --image-ids imageTag="$tag" 2>&1 >/dev/null)"; then
  echo "既に push 済み: $repo:$tag"
elif ! grep -q 'ImageNotFoundException' <<<"$describe_error"; then
  echo "$describe_error" >&2
  echo "ECR のイメージを確かめられません" >&2
  exit 1
else
  # provenance の添付を切り、単一のマニフェストにする(添付はタグの無いイメージとして ECR に並び、
  # ライフサイクルの「タグの無いものを消す」に掛かるため)
  docker build --platform linux/arm64 --provenance=false \
    -f "$root/services/agent/Dockerfile" -t "$repo:$tag" "$root"
  docker push "$repo:$tag"
fi

echo
echo "次のように apply する:"
echo "  TF_VAR_agent_image_tag=$tag terraform -chdir=infra/envs/$env apply"
