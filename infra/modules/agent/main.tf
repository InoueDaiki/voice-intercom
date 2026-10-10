# LiveKit Agent(services/agent)を ECS Fargate(ARM64)で動かす。
# Agent は LiveKit サーバーに WebSocket で登録してジョブを受けるワーカーで、受信のポートは要らない。
# ネットワーク(VPC、サブネット、セキュリティグループ)は network.tf。

data "aws_region" "current" {}

locals {
  # タグが無いうちは起動しない(初回の apply で ECR を作り、push してからもう一度 apply する)
  desired_count = var.image_tag == "" ? 0 : var.desired_count
  image         = "${aws_ecr_repository.this.repository_url}:${var.image_tag == "" ? "latest" : var.image_tag}"

  # 履歴の保存(services/agent の history.py)。var.history が null なら何も足さない
  history_environment = var.history == null ? {} : {
    API_BASE_URL    = var.history.api_base_url
    OIDC_TOKEN_URL  = var.history.oidc_token_url
    AGENT_CLIENT_ID = var.history.client_id
  }
  history_secrets = var.history == null ? [] : [
    { name = "AGENT_CLIENT_SECRET", valueFrom = var.history.client_secret_parameter_arn },
  ]
}

# ---- ECR ----

resource "aws_ecr_repository" "this" {
  name = var.name

  # タグはコミットのハッシュ。同じタグで別のイメージを上書きしない
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "タグの無いイメージ(ビルドの途中のものなど)は1日で消す"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "新しいものから ${var.image_retention_count} 個だけ残す"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.image_retention_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ---- ログ ----

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

# ---- IAM ----

data "aws_iam_policy_document" "assume_ecs_tasks" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# 実行ロール: ECS がイメージを取り、ログを書き、SSM から秘密情報を読んでコンテナに渡すのに使う
resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# SecureString は AWS 管理のキー(aws/ssm)で暗号化する前提。カスタマー管理のキーにするなら kms:Decrypt も足す
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions = ["ssm:GetParameters"]
    resources = concat(
      [var.livekit_api_secret_parameter_arn, var.openai_api_key_parameter_arn],
      [for s in local.history_secrets : s.valueFrom],
    )
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# タスクロール: コンテナの中のコードが使う。今の Agent は AWS の API を呼ばないので、権限は持たせない
# (履歴の保存は API Gateway を Cognito のトークンで呼ぶので、IAM の権限は要らない)
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
}

# ---- ECS ----

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "agent"
      image     = local.image
      essential = true

      environment = [
        for k, v in merge(var.environment, local.history_environment, {
          LIVEKIT_URL     = var.livekit_url
          LIVEKIT_API_KEY = var.livekit_api_key
        }) : { name = k, value = v }
      ]

      # 値は SSM に置き、Terraform(state)には持たせない
      secrets = concat([
        { name = "LIVEKIT_API_SECRET", valueFrom = var.livekit_api_secret_parameter_arn },
        { name = "OPENAI_API_KEY", valueFrom = var.openai_api_key_parameter_arn },
      ], local.history_secrets)

      # livekit-agents の HTTP サーバー(start のときは 8081)。LiveKit に繋がらないと 503 を返す。
      # 失敗が続くと ECS がタスクを入れ替える(実行中のルームは再ディスパッチされる)
      healthCheck = {
        command = [
          "CMD", "python", "-c",
          "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/', timeout=3)",
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      # SIGTERM から SIGKILL までの猶予。Fargate の上限の 120 秒にする。
      # Agent は SIGTERM で新しいジョブを断り、実行中のジョブが終わるのを待つが、
      # 120 秒を超えるルームは強制終了される(公式は音声アプリに 10 分以上を推奨。設計メモを参照)
      stopTimeout = 120

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = data.aws_region.current.region
          awslogs-stream-prefix = "agent"
        }
      }
    },
  ])
}

# 台数は固定にし、オートスケールは入れない。理由:
# - Fargate では stopTimeout が 120 秒までなので、スケールインのたびに長いルームが切れる。
#   切らないためには、ジョブを持つ間だけタスクのスケールイン保護(ECS エージェントの
#   task-protection エンドポイント)を Agent のコードから付ける必要があり、まだ実装していない。
# - 今の規模(1ルーム 100 人、Agent のジョブはルームごとに1つ)なら、4 vCPU のタスク1つで
#   公式の目安(同時ジョブ 10〜25)に収まる。
# - 入れるときは、CPU 使用率を指標にしたターゲット追跡(目標 50% 前後。公式はスケールアウトを
#   0.5 付近で早めにすると書いている)にし、スケールイン保護と一緒に入れる。
#
# デプロイは「新しいタスクを先に起動してから古いタスクを止める」(minimum 100% / maximum 200%)。
# 新しいタスクが LiveKit に登録してから古いタスクが SIGTERM を受けるので、新しいジョブは新しいタスクに行く。
# それでも古いタスクで実行中のルームは 120 秒で切れ、約 15 秒で新しいタスクに再ディスパッチされる。
# 長いルームを切らない手段は、利用の少ない時間にデプロイすること(運用で決める)と、
# 上のスケールイン保護(保護中のタスクはデプロイでも止められない)。
#
# Fargate Spot は使わない(2 分前の通知で止められ、ルームが切れる)。
resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = local.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # 新しいタスクが起動しないときは、前のタスク定義に戻す
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # AZ の偏りを直すためにタスクを止めて入れ替える機能。実行中のルームが切れるので使わない
  availability_zone_rebalancing = "DISABLED"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"

  depends_on = [aws_iam_role_policy_attachment.execution]
}
