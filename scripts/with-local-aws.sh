#!/usr/bin/env bash
# ローカルの DynamoDB と S3(compose の dynamodb、s3)に向けて、コマンドを実行する。
#   scripts/with-local-aws.sh <command> [args...]
#
# 接続先は AWS SDK の標準の環境変数(AWS_ENDPOINT_URL_<サービス>)で渡すので、アプリにローカル用の分岐は要らない。
# .env には書かない。書くと Terraform や aws CLI までローカルに向いてしまう。
set -euo pipefail

: "${DEV_HOST:?DEV_HOST を .env に設定する}"

# AWS の SSO プロファイルではなく、ローカル用の固定の鍵を使う(.devcontainer/seaweedfs-s3.json)
unset AWS_PROFILE AWS_SESSION_TOKEN
export AWS_ACCESS_KEY_ID=local
export AWS_SECRET_ACCESS_KEY=localsecret
export AWS_REGION=ap-northeast-1
# boto3(Python)は AWS_REGION を読まず、AWS_DEFAULT_REGION を読む
export AWS_DEFAULT_REGION=ap-northeast-1

export AWS_ENDPOINT_URL_DYNAMODB=http://dynamodb:8000
# 署名付き URL のホストは署名に含まれるので、実機が届く DEV_HOST で作る
export AWS_ENDPOINT_URL_S3="http://${DEV_HOST}:8333"

# Terraform の dev 環境が Lambda に渡すものと同じ名前
export TIMELINE_TABLE=voice-intercom-local-timeline
export USERS_TABLE=voice-intercom-local-users
export ROOMS_TABLE=voice-intercom-local-rooms
export MEDIA_BUCKET=voice-intercom-local-media
# CloudFront の代わりに、S3 のバケットを匿名で読む
export MEDIA_BASE_URL="http://${DEV_HOST}:8333/${MEDIA_BUCKET}"
# Agent の録音(services/agent の recording.py)。本番は ECS のタスク定義が渡す
export RECORDING_BUCKET=voice-intercom-local-recordings

exec "$@"
