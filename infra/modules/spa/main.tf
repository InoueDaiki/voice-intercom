# 管理コンソール・Web 版クライアント(Vite + React Router の SPA)を静的に配信する S3 と CloudFront。
# アプリごとに1つずつ作る(バケットとディストリビューションを分け、デプロイとキャッシュの無効化を独立させる)。
# バケットは公開せず、CloudFront からだけ読めるようにする(OAC)。
#
# - 画面のパス(/rooms/abc など)は CloudFront Function で /index.html に書き換える(spa-fallback.js)。
#   S3 の 403/404 をエラーレスポンスで index.html に替える方法は取らない。無い JS や CSS にも HTML を
#   200 で返してしまい、壊れ方が分かりにくくなるため。
# - キャッシュの長さは、置くときの Cache-Control で決める(scripts/deploy-spa.sh)。assets/ の下は
#   名前にハッシュが付くので1年、index.html は no-cache。デプロイの後に無効化もする。

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

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "this" {
  name                              = var.name
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_fallback" {
  name    = var.name
  runtime = "cloudfront-js-2.0"
  comment = "SPA の画面のパスに index.html を返す"
  publish = true
  code    = file("${path.module}/spa-fallback.js")
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# HTTPS だけで使わせ(HSTS)、ほかのサイトの枠に入れさせず、Content-Type どおりに扱わせる。
# CSP は、つなぐ先(API、Cognito、LiveKit、画像・動画の CloudFront)が環境で変わるので、まだ付けない
resource "aws_cloudfront_response_headers_policy" "this" {
  name = var.name

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  comment             = var.name
  price_class         = var.price_class
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.this.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.this.id
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.this.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_fallback.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }

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
