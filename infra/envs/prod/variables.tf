# 値は terraform.tfvars か TF_VAR_<name> で渡す

variable "livekit_client_url" {
  description = "LiveKit の URL(例: wss://<project>.livekit.cloud)。Agent の接続先にも使う"
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
  description = "Agent のタスクの最小の台数(オートスケール)。冗長にするなら 2 にする"
  type        = number
  default     = 1
}

variable "agent_max_count" {
  description = "Agent のタスクの最大の台数(オートスケール)"
  type        = number
  default     = 4
}

variable "recording_retention_days" {
  description = "録音を残す日数。過ぎたものは S3 のライフサイクルで消す"
  type        = number
  default     = 90
}
