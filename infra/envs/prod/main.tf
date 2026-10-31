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
    key          = "prod/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
  }
}

locals {
  env         = "prod"
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

# 秘密情報の SSM パラメーター。Terraform では作らず、aws ssm put-parameter で入れる(README の「秘密情報」)。
# 理由は envs/dev と同じ(aws_ssm_parameter は実際の値を state に平文で持つ)。名前と ARN だけを持つ
locals {
  secret_parameter_arn_prefix = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter/${local.name_prefix}"
  secret_parameter_arns = {
    livekit_api_secret = "${local.secret_parameter_arn_prefix}/livekit/api-secret"
    openai_api_key     = "${local.secret_parameter_arn_prefix}/openai/api-key"
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

# 話者ごと・発話ごとの録音(Agent が書く)。media は CloudFront でバケット全体を配信するので、
# 録音は非公開の別のバケットに置く(infra/modules/recordings)
module "recordings" {
  source = "../../modules/recordings"

  bucket_name    = "${local.name_prefix}-recordings-${data.aws_caller_identity.current.account_id}"
  retention_days = var.recording_retention_days
}

# LiveKit Agent(ECS Fargate)。公式の目安の 4 vCPU・8GB から始め、CPU 使用率でオートスケールする。
# 最小は 1(0 台からは CPU の指標が出ず増えない)。冗長にするなら agent_min_count を 2 にする
# (1つが落ちても、ルームは約15秒で残りに再ディスパッチされる)
module "agent" {
  source = "../../modules/agent"

  name      = "${local.name_prefix}-agent"
  image_tag = var.agent_image_tag
  # タグを渡し忘れた apply で Agent を 0 台にしない
  require_image_tag = true
  cpu               = 4096
  memory            = 8192
  min_count         = var.agent_min_count
  max_count         = var.agent_max_count

  livekit_url                      = var.livekit_client_url
  livekit_api_key                  = var.livekit_api_key
  livekit_api_secret_parameter_arn = local.secret_parameter_arns.livekit_api_secret
  openai_api_key_parameter_arn     = local.secret_parameter_arns.openai_api_key

  # prod にはまだ Cognito と API が無いので、履歴は保存しない。入れるときは dev と同じく
  # Agent のクライアントシークレットの SSM パラメーターを作り、history を渡す
  history = null

  # 話者ごと・発話ごとの録音を S3 に置く(Egress は使わない。設計メモの「録音の方式」)
  recording = {
    bucket_name = module.recordings.bucket_name
    bucket_arn  = module.recordings.bucket_arn
  }

  vpc_cidr           = "10.20.0.0/16"
  log_retention_days = 90
}
