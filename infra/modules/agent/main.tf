# LiveKit Agent(services/agent)を ECS Fargate(ARM64)で動かす。
# Agent は LiveKit サーバーに WebSocket で登録してジョブを受けるワーカーで、受信のポートは要らない。
# ネットワーク(VPC、サブネット、セキュリティグループ)は network.tf。

data "aws_region" "current" {}

data "aws_caller_identity" "current" {}

locals {
  # タグが無いうちは起動しない(初回の apply で ECR を作り、push してからもう一度 apply する)。
  # 台数はオートスケールの最小・最大で決める(desired_count は Terraform では作るときにしか使わない)
  max_count = var.image_tag == "" ? 0 : var.max_count
  min_count = min(var.min_count, local.max_count)
  image     = "${aws_ecr_repository.this.repository_url}:${var.image_tag == "" ? "latest" : var.image_tag}"

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

# タスクロール: コンテナの中のコードが使う(タスク保護)
# (履歴の保存は API Gateway を Cognito のトークンで呼ぶので、IAM の権限は要らない)
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.assume_ecs_tasks.json
}

# タスクのスケールイン保護。Agent は ECS エージェントのエンドポイント($ECS_AGENT_URI)を叩き、
# ECS エージェントがタスクロールの権限で UpdateTaskProtection を呼ぶ(公式の「IAM permissions
# required for task scale-in protection」)。リソースはこのクラスターのタスクに絞る
data "aws_iam_policy_document" "task_protection" {
  statement {
    actions = [
      "ecs:GetTaskProtection",
      "ecs:UpdateTaskProtection",
    ]
    resources = [
      "arn:aws:ecs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:task/${var.name}/*",
    ]
  }
}

resource "aws_iam_role_policy" "task_protection" {
  name   = "task-protection"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_protection.json
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

# 台数は CPU 使用率のターゲット追跡でオートスケールする(下の aws_appautoscaling_*)。
# スケールインやデプロイで実行中のルームが切れないよう、Agent はジョブ(ルーム)を持つ間だけ
# タスクのスケールイン保護を付ける(services/agent/src/voice_intercom_agent/task_protection.py)。
# Fargate の stopTimeout は 120 秒までなので、保護が無いと長いルームは切れる。
#
# - 保護中のタスクは、スケールインでもデプロイでも止められない。ジョブが 0 になって保護が外れて
#   から止められる。Agent が落ちても保護が残り続けないよう、保護の期限は短め(既定 60 分)にして
#   ジョブがある間は延長する。保護を続ける長さには上限(既定 12 時間)がある。
# - desired_count は作るときの値にだけ使い、その後はオートスケールに任せる(ignore_changes)。
#   台数を変えるときは min_count・max_count を変える。RegisterScalableTarget は、今の台数が
#   最小・最大の外にあれば中に入れ直すので、image_tag が空の間(最大 0)は 0 台になる。
#
# デプロイは「新しいタスクを先に起動してから古いタスクを止める」(minimum 100% / maximum 200%)。
# 新しいタスクが LiveKit に登録してから古いタスクが止められるので、新しいジョブは新しいタスクにも行く。
# ジョブを持つ古いタスクは保護が外れるまで止められず、デプロイはその間 IN_PROGRESS のまま続く
# (サーキットブレーカーは新しいタスクの起動とヘルスチェックの失敗だけを数え、時間では打ち切らない)。
# 保護中の古いタスクも LiveKit には登録したままなので、新しいルームを受けることがある。
# デプロイが長引いても、上の保護の上限で必ず終わる。詳しくは README の「LiveKit Agent(ECS Fargate)」。
#
# Fargate Spot は使わない(2 分前の通知で止められ、ルームが切れる)。
resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = local.min_count
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

  lifecycle {
    # 台数はオートスケールが変える。Terraform が apply のたびに戻さないようにする
    ignore_changes = [desired_count]
  }
}

# ---- オートスケール ----

# ECS 用のサービスリンクロール(AWSServiceRoleForApplicationAutoScaling_ECSService)は、
# Application Auto Scaling が無ければ作る
resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = local.min_count
  max_capacity       = local.max_count
}

# CPU 使用率(サービスのタスクの平均)が目標に近づくよう、台数を増やしたり減らしたりする。
# LiveKit のワーカーは自分の CPU 使用率(load)が load_threshold(既定 0.7)を超えると新しいジョブを
# 断るので、目標はそれより低くして、断り始める前に台数を増やす(公式はスケールアウトを 0.5 付近で
# 早めにすると書いている)。スケールインは、保護の付いていないタスクからしか止めない
resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value       = var.cpu_target_percent
    scale_out_cooldown = var.scale_out_cooldown_seconds
    # ルームの増減で上下しやすいので、減らすのはゆっくりにする
    scale_in_cooldown = var.scale_in_cooldown_seconds
  }
}
