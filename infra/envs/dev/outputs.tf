output "oidc_issuer" {
  value = module.auth.issuer
}

output "cognito_hosted_ui_url" {
  value = module.auth.hosted_ui_url
}

output "cognito_client_ids" {
  value = {
    mobile = module.auth.mobile_client_id
    web    = module.auth.web_client_id
    admin  = module.auth.admin_client_id
    agent  = module.auth.agent_client_id
  }
}

# Agent のクライアントシークレット。SSM に写すときだけ使う(README の「LiveKit Agent(ECS Fargate)」)
output "agent_client_secret" {
  value     = module.auth.agent_client_secret
  sensitive = true
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "table_names" {
  value = {
    timeline     = module.timeline_table.table_name
    users        = module.users_table.table_name
    rooms        = module.rooms_table.table_name
    room_members = module.room_members_table.table_name
  }
}

output "media_bucket" {
  value = module.media.bucket_name
}

output "media_base_url" {
  value = "https://${module.media.cdn_domain_name}"
}

output "agent_repository_url" {
  value = module.agent.repository_url
}

output "agent_cluster_name" {
  value = module.agent.cluster_name
}

output "agent_service_name" {
  value = module.agent.service_name
}

output "agent_log_group_name" {
  value = module.agent.log_group_name
}

output "recording_bucket" {
  value = module.recordings.bucket_name
}

# 管理コンソールと Web 版クライアントの配信(mise run deploy:<app> が使う)
output "admin_url" {
  value = module.admin_site.url
}

output "admin_site_bucket" {
  value = module.admin_site.bucket_name
}

output "admin_site_distribution_id" {
  value = module.admin_site.distribution_id
}

output "web_url" {
  value = module.web_site.url
}

output "web_site_bucket" {
  value = module.web_site.bucket_name
}

output "web_site_distribution_id" {
  value = module.web_site.distribution_id
}
