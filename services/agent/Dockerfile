# syntax=docker/dockerfile:1
# LiveKit Agent(services/agent)のコンテナイメージ。ECS Fargate(linux/arm64)で動かす。
# uv の workspace なので、ビルドのコンテキストはリポジトリのルートにする。
#   docker build --platform linux/arm64 -f services/agent/Dockerfile .
# 除外するファイルは services/agent/Dockerfile.dockerignore(このファイル専用の .dockerignore)。

# Python の版は mise.toml と揃える。ビルドと実行で同じイメージを使い、venv の python のパスを一致させる
ARG PYTHON_IMAGE=python:3.14.8-slim-trixie

FROM ghcr.io/astral-sh/uv:0.12.23 AS uv

# ---- ビルド: 依存とワークスペースのパッケージを /app/.venv に入れる ----
FROM ${PYTHON_IMAGE} AS build

COPY --from=uv /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /src

# 先に依存だけを入れ、ソースを変えたときにレイヤーのキャッシュが効くようにする。
# uv.lock を検証するため、ワークスペースの全メンバーの pyproject.toml が要る(api は入れない)
COPY pyproject.toml uv.lock ./
COPY services/agent/pyproject.toml services/agent/
COPY services/api/pyproject.toml services/api/
COPY packages/schema/python/pyproject.toml packages/schema/python/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --package voice-intercom-agent --no-default-groups --no-install-workspace

# ワークスペースのパッケージ(agent と schema)を、編集可能ではない形で入れる。
# こうすると実行時のイメージには /app/.venv だけを持っていけばよい
COPY packages/schema/python packages/schema/python
COPY services/agent/src services/agent/src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --package voice-intercom-agent --no-default-groups --no-editable

# ---- 実行: uv もソースも持たない ----
FROM ${PYTHON_IMAGE}

# root で動かさない
RUN groupadd --system --gid 10001 agent \
    && useradd --system --uid 10001 --gid agent --create-home --home-dir /home/agent agent

COPY --from=build /app/.venv /app/.venv

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1

USER agent
WORKDIR /home/agent

# ヘルスチェック(livekit-agents の HTTP サーバー。start のときは 8081)。
# 外から受ける必要はなく、ECS のコンテナのヘルスチェックがコンテナの中から叩く
EXPOSE 8081

# SIGTERM を python が直接受けるよう、exec 形式で起動する(新しいジョブを断り、実行中のジョブを待つ)
CMD ["python", "-m", "voice_intercom_agent", "start"]
