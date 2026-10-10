variable "name" {
  description = "リソースの名前(例: voice-intercom-dev-agent)"
  type        = string
}

variable "image_tag" {
  description = "ECR のイメージのタグ(scripts/push-agent.sh が付ける、コミットのハッシュ)。空なら台数を 0 にする(初回の apply で ECR だけ作るため)"
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

variable "min_count" {
  description = "オートスケールの最小の台数。0 にすると CPU の指標が出ないので、ターゲット追跡では 0 台から増えない(使わない環境を止めるときだけ 0 にする)"
  type        = number
  default     = 1

  validation {
    condition     = var.min_count >= 0
    error_message = "min_count は 0 以上にする"
  }
}

variable "max_count" {
  description = "オートスケールの最大の台数。0 にすると台数を 0 にする(min_count より小さければ、最小もこれに揃える)"
  type        = number
  default     = 2

  validation {
    condition     = var.max_count >= 0
    error_message = "max_count は 0 以上にする"
  }
}

variable "cpu_target_percent" {
  description = "ターゲット追跡の CPU 使用率の目標(%)。LiveKit のワーカーが新しいジョブを断る負荷(既定 0.7)より低くする"
  type        = number
  default     = 50

  validation {
    condition     = var.cpu_target_percent > 0 && var.cpu_target_percent < 70
    error_message = "cpu_target_percent は 0 より大きく、LiveKit の load_threshold(70%)より小さくする"
  }
}

variable "scale_out_cooldown_seconds" {
  description = "スケールアウトの後、次のスケールアウトまで待つ秒数(新しいタスクが起動して LiveKit に登録するまでの時間を見込む)"
  type        = number
  default     = 120
}

variable "scale_in_cooldown_seconds" {
  description = "スケールインの後、次のスケールインまで待つ秒数(長めにして、台数を急に減らさない)"
  type        = number
  default     = 900
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
