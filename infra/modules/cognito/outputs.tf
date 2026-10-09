output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "issuer" {
  description = "トークンの iss。探索用の URL は <issuer>/.well-known/openid-configuration"
  value       = local.issuer
}

output "jwks_url" {
  value = "${local.issuer}/.well-known/jwks.json"
}

output "hosted_ui_url" {
  description = "ホストされたログイン画面(/oauth2/authorize、/oauth2/token の基点)"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
}

output "mobile_client_id" {
  value = aws_cognito_user_pool_client.mobile.id
}

output "admin_client_id" {
  value = aws_cognito_user_pool_client.admin.id
}

output "agent_client_id" {
  value = aws_cognito_user_pool_client.agent.id
}

output "agent_client_secret" {
  value     = aws_cognito_user_pool_client.agent.client_secret
  sensitive = true
}
