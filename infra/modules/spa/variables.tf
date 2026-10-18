variable "name" {
  description = "リソース名(voice-intercom-<env>-<アプリ>)。CloudFront の関数・OAC・ポリシーの名前にも使う"
  type        = string
}

variable "bucket_name" {
  description = "S3 のバケット名(全世界で一意)"
  type        = string
}

variable "force_destroy" {
  description = "true なら、中身が残っていてもバケットを消せる。dev だけで使う"
  type        = bool
  default     = false
}

variable "price_class" {
  description = "CloudFront の価格クラス。PriceClass_200 は日本を含む"
  type        = string
  default     = "PriceClass_200"
}
