# Agent 用の VPC。パブリックサブネットだけを作り、タスクには public IP を付ける。
#
# - 既定の VPC は使わない。アカウントやリージョンによっては消されていることがあり、
#   dev と prod で別の VPC にしておくほうが、名前の接頭辞で分ける方針に合う。VPC 自体は無料。
# - プライベートサブネット + NAT Gateway にはしない。NAT Gateway は1つで月 45 USD ほど
#   (東京、時間料金だけ)かかり、データ処理の料金も乗る。Agent は OpenAI と LiveKit に
#   出ていくだけなので、public IP(月 3.6 USD ほど)で直接出るほうが安い。
# - 受信はセキュリティグループで全部閉じる。public IP があっても、外から届く経路はない。
#   ヘルスチェック(8081)はコンテナの中から叩くので、開けなくてよい。
# - VPC エンドポイント(ECR、Logs、SSM)も、public IP で届くので作らない(1つで月 10 USD ほど)。
#
# ほかに VPC が要るもの(RDS など)が出てきたら、このファイルを network モジュールに分ける。

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.az_count)
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = var.name
  }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = {
    Name = var.name
  }
}

resource "aws_subnet" "public" {
  count = var.az_count

  vpc_id            = aws_vpc.this.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index)

  # サービスの assign_public_ip で付けるので、サブネットの既定では付けない
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.name}-public-${local.azs[count.index]}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = {
    Name = "${var.name}-public"
  }
}

resource "aws_route_table_association" "public" {
  count = var.az_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# 受信のルールを持たない。送信は全部許す(LiveKit の WebRTC は UDP を使い、
# ポートの範囲が広いので、宛先やポートでは絞らない)
resource "aws_security_group" "task" {
  name        = var.name
  description = "LiveKit Agent (egress only)"
  vpc_id      = aws_vpc.this.id

  tags = {
    Name = var.name
  }
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.task.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
