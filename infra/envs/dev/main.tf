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
# event_id は時刻順に並ぶ ID(ULID)にし、ルームの履歴を1回の Query で取る。
# 翻訳テキストは届いた断片ではなく、確定した文だけを書く(1つのパーティションに書き込みが集中するため)
module "timeline_table" {
  source = "../../modules/dynamodb"

  name                   = "${local.name_prefix}-timeline"
  hash_key               = "room_id"
  range_key              = "event_id"
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

# ルームの設定と参加者
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

  # 署名付き URL の発行(アップロードと、必要なら直接の取得)
  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${module.media.bucket_arn}/*"]
  }

  statement {
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.livekit_api_secret.arn]
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

    LIVEKIT_CLIENT_URL = var.livekit_client_url
    LIVEKIT_API_KEY    = var.livekit_api_key
    # シークレットの値ではなく、SSM のパラメーター名を渡す
    LIVEKIT_API_SECRET_PARAMETER = aws_ssm_parameter.livekit_api_secret.name
  }
}

locals {
  client_ids = [module.auth.mobile_client_id, module.auth.admin_client_id, module.auth.agent_client_id]
}

# LiveKit Agent(ECS Fargate)。dev は小さめのタスク1つにする(使わないときは agent_desired_count を 0 に)
module "agent" {
  source = "../../modules/agent"

  name          = "${local.name_prefix}-agent"
  image_tag     = var.agent_image_tag
  cpu           = 1024
  memory        = 2048
  desired_count = var.agent_desired_count

  # LiveKit Cloud ではアプリと Agent の接続先が同じなので、アプリに返す URL をそのまま使う
  livekit_url                      = var.livekit_client_url
  livekit_api_key                  = var.livekit_api_key
  livekit_api_secret_parameter_arn = aws_ssm_parameter.livekit_api_secret.arn
  openai_api_key_parameter_arn     = aws_ssm_parameter.openai_api_key.arn

  vpc_cidr           = "10.10.0.0/16"
  log_retention_days = 14
}
