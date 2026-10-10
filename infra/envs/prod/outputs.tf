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
