#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# virtiofs(Docker Desktop)では、worktree を消した直後などにリポジトリの所有者が一瞬 root に見え、
# git が dubious ownership で止まる。コンテナの中で使うのは自分だけなので、所有者のチェックを外す
git config --global --add safe.directory /workspaces/voice-intercom

mise trust --yes
mise install --yes
# プロジェクトの外でも mise の Python を既定にする(VS Code の Python 拡張が別の Python を入れようとしないように)
python_version="$(mise current python)"
(cd "$HOME" && mise use --global "python@$python_version")
mise run setup
# .env の DEV_HOST がまだないと失敗するので、止めずに続ける(後から手で実行する)
mise run local:init || echo "local:init に失敗した。.env を用意してから mise run local:init を実行する" >&2
