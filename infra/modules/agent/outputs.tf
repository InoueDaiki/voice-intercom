output "repository_url" {
  value = aws_ecr_repository.this.repository_url
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}

output "task_role_name" {
  description = "タスクロール(タスク保護と録音の権限はモジュールで付ける)。Agent がほかの AWS の API を使うようになったら、呼び出し元で権限を足す"
  value       = aws_iam_role.task.name
}
