# 話者ごと・発話ごとの録音(services/agent の recording.py が書く)を置く、非公開の S3。
# 画像・動画のバケット(media)とは分ける。media は CloudFront の既定の振る舞いがバケット全体
# ("/*")を OAC で読み、署名なしで配信するので、同じバケットに置くとキーを知る人なら誰でも聞ける。
# このバケットは CloudFront にもつながず、読めるのは IAM で許したものだけにする。
#
# キーは rooms/<room_id>/<YYYY>/<MM>/<DD>/<utterance_id>-<speaker_id>.ogg。
# Agent のタスクロールには rooms/ の下への s3:PutObject だけを許す(infra/modules/agent)。

resource "aws_s3_bucket" "this" {
  bucket        = var.bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3。KMS(カスタマー管理のキー)にするなら、Agent のタスクロールに kms:GenerateDataKey も足す
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  # 古い録音を消す
  rule {
    id     = "expire-recordings"
    status = "Enabled"

    filter {}

    expiration {
      days = var.retention_days
    }
  }

  # 未完了のマルチパートアップロード(Agent が送る途中で落ちたものなど)を消す。
  # Agent には s3:AbortMultipartUpload を許していないので、ここで片付ける
  rule {
    id     = "abort-incomplete-multipart-upload"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.this]
}
