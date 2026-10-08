#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

mise trust --yes
mise install --yes
mise run setup
