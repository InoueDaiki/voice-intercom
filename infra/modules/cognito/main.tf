# Cognito のユーザープールと、アプリ・管理コンソール・Agent のクライアント。
# アプリと管理コンソールは標準の OIDC(認可コード + PKCE)で、Agent は client credentials で使う。
# ローカルの模擬 OIDC サーバー(.devcontainer/mock-oidc.json)と、claims の形を揃える。

data "aws_region" "current" {}

resource "aws_cognito_user_pool" "this" {
  name                = var.name_prefix
  user_pool_tier      = var.user_pool_tier
  deletion_protection = var.deletion_protection ? "ACTIVE" : "INACTIVE"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # 招待制の間は、管理者だけがユーザーを作る
  admin_create_user_config {
    allow_admin_create_user_only = var.invite_only
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# ホストされたログイン画面(/oauth2/authorize など)の URL。
# 画面はマネージドログイン(2。ESSENTIALS 以上のプランで使える)。クラシックの Hosted UI(1)より見た目を決められ、
# 日本語などに訳せる(/oauth2/authorize の lang で選ぶ)
resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 2

  lifecycle {
    precondition {
      condition     = var.user_pool_tier != "LITE"
      error_message = "マネージドログインは LITE のプランでは使えない。ESSENTIALS か PLUS にする"
    }
  }
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "管理コンソールを使えるユーザー"
}

# Agent が API を呼ぶときのスコープ(voice-intercom/agent)
resource "aws_cognito_resource_server" "api" {
  identifier   = "voice-intercom"
  name         = "${var.name_prefix}-api"
  user_pool_id = aws_cognito_user_pool.this.id

  scope {
    scope_name        = "agent"
    scope_description = "Agent からの書き込み(文字起こしや翻訳の保存)"
  }
}

locals {
  user_scopes = ["openid", "email", "profile"]
}

# モバイルアプリ(React Native)。公開クライアント(秘密を持たない)で PKCE を使う
resource "aws_cognito_user_pool_client" "mobile" {
  name         = "mobile"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = local.user_scopes
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.mobile_callback_urls
  logout_urls                          = var.mobile_logout_urls

  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# 管理コンソール(SPA)。公開クライアントで PKCE を使う
resource "aws_cognito_user_pool_client" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = local.user_scopes
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.admin_callback_urls
  logout_urls                          = var.admin_logout_urls

  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 1

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Web 版クライアント。公開クライアントで PKCE を使う。管理コンソールとは分ける
resource "aws_cognito_user_pool_client" "web" {
  name         = "web"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = local.user_scopes
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.web_callback_urls
  logout_urls                          = var.web_logout_urls

  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# LiveKit Agent。秘密を持つクライアントで、client credentials でトークンを取る
resource "aws_cognito_user_pool_client" "agent" {
  name         = "agent"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_scopes                 = ["${aws_cognito_resource_server.api.identifier}/agent"]
  supported_identity_providers         = ["COGNITO"]

  explicit_auth_flows     = ["ALLOW_REFRESH_TOKEN_AUTH"]
  enable_token_revocation = true

  access_token_validity = 60

  token_validity_units {
    access_token = "minutes"
  }

  depends_on = [aws_cognito_resource_server.api]
}

# マネージドログインの見た目。ログイン画面を使うクライアントごとに要る(無いとそのクライアントのログイン画面が出ない)。
# 値はデザイントークンから生成する(packages/design-tokens の mise run gen:tokens)。書かなかった項目は Cognito の既定
resource "aws_cognito_managed_login_branding" "this" {
  for_each = {
    mobile = aws_cognito_user_pool_client.mobile.id
    web    = aws_cognito_user_pool_client.web.id
    admin  = aws_cognito_user_pool_client.admin.id
  }

  user_pool_id = aws_cognito_user_pool.this.id
  client_id    = each.value
  settings     = file("${path.module}/../../../packages/design-tokens/generated/cognito-branding.json")
}

locals {
  issuer = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}
