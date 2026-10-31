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

data "aws_region" "current" {}

# 管理コンソールと Web 版クライアントの配信(S3 + CloudFront)。中身は mise run deploy:admin dev、
# mise run deploy:web dev で置く(scripts/deploy-spa.sh)
module "admin_site" {
  source = "../../modules/spa"

  name          = "${local.name_prefix}-admin"
  bucket_name   = "${local.name_prefix}-admin-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  csp_connect_sources = local.csp_api_sources
}

module "web_site" {
  source = "../../modules/spa"

  name          = "${local.name_prefix}-web"
  bucket_name   = "${local.name_prefix}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  csp_connect_sources = concat(local.csp_api_sources, [
    # livekit-client は接続先に加えて、https で地域の一覧も取る。地域のホストは <project>.<地域>.production.livekit.cloud
    "wss://*.livekit.cloud",
    "https://*.livekit.cloud",
    # 署名付き URL での PUT(services/api の media_store.py はバケット名をホストに入れる)
    "https://${local.media_bucket_name}.s3.${data.aws_region.current.region}.amazonaws.com",
    "https://${local.media_bucket_name}.s3.amazonaws.com",
    "https://${module.media.cdn_domain_name}",
  ])
  csp_media_sources    = ["https://${module.media.cdn_domain_name}"]
  csp_video_conversion = true
}

locals {
  media_bucket_name = "${local.name_prefix}-media-${data.aws_caller_identity.current.account_id}"

  # CSP の接続先。API はワイルドカードにする。API の CORS が配信のドメインを参照し、配信の CSP が API の
  # ドメインを参照すると循環するため。Cognito は固定の名前から作れる
  csp_api_sources = [
    "https://*.execute-api.${data.aws_region.current.region}.amazonaws.com",
    "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com",
    "https://${local.name_prefix}.auth.${data.aws_region.current.region}.amazoncognito.com",
  ]

  # 管理コンソールと Web 版クライアントのオリジン。ローカルの開発サーバーと、CloudFront での配信
  admin_origins = ["http://localhost:5173", module.admin_site.url]
  web_origins   = ["http://localhost:5174", module.web_site.url]
  # API と画像・動画のバケットが CORS で許可するオリジン
  client_origins = concat(local.admin_origins, local.web_origins)
}

module "auth" {
  source = "../../modules/cognito"

  name_prefix         = local.name_prefix
  domain_prefix       = local.name_prefix
  deletion_protection = false

  mobile_callback_urls = ["voiceintercom://callback"]
  mobile_logout_urls   = ["voiceintercom://signout"]
  web_callback_urls    = [for o in local.web_origins : "${o}/callback"]
  web_logout_urls      = local.web_origins
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

# ユーザーのプロフィール(表示名、話す言語、翻訳先の言語、所属するテナント)と FCM の端末トークン。
# user_id は Cognito の sub。テナントのユーザーは GSI(tenant_id-index)で取る
module "users_table" {
  source = "../../modules/dynamodb"

  name     = "${local.name_prefix}-users"
  hash_key = "user_id"
  global_secondary_indexes = [
    { name = "tenant_id-index", hash_key = "tenant_id", projection_type = "ALL" },
  ]
  deletion_protection    = false
  point_in_time_recovery = false
}

# テナント(運営者が作る。services/api の tenants.py)
module "tenants_table" {
  source = "../../modules/dynamodb"

  name                   = "${local.name_prefix}-tenants"
  hash_key               = "tenant_id"
  deletion_protection    = false
  point_in_time_recovery = false
}

# ルームの設定(名前、テナント、種別、アーカイブ、Connect の相手)。メンバーは room_members に持つ
# (services/api の store.py)。テナントのルームは GSI(作ったテナントと、Connect の相手)で取る
module "rooms_table" {
  source = "../../modules/dynamodb"

  name     = "${local.name_prefix}-rooms"
  hash_key = "room_id"
  global_secondary_indexes = [
    { name = "tenant_id-index", hash_key = "tenant_id", projection_type = "ALL" },
    { name = "connect_tenant_id-index", hash_key = "connect_tenant_id", projection_type = "ALL" },
  ]
  deletion_protection    = false
  point_in_time_recovery = false
}

# ルームのメンバー。1人1行(room_id × user_id)で、役割(owner か member)とその人のテナントを持つ。
# ルームのメンバーはテーブルの Query で、「自分がメンバーのルーム」は GSI(user_id-index)の Query で取る
module "room_members_table" {
  source = "../../modules/dynamodb"

  name      = "${local.name_prefix}-room-members"
  hash_key  = "room_id"
  range_key = "user_id"
  global_secondary_indexes = [
    { name = "user_id-index", hash_key = "user_id", range_key = "room_id" },
  ]
  deletion_protection    = false
  point_in_time_recovery = false
}

locals {
  table_arns = [
    module.timeline_table.table_arn,
    module.users_table.table_arn,
    "${module.users_table.table_arn}/index/*",
    module.tenants_table.table_arn,
    module.rooms_table.table_arn,
    "${module.rooms_table.table_arn}/index/*",
    module.room_members_table.table_arn,
    "${module.room_members_table.table_arn}/index/*",
  ]
}

module "media" {
  source = "../../modules/media"

  # バケット名は全世界で一意なので、アカウント ID を付ける
  bucket_name          = local.media_bucket_name
  force_destroy        = true
  cors_allowed_origins = local.client_origins
}

# 秘密情報の SSM パラメーター。Terraform では作らず、aws ssm put-parameter で入れる(README の「秘密情報」)。
# aws_ssm_parameter は ignore_changes を付けても、読み直した実際の値を state に平文で持つ。value_wo に替えると、切り替えの apply で
# 設定に書いた値(仮の値)を本物に上書きしてしまうので、Terraform の管理から外し、名前と ARN だけを持つ
locals {
  secret_parameter_names = {
    livekit_api_secret  = "/${local.name_prefix}/livekit/api-secret"
    openai_api_key      = "/${local.name_prefix}/openai/api-key"
    fcm_service_account = "/${local.name_prefix}/fcm/service-account"
    agent_client_secret = "/${local.name_prefix}/cognito/agent-client-secret"
  }
  secret_parameter_arns = {
    for key, name in local.secret_parameter_names :
    key => "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${name}"
  }
}

# 前から state にあるものを、AWS のパラメーターは消さずに state からだけ外す
removed {
  from = aws_ssm_parameter.livekit_api_secret
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_ssm_parameter.openai_api_key
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_ssm_parameter.fcm_service_account
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_ssm_parameter.agent_client_secret
  lifecycle {
    destroy = false
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

  # 運営者向けのユーザーとテナントの一覧(すべてを返すので Scan で取る)。timeline は Query だけにする
  statement {
    actions   = ["dynamodb:Scan"]
    resources = [module.users_table.table_arn, module.tenants_table.table_arn]
  }

  # 署名付き URL の発行(アップロードと、必要なら直接の取得)。HeadObject は GetObject の権限で動く。
  # マルチパートの開始・パートの PUT・完了は PutObject の権限で動く。取りやめ(完了できないとき、
  # 消したとき)には AbortMultipartUpload が要る。complete で仮置きから配信するキーへ移す
  # CopyObject は、元の GetObject と先の PutObject で動く
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
    resources = ["${module.media.bucket_arn}/*"]
  }

  # 送った本人が消した画像・動画の本体とサムネイル(と仮置き)を消す(services/api の deletion.py)。
  # complete で移した後の仮置きも消す。ルームを消したときの rooms/<room_id>/ の一括削除
  # (DeleteObjects。room_cleanup.py)も同じ権限で動く
  statement {
    actions   = ["s3:DeleteObject"]
    resources = ["${module.media.bucket_arn}/rooms/*"]
  }

  # 消した画像・動画の CloudFront のキャッシュを無効にする(media_id ごとに1パス。
  # ルームを消したときは /rooms/<room_id>/* の1パス)
  statement {
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [module.media.distribution_arn]
  }

  # scale to zero: 入室のトークンを出すときに、0 台の Agent を 1 台にする(agent_wake.py)
  dynamic "statement" {
    for_each = local.agent_wake ? [1] : []
    content {
      actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
      resources = [module.agent.service_arn]
    }
  }

  # ListBucket がないと、ないオブジェクトの HeadObject が 404 ではなく 403 になり、
  # メディアの complete で「まだ置かれていない」(409)を見分けられない。
  # ルームを消したときは、rooms/<room_id>/ の下のオブジェクトと途中のマルチパートを一覧する(room_cleanup.py)
  statement {
    actions   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = [module.media.bucket_arn]
  }

  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.secret_parameter_arns.livekit_api_secret]
  }

  # push 通知(notify.py)
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [local.secret_parameter_arns.fcm_service_account]
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
  cors_allowed_origins = local.client_origins
  log_retention_days   = 14

  environment = merge({
    OIDC_ISSUER        = module.auth.issuer
    OIDC_JWKS_URL      = module.auth.jwks_url
    OIDC_CLIENT_IDS    = join(",", local.client_ids)
    TIMELINE_TABLE     = module.timeline_table.table_name
    USERS_TABLE        = module.users_table.table_name
    TENANTS_TABLE      = module.tenants_table.table_name
    ROOMS_TABLE        = module.rooms_table.table_name
    ROOM_MEMBERS_TABLE = module.room_members_table.table_name
    MEDIA_BUCKET       = module.media.bucket_name
    MEDIA_BASE_URL     = "https://${module.media.cdn_domain_name}"
    # 消した画像・動画のキャッシュの無効化(deletion.py)
    MEDIA_DISTRIBUTION_ID = module.media.distribution_id

    LIVEKIT_CLIENT_URL = var.livekit_client_url
    LIVEKIT_API_KEY    = var.livekit_api_key
    # シークレットの値ではなく、SSM のパラメーター名を渡す
    LIVEKIT_API_SECRET_PARAMETER  = local.secret_parameter_names.livekit_api_secret
    FCM_SERVICE_ACCOUNT_PARAMETER = local.secret_parameter_names.fcm_service_account
    }, local.agent_wake ? {
    # 入室のトークンを出すときに、0 台の Agent を 1 台にする(services/api の agent_wake.py)。
    # 名前は module.agent の var.name と同じ(module.agent を参照すると、Agent が API の URL を
    # 参照しているので循環する)
    AGENT_ECS_CLUSTER = local.agent_name
    AGENT_ECS_SERVICE = local.agent_name
  } : {})
}

locals {
  client_ids = [module.auth.mobile_client_id, module.auth.web_client_id, module.auth.admin_client_id, module.auth.agent_client_id]

  # Agent の ECS のクラスターとサービスの名前(module.agent の var.name)
  agent_name = "${local.name_prefix}-agent"
  # API が Agent を起こすか。イメージを push する前と、agent_max_count を 0 にして止めたときは起こさない
  agent_wake = var.agent_idle_shutdown_minutes > 0 && var.agent_image_tag != "" && var.agent_max_count > 0
}

# 話者ごと・発話ごとの録音(Agent が書く)。media は CloudFront でバケット全体を配信するので、
# 録音は非公開の別のバケットに置く(infra/modules/recordings)
module "recordings" {
  source = "../../modules/recordings"

  bucket_name    = "${local.name_prefix}-recordings-${data.aws_caller_identity.current.account_id}"
  retention_days = var.recording_retention_days
  force_destroy  = true
}

# LiveKit Agent(ECS Fargate)。dev は scale to zero にする。入室で API が 1 台にし、使われなくなったら
# Agent が 0 台にする(agent_idle_shutdown_minutes。設計メモの「Agent の scale to zero」)。
# agent_max_count を 0 にすると、起こさなくなる
module "agent" {
  source = "../../modules/agent"

  name      = local.agent_name
  image_tag = var.agent_image_tag
  cpu       = 1024
  memory    = 2048
  min_count = var.agent_min_count
  max_count = var.agent_max_count

  scale_to_zero_idle_minutes = var.agent_idle_shutdown_minutes

  # LiveKit Cloud ではアプリと Agent の接続先が同じなので、アプリに返す URL をそのまま使う
  livekit_url                      = var.livekit_client_url
  livekit_api_key                  = var.livekit_api_key
  livekit_api_secret_parameter_arn = local.secret_parameter_arns.livekit_api_secret
  openai_api_key_parameter_arn     = local.secret_parameter_arns.openai_api_key

  # 確定した字幕を API で履歴に保存する(client credentials でトークンを取る)
  history = {
    api_base_url                = module.api.api_endpoint
    oidc_token_url              = "${module.auth.hosted_ui_url}/oauth2/token"
    client_id                   = module.auth.agent_client_id
    client_secret_parameter_arn = local.secret_parameter_arns.agent_client_secret
  }

  # 話者ごと・発話ごとの録音を S3 に置く(Egress は使わない。設計メモの「録音の方式」)
  recording = {
    bucket_name = module.recordings.bucket_name
    bucket_arn  = module.recordings.bucket_arn
  }

  vpc_cidr           = "10.10.0.0/16"
  log_retention_days = 14
}

# AWS の予算のアラート。予算はアカウント単位なので、dev と prod を合わせた全体の請求を見る(dev にだけ置く)。
# OpenAI と LiveKit の料金は AWS の請求に入らないので、ここでは見えない。
# 使わない間はほぼ0円なので、少しでもかかったら気づけるよう低くしている
locals {
  budget_alert_emails = compact([for e in split(",", var.budget_alert_emails) : trimspace(e)])
}

resource "aws_budgets_budget" "account_monthly" {
  name         = "voice-intercom-account-monthly"
  budget_type  = "COST"
  limit_amount = "1"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # クレジットや返金で相殺された分も、使った額として数える
  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = local.budget_alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = local.budget_alert_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = local.budget_alert_emails
  }
}
