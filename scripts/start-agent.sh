#!/usr/bin/env bash
# Launches the life agent: Claude Code with the Telegram channel, inside this folder.
# Run by systemd inside a tmux session (Claude Code needs an interactive terminal).
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
cd "$HOME/life-agent" || exit 1
exec claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions
