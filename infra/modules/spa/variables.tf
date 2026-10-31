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

variable "csp_connect_sources" {
  description = "CSP の connect-src に足す接続先(API、Cognito、LiveKit、S3 など。自分のオリジンは常に入る)"
  type        = list(string)
  default     = []
}

variable "csp_media_sources" {
  description = "CSP の img-src と media-src に足す配信元(画像・動画の CloudFront など)"
  type        = list(string)
  default     = []
}

variable "csp_video_conversion" {
  description = "true なら、ブラウザでの動画の変換が使うものを許す(mediabunny の WASM と Blob の Worker。Web 版だけ)"
  type        = bool
  default     = false
}

variable "csp_report_only" {
  description = "true なら Content-Security-Policy-Report-Only で送り、違反をブラウザのコンソールに出すだけにする。false で強制する"
  type        = bool
  default     = true
}

variable "price_class" {
  description = "CloudFront の価格クラス。PriceClass_200 は日本を含む"
  type        = string
  default     = "PriceClass_200"
}
