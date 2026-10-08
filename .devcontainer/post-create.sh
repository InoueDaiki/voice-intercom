#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

mise trust --yes
mise install --yes
# プロジェクトの外でも mise の Python を既定にする(VS Code の Python 拡張が別の Python を入れようとしないように)
python_version="$(mise current python)"
(cd "$HOME" && mise use --global "python@$python_version")
mise run setup
