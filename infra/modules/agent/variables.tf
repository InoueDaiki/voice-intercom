variable "name" {
  description = "リソースの名前(例: voice-intercom-dev-agent)"
  type        = string
}

variable "image_tag" {
  description = "ECR のイメージのタグ(scripts/push-agent.sh が付ける、コミットのハッシュ)。空なら desired_count を 0 にする(初回の apply で ECR だけ作るため)"
  type        = string
  default     = ""
}

variable "cpu" {
  description = "タスクの CPU(1024 = 1 vCPU)。公式の自前運用ガイドの目安は 4 vCPU・8GB から(同時ジョブ 10〜25)"
  type        = number
  default     = 4096
}

variable "memory" {
  description = "タスクのメモリ(MiB)。Fargate では CPU ごとに選べる値が決まっている"
  type        = number
  default     = 8192
}

variable "desired_count" {
  description = "タスクの数(台数固定。オートスケールしない理由は main.tf の aws_ecs_service を参照)"
  type        = number
  default     = 1
}

variable "livekit_url" {
  description = "Agent が登録する LiveKit サーバーの URL(例: wss://<project>.livekit.cloud)"
  type        = string
}

variable "livekit_api_key" {
  description = "LiveKit の API キー(シークレットではない側)"
  type        = string
}

variable "livekit_api_secret_parameter_arn" {
  description = "LiveKit の API シークレットを入れた SSM パラメーター(SecureString)の ARN"
  type        = string
}

variable "openai_api_key_parameter_arn" {
  description = "OpenAI の API キーを入れた SSM パラメーター(SecureString)の ARN"
  type        = string
}

variable "environment" {
  description = "コンテナに足す環境変数(AGENT_NAME、モデル名など。services/agent/README.md を参照)"
  type        = map(string)
  default     = {}
}

variable "vpc_cidr" {
  description = "Agent 用の VPC の CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "パブリックサブネットを置く AZ の数"
  type        = number
  default     = 2
}

variable "image_retention_count" {
  description = "ECR に残すタグ付きのイメージの数(古いものから消す。ロールバック先として少し残す)"
  type        = number
  default     = 20
}

variable "container_insights" {
  description = "ECS の Container Insights(CloudWatch の追加料金がかかる)"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 30
}
