variable "bucket_name" {
  description = "S3 のバケット名(全世界で一意)"
  type        = string
}

variable "retention_days" {
  description = "録音を残す日数。過ぎたものはライフサイクルで消す"
  type        = number

  validation {
    condition     = var.retention_days >= 1
    error_message = "retention_days は 1 以上にする"
  }
}

variable "force_destroy" {
  description = "true なら、中身が残っていてもバケットを消せる。dev だけで使う"
  type        = bool
  default     = false
}
