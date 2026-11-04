#!/usr/bin/env bash
# Creates the server-only files the agent needs, without overwriting anything that exists.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p local log backups
[ -f local/settings.md ] || cp templates/settings.md local/settings.md
[ -f local/playbook.md ] || cp templates/playbook.md local/playbook.md
[ -f local/handoff.md ] || cp templates/handoff.md local/handoff.md
if grep -q PASTE_CHAT_ID_HERE local/settings.md; then
  echo "   Note: add your Telegram chat ID to local/settings.md"
fi
