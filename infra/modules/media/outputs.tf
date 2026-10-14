output "bucket_name" {
  value = aws_s3_bucket.this.id
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "cdn_domain_name" {
  description = "配信用の CloudFront のドメイン"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "distribution_id" {
  description = "配信用の CloudFront の ID(消した画像・動画のキャッシュを無効にする)"
  value       = aws_cloudfront_distribution.this.id
}
