variable "name" {
  description = "テーブル名"
  type        = string
}

variable "hash_key" {
  description = "パーティションキーの属性名"
  type        = string
}

variable "range_key" {
  description = "ソートキーの属性名。なければ null"
  type        = string
  default     = null
}

variable "ttl_attribute" {
  description = "TTL に使う属性名(値は UNIX 秒)。使わなければ null"
  type        = string
  default     = null
}

variable "global_secondary_indexes" {
  description = "GSI。projection_type は ALL / KEYS_ONLY(INCLUDE は使わない)"
  type = list(object({
    name            = string
    hash_key        = string
    range_key       = optional(string)
    projection_type = optional(string, "KEYS_ONLY")
  }))
  default = []
}

variable "deletion_protection" {
  description = "テーブルの削除保護"
  type        = bool
  default     = true
}

variable "point_in_time_recovery" {
  description = "ポイントインタイムリカバリ(35日分の復元)"
  type        = bool
  default     = true
}
