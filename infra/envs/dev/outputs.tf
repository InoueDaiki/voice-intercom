output "oidc_issuer" {
  value = module.auth.issuer
}

output "cognito_hosted_ui_url" {
  value = module.auth.hosted_ui_url
}

output "cognito_client_ids" {
  value = {
    mobile = module.auth.mobile_client_id
    admin  = module.auth.admin_client_id
    agent  = module.auth.agent_client_id
  }
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "table_names" {
  value = {
    timeline = module.timeline_table.table_name
    users    = module.users_table.table_name
    rooms    = module.rooms_table.table_name
  }
}

output "media_bucket" {
  value = module.media.bucket_name
}

output "media_base_url" {
  value = "https://${module.media.cdn_domain_name}"
}
