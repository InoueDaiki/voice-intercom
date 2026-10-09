variable "bucket_name" {
  description = "S3 のバケット名(全世界で一意)"
  type        = string
}

variable "force_destroy" {
  description = "true なら、中身が残っていてもバケットを消せる。dev だけで使う"
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "ブラウザから署名付き URL で PUT するオリジン(管理コンソール)"
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "CloudFront の価格クラス。PriceClass_200 は日本を含む"
  type        = string
  default     = "PriceClass_200"
}
