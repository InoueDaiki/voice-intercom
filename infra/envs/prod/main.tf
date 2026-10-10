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

# 秘密情報。値は Terraform の外で入れる(state に残さない)
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /voice-intercom-prod/livekit/api-secret --value <secret>
#   aws ssm put-parameter --overwrite --type SecureString \
#     --name /voice-intercom-prod/openai/api-key --value <key>
resource "aws_ssm_parameter" "livekit_api_secret" {
  name  = "/${local.name_prefix}/livekit/api-secret"
  type  = "SecureString"
  value = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "openai_api_key" {
  name  = "/${local.name_prefix}/openai/api-key"
  type  = "SecureString"
  value = "CHANGE_ME"

  lifecycle {
    ignore_changes = [value]
  }
}

# LiveKit Agent(ECS Fargate)。公式の目安の 4 vCPU・8GB から始める。
# 冗長にするなら agent_desired_count を 2 にする(1つが落ちても、ルームは約15秒で残りに再ディスパッチされる)
module "agent" {
  source = "../../modules/agent"

  name          = "${local.name_prefix}-agent"
  image_tag     = var.agent_image_tag
  cpu           = 4096
  memory        = 8192
  desired_count = var.agent_desired_count

  livekit_url                      = var.livekit_client_url
  livekit_api_key                  = var.livekit_api_key
  livekit_api_secret_parameter_arn = aws_ssm_parameter.livekit_api_secret.arn
  openai_api_key_parameter_arn     = aws_ssm_parameter.openai_api_key.arn

  # prod にはまだ Cognito と API が無いので、履歴は保存しない。入れるときは dev と同じく
  # Agent のクライアントシークレットの SSM パラメーターを作り、history を渡す
  history = null

  vpc_cidr           = "10.20.0.0/16"
  log_retention_days = 90
}
