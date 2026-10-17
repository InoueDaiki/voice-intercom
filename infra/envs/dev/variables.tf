# 値は terraform.tfvars か TF_VAR_<name> で渡す

variable "livekit_client_url" {
  description = "アプリが接続する LiveKit の URL(例: wss://<project>.livekit.cloud)"
  type        = string
  default     = ""
}

variable "livekit_api_key" {
  description = "LiveKit の API キー(シークレットではない側)"
  type        = string
  default     = ""
}

variable "agent_image_tag" {
  description = "Agent のイメージのタグ(mise run push:agent が表示する)。空なら Agent のタスクを起動しない"
  type        = string
  default     = ""
}

variable "agent_min_count" {
  description = "Agent のタスクの最小の台数(オートスケール)。agent_idle_shutdown_minutes が 0 のときだけ使う"
  type        = number
  default     = 1
}

variable "agent_max_count" {
  description = "Agent のタスクの最大の台数(オートスケール)。0 にすると Agent を止め、scale to zero でも起こさなくなる"
  type        = number
  default     = 2
}

variable "recording_retention_days" {
  description = "録音を残す日数。過ぎたものは S3 のライフサイクルで消す"
  type        = number
  default     = 30
}

variable "agent_idle_shutdown_minutes" {
  description = "scale to zero。ジョブ(ルーム)の無い状態がこの分数続いたら Agent を 0 台にし、入室で 1 台にする。0 にすると min_count・max_count でオートスケールする"
  type        = number
  default     = 15
}

variable "budget_alert_emails" {
  description = "AWS の予算のアラートを送るメールアドレス。複数はカンマ区切り(例: TF_VAR_budget_alert_emails=a@example.com,b@example.com)。アドレスはリポジトリに書かない"
  type        = string

  validation {
    condition     = trimspace(replace(var.budget_alert_emails, ",", "")) != ""
    error_message = "メールアドレスを1つ以上渡す。"
  }
}
