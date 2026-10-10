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

variable "agent_desired_count" {
  description = "Agent のタスクの数"
  type        = number
  default     = 1
}
