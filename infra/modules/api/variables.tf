variable "name" {
  description = "Lambda と API の名前"
  type        = string
}

variable "source_dir" {
  description = "Lambda に載せるディレクトリ(依存パッケージを含む。mise run build:api で作る)"
  type        = string
}

variable "handler" {
  description = "Lambda のハンドラ(モジュール.関数)"
  type        = string
}

variable "environment" {
  description = "Lambda の環境変数"
  type        = map(string)
  default     = {}
}

variable "policy_json" {
  description = "Lambda に足す IAM ポリシー(JSON)。DynamoDB や S3 の権限"
  type        = string
}

variable "memory_size" {
  type    = number
  default = 512
}

variable "timeout" {
  description = "秒。API Gateway の統合の上限(30秒)より短くする"
  type        = number
  default     = 15
}

variable "jwt_issuer" {
  description = "JWT オーソライザーの issuer"
  type        = string
}

variable "jwt_audiences" {
  description = "受け付ける client_id(または aud)"
  type        = list(string)
}

variable "public_routes" {
  description = "認証を求めない経路(例: \"GET /health\")"
  type        = list(string)
  default     = []
}

variable "cors_allowed_origins" {
  description = "ブラウザから呼ぶオリジン(管理コンソール)"
  type        = list(string)
  default     = []
}

variable "throttling_burst_limit" {
  type    = number
  default = 100
}

variable "throttling_rate_limit" {
  description = "1秒あたりのリクエスト数"
  type        = number
  default     = 50
}

variable "log_retention_days" {
  type    = number
  default = 30
}
