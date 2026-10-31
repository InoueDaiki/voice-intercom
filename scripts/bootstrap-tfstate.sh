#!/usr/bin/env bash
# Terraform の state を置く S3 バケットを作る(最初に1回だけ)。
# state のバケットは Terraform 自身では管理しないので、このスクリプトで作る。
# dev と prod は同じバケットを使い、キー(dev/、prod/)で分ける。ロックは S3 のロックファイルで取る。
set -euo pipefail

bucket="${TF_STATE_BUCKET:?TF_STATE_BUCKET を設定する}"
region="ap-northeast-1"

# 作るのは「無い」(404)ときだけ。403(ほかの人のバケット、権限が無い)や認証切れは、そのまま止める
if head_error="$(aws s3api head-bucket --bucket "$bucket" 2>&1 >/dev/null)"; then
  echo "既にある: $bucket"
elif grep -qE '\(404\)|Not Found' <<<"$head_error"; then
  aws s3api create-bucket --bucket "$bucket" --region "$region" \
    --create-bucket-configuration "LocationConstraint=$region" >/dev/null
  echo "作成した: $bucket"
else
  echo "$head_error" >&2
  echo "バケットを確かめられません: $bucket(aws sso login の切れ、権限、名前の重複を確かめてください)" >&2
  exit 1
fi

# 壊れた state を前の版に戻せるようにする
aws s3api put-bucket-versioning --bucket "$bucket" \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$bucket" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$bucket" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
# 古い版は90日で消す
aws s3api put-bucket-lifecycle-configuration --bucket "$bucket" \
  --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-noncurrent","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":90}}]}' \
  >/dev/null
# HTTPS 以外を拒む(state には秘密が入りうる)
aws s3api put-bucket-policy --bucket "$bucket" --policy "$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::$bucket", "arn:aws:s3:::$bucket/*"],
      "Condition": {"Bool": {"aws:SecureTransport": "false"}}
    }
  ]
}
EOF
)"

echo "設定した: バージョニング、公開ブロック、暗号化、古い版の削除、HTTPS 以外の拒否"
