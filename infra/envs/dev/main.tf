terraform {
  required_version = ">= 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.68"
    }
  }

  # bucket は terraform init -backend-config="bucket=$TF_STATE_BUCKET" で渡す
  backend "s3" {
    key          = "dev/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }
}

locals {
  env         = "dev"
  name_prefix = "voice-intercom-${local.env}"
}

provider "aws" {
  region = "ap-northeast-1"

  default_tags {
    tags = {
      Project     = "voice-intercom"
      Environment = local.env
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  # 管理コンソールをローカル(Vite)で動かすときのオリジン
  admin_origins = ["http://localhost:5173"]
}

module "auth" {
  source = "../../modules/cognito"

  name_prefix         = local.name_prefix
  domain_prefix       = local.name_prefix
  deletion_protection = false

  # Flutter アプリの URL スキームは未定。決まったら合わせる
  mobile_callback_urls = ["voiceintercom://callback"]
  mobile_logout_urls   = ["voiceintercom://signout"]
  admin_callback_urls  = [for o in local.admin_origins : "${o}/callback"]
  admin_logout_urls    = local.admin_origins
}

# ルームの出来事(チャット、文字起こし、翻訳テキスト、メディアのメッセージ)を時刻順に持つ。
# event_id は `<occurred_at>#<source_id>`(文字列の順が時刻の順になる)にし、ルームの履歴を1回の Query で取る。
# 翻訳テキストは届いた断片ではなく、確定した文だけを書く(1つのパーティションに書き込みが集中するため)
# アップロード中のメディアの仮の行(room_id が media-upload#<room_id>)と、push 通知を受け手ごとに最後に送った時刻
# (room_id が notify#<room_id>。5分の間引きに使う)も置き、TTL で消す
# (services/api の timeline_store.py)
module "timeline_table" {
  source = "../../modules/dynamodb"

  name                   = "${local.name_prefix}-timeline"
  hash_key               = "room_id"
  range_key              = "event_id"
  ttl_attribute          = "expires_at_epoch"
  deletion_protection    = false
  point_in_time_recovery = false
}

# ユーザーのプロフィール(表示名、話す言語、翻訳先の言語)と FCM の端末トークン。user_id は Cognito の sub
module "users_table" {
  source = "../../modules/dynamodb"

  name                   = "${local.name_prefix}-users"
  hash_key               = "user_id"
  deletion_protection    = false
  point_in_time_recovery = false
}

# ルームの設定と参加者(member_ids)。「自分がメンバーのルーム」は Scan で取る。
# ルームの数が少ないので GSI や所属のテーブルは作らない(services/api の store.py)
module "rooms_table" {
  source = "../../modules/dynamodb"

  name                   = "${local.name_prefix}-rooms"
  hash_key               = "room_id"
  deletion_protection    = false
  point_in_time_recovery = false
}

locals {
  table_arns = [module.timeline_table.table_arn, module.users_table.table_arn, module.rooms_table.table_arn]
}

module "media" {
  source = "../../modules/media"

  # バケット名は全世界で一意なので、アカウント ID を付ける
  bucket_name          = "${local.name_prefix}-media-${data.aws_caller_identity.current.account_id}"
  force_destroy        = true
  cors_allowed_origins = local.admin_origins
}

# LiveKit の API シークレット。値は Terraform の外で入れる(state に残さない)
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /voice-intercom-dev/livekit/api-secret --value <secret>
resource "aws_ssm_parameter" "livekit_api_secret" {
  name  = "/${local.name_prefix}/livekit/api-secret"
  type  = "SecureString"
  value = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# OpenAI の API キー(Agent が使う)。LiveKit の API シークレットと同じく、値は Terraform の外で入れる
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /voice-intercom-dev/openai/api-key --value <key>
resource "aws_ssm_parameter" "openai_api_key" {
  name  = "/${local.name_prefix}/openai/api-key"
  type  = "SecureString"
  value = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# FCM(push 通知)のサービスアカウントの JSON(API の Lambda が使う)。値は Terraform の外で入れる
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /voice-intercom-dev/fcm/service-account --value file://service-account.json
resource "aws_ssm_parameter" "fcm_service_account" {
  name  = "/${local.name_prefix}/fcm/service-account"
  type  = "SecureString"
  value = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# Agent の Cognito のクライアントシークレット(履歴の保存で API を呼ぶときに使う)。
# 値は Terraform の外で入れる。Cognito が作った値を terraform output から写す(README を参照)
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /voice-intercom-dev/cognito/agent-client-secret \
#     --value "$(terraform -chdir=infra/envs/dev output -raw agent_client_secret)"
resource "aws_ssm_parameter" "agent_client_secret" {
  name  = "/${local.name_prefix}/cognito/agent-client-secret"
  type  = "SecureString"
  value = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

data "aws_iam_policy_document" "api" {
  statement {
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:TransactWriteItems",
    ]
    resources = local.table_arns
  }

  # ルームとユーザーの一覧(件数が少ないので Scan で取る)。timeline は Query だけにする
  statement {
    actions   = ["dynamodb:Scan"]
    resources = [module.users_table.table_arn, module.rooms_table.table_arn]
  }

  # 署名付き URL の発行(アップロードと、必要なら直接の取得)。HeadObject は GetObject の権限で動く
  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${module.media.bucket_arn}/*"]
  }

  # 送った本人が消した画像・動画の本体とサムネイルを消す(services/api の deletion.py)
  statement {
    actions   = ["s3:DeleteObject"]
    resources = ["${module.media.bucket_arn}/rooms/*"]
  }

  # 消した画像・動画の CloudFront のキャッシュを無効にする(media_id ごとに1パス)
  statement {
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [module.media.distribution_arn]
  }

  # ListBucket がないと、ないオブジェクトの HeadObject が 404 ではなく 403 になり、
  # メディアの complete で「まだ置かれていない」(409)を見分けられない
  statement {
    actions   = ["s3:ListBucket"]
    resources = [module.media.bucket_arn]
  }

  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.livekit_api_secret.arn]
  }

  # push 通知(notify.py)
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.fcm_service_account.arn]
  }
}

module "api" {
  source = "../../modules/api"

  name        = "${local.name_prefix}-api"
  source_dir  = "${path.root}/../../../.build/api"
  handler     = "voice_intercom_api.app.handler"
  policy_json = data.aws_iam_policy_document.api.json

  jwt_issuer           = module.auth.issuer
  jwt_audiences        = local.client_ids
  public_routes        = ["GET /health"]
  cors_allowed_origins = local.admin_origins
  log_retention_days   = 14

  environment = {
    OIDC_ISSUER     = module.auth.issuer
    OIDC_JWKS_URL   = module.auth.jwks_url
    OIDC_CLIENT_IDS = join(",", local.client_ids)
    TIMELINE_TABLE  = module.timeline_table.table_name
    USERS_TABLE     = module.users_table.table_name
    ROOMS_TABLE     = module.rooms_table.table_name
    MEDIA_BUCKET    = module.media.bucket_name
    MEDIA_BASE_URL  = "https://${module.media.cdn_domain_name}"
    # 消した画像・動画のキャッシュの無効化(deletion.py)
    MEDIA_DISTRIBUTION_ID = module.media.distribution_id

    LIVEKIT_CLIENT_URL = var.livekit_client_url
    LIVEKIT_API_KEY    = var.livekit_api_key
    # シークレットの値ではなく、SSM のパラメーター名を渡す
    LIVEKIT_API_SECRET_PARAMETER  = aws_ssm_parameter.livekit_api_secret.name
    FCM_SERVICE_ACCOUNT_PARAMETER = aws_ssm_parameter.fcm_service_account.name
  }
}

locals {
  client_ids = [module.auth.mobile_client_id, module.auth.admin_client_id, module.auth.agent_client_id]
}

# 話者ごと・発話ごとの録音(Agent が書く)。media は CloudFront でバケット全体を配信するので、
# 録音は非公開の別のバケットに置く(infra/modules/recordings)
module "recordings" {
  source = "../../modules/recordings"

  bucket_name    = "${local.name_prefix}-recordings-${data.aws_caller_identity.current.account_id}"
  retention_days = var.recording_retention_days
  force_destroy  = true
}

# LiveKit Agent(ECS Fargate)。dev は小さめのタスクを 1〜2 つにする(使わないときは agent_max_count を 0 に)
module "agent" {
  source = "../../modules/agent"

  name      = "${local.name_prefix}-agent"
  image_tag = var.agent_image_tag
  cpu       = 1024
  memory    = 2048
  min_count = var.agent_min_count
  max_count = var.agent_max_count

  # LiveKit Cloud ではアプリと Agent の接続先が同じなので、アプリに返す URL をそのまま使う
  livekit_url                      = var.livekit_client_url
  livekit_api_key                  = var.livekit_api_key
  livekit_api_secret_parameter_arn = aws_ssm_parameter.livekit_api_secret.arn
  openai_api_key_parameter_arn     = aws_ssm_parameter.openai_api_key.arn

  # 確定した字幕を API で履歴に保存する(client credentials でトークンを取る)
  history = {
    api_base_url                = module.api.api_endpoint
    oidc_token_url              = "${module.auth.hosted_ui_url}/oauth2/token"
    client_id                   = module.auth.agent_client_id
    client_secret_parameter_arn = aws_ssm_parameter.agent_client_secret.arn
  }

  # 話者ごと・発話ごとの録音を S3 に置く(Egress は使わない。設計メモの「録音の方式」)
  recording = {
    bucket_name = module.recordings.bucket_name
    bucket_arn  = module.recordings.bucket_arn
  }

  vpc_cidr           = "10.10.0.0/16"
  log_retention_days = 14
}
