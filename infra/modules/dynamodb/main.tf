# DynamoDB のテーブル1つ。用途ごとにテーブルを分け、このモジュールを用途の数だけ呼ぶ。
# キーは文字列(S)に揃える(GSI のキーも)。

locals {
  gsi_keys = distinct(flatten([
    for gsi in var.global_secondary_indexes : compact([gsi.hash_key, gsi.range_key])
  ]))
  # GSI のキーのうち、テーブルのキーでないもの
  gsi_only_keys = [for k in local.gsi_keys : k if !contains(compact([var.hash_key, var.range_key]), k)]
}

resource "aws_dynamodb_table" "this" {
  name                        = var.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = var.hash_key
  range_key                   = var.range_key
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = var.hash_key
    type = "S"
  }

  dynamic "attribute" {
    for_each = var.range_key == null ? [] : [var.range_key]

    content {
      name = attribute.value
      type = "S"
    }
  }

  dynamic "attribute" {
    for_each = local.gsi_only_keys

    content {
      name = attribute.value
      type = "S"
    }
  }

  dynamic "global_secondary_index" {
    for_each = var.global_secondary_indexes

    content {
      name            = global_secondary_index.value.name
      projection_type = global_secondary_index.value.projection_type

      key_schema {
        attribute_name = global_secondary_index.value.hash_key
        key_type       = "HASH"
      }

      dynamic "key_schema" {
        for_each = global_secondary_index.value.range_key == null ? [] : [global_secondary_index.value.range_key]

        content {
          attribute_name = key_schema.value
          key_type       = "RANGE"
        }
      }
    }
  }

  # 値は UNIX 秒
  dynamic "ttl" {
    for_each = var.ttl_attribute == null ? [] : [var.ttl_attribute]

    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }
}
