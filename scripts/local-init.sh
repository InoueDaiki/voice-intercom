#!/usr/bin/env bash
# ローカルの DynamoDB と S3 に、テーブルとバケットを作る。何度実行してもよい。
# scripts/with-local-aws.sh の中で実行する(mise run local:init)。
#
# DynamoDB Local はポイントインタイムリカバリの API がなく、Terraform では作れないので、ここで作る。
# キーは infra/envs/dev/main.tf のテーブルと揃える。
set -euo pipefail

# コンテナの起動直後は応答しないので、30秒まで待つ
wait_for() {
  local label="$1"
  shift
  for _ in $(seq 30); do
    if "$@" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "$label に接続できない(compose のサービスが起動しているか確かめる)" >&2
  exit 1
}

wait_for DynamoDB aws dynamodb list-tables
wait_for S3 aws s3api list-buckets

# 4つ目の引数は GSI の JSON(create-table の --global-secondary-indexes)。
# GSI のキーは、テーブルのキーと同じ属性にする(属性の定義を足さずに済むよう)
create_table() {
  local name="$1" hash_key="$2" range_key="${3:-}" gsi="${4:-}"
  if aws dynamodb describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "既にある: $name"
    return
  fi

  local attrs=("AttributeName=$hash_key,AttributeType=S")
  local keys=("AttributeName=$hash_key,KeyType=HASH")
  if [[ -n "$range_key" ]]; then
    attrs+=("AttributeName=$range_key,AttributeType=S")
    keys+=("AttributeName=$range_key,KeyType=RANGE")
  fi
  local extra=()
  if [[ -n "$gsi" ]]; then
    extra+=(--global-secondary-indexes "$gsi")
  fi

  aws dynamodb create-table --table-name "$name" --billing-mode PAY_PER_REQUEST \
    --attribute-definitions "${attrs[@]}" --key-schema "${keys[@]}" "${extra[@]}" >/dev/null
  echo "作成した: $name"
}

create_table "$TIMELINE_TABLE" room_id event_id
create_table "$USERS_TABLE" user_id
create_table "$ROOMS_TABLE" room_id
create_table "$ROOM_MEMBERS_TABLE" room_id user_id '[{
  "IndexName": "user_id-index",
  "KeySchema": [
    {"AttributeName": "user_id", "KeyType": "HASH"},
    {"AttributeName": "room_id", "KeyType": "RANGE"}
  ],
  "Projection": {"ProjectionType": "KEYS_ONLY"}
}]'

create_bucket() {
  local name="$1"
  if aws s3api head-bucket --bucket "$name" >/dev/null 2>&1; then
    echo "既にある: $name"
    return
  fi
  aws s3api create-bucket --bucket "$name" >/dev/null
  echo "作成した: $name"
}

create_bucket "$MEDIA_BUCKET"
# 録音(Agent が書く)。匿名では読めない(.devcontainer/seaweedfs-s3.json は media だけを許している)
create_bucket "$RECORDING_BUCKET"

# 管理コンソールと Web 版(ブラウザ)から署名付き URL で PUT するため。infra/modules/media と揃える
aws s3api put-bucket-cors --bucket "$MEDIA_BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:5174"],
    "AllowedHeaders": ["Content-Type", "Content-Disposition"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}'
