FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

USER vscode
RUN curl -fsSL https://mise.run | sh \
 && echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc \
 && echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc \
 # 名前付きボリュームが vscode の所有で作られるように、先にディレクトリを作っておく
 && mkdir -p ~/.local/share/mise ~/.local/share/pnpm-store ~/.claude
USER root
