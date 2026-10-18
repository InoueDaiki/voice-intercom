output "bucket_name" {
  description = "ビルドしたファイルを置くバケット(mise run deploy:<app> が sync する)"
  value       = aws_s3_bucket.this.id
}

output "domain_name" {
  description = "配信する CloudFront のドメイン"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "url" {
  description = "アプリの URL(オリジン。Cognito の戻り先や CORS に使う)"
  value       = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "distribution_id" {
  description = "CloudFront の ID(デプロイの後にキャッシュを無効にする)"
  value       = aws_cloudfront_distribution.this.id
}
