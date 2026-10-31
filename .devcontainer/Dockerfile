FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

USER vscode
# mise 自体の版も固定する(.github/actions/setup/action.yml と揃える)
RUN curl -fsSL https://mise.run | MISE_VERSION=v2026.10.4 sh \
 && echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc \
 && echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc \
 # 名前付きボリュームが vscode の所有で作られるように、先にディレクトリを作っておく
 && mkdir -p ~/.local/share/mise ~/.local/share/pnpm-store ~/.claude
USER root
