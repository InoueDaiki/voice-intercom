variable "name_prefix" {
  description = "リソース名の接頭辞(voice-intercom-<env>)"
  type        = string
}

variable "domain_prefix" {
  description = "ホストされたログイン画面のドメインの接頭辞。リージョン内で一意にする"
  type        = string
}

variable "user_pool_tier" {
  description = "ユーザープールの機能プラン(LITE / ESSENTIALS / PLUS)"
  type        = string
  default     = "ESSENTIALS"
}

variable "invite_only" {
  description = "true なら、ユーザーの自己登録を許さない(管理者だけが作る)"
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "ユーザープールの削除保護"
  type        = bool
  default     = true
}

variable "mobile_callback_urls" {
  description = "Flutter アプリのリダイレクト先(カスタム URL スキーム)"
  type        = list(string)
}

variable "mobile_logout_urls" {
  description = "Flutter アプリのログアウト後のリダイレクト先"
  type        = list(string)
  default     = []
}

variable "admin_callback_urls" {
  description = "管理コンソールのリダイレクト先"
  type        = list(string)
}

variable "admin_logout_urls" {
  description = "管理コンソールのログアウト後のリダイレクト先"
  type        = list(string)
  default     = []
}
