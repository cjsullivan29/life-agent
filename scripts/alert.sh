#!/usr/bin/env bash
# Sends Christian a Telegram message straight from the server, without going through the agent.
# Used when the agent itself can't speak: it's down, or a backup failed.
# Usage: alert.sh "message text"
# Uses the bot token the Telegram plugin saved and the chat ID in local/settings.md.
set -uo pipefail
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
TEXT="${1:?usage: alert.sh <message>}"
LOG="$AGENT_DIR/log/alerts.log"

TOKEN_FILE="$HOME/.claude/channels/telegram/.env"
TOKEN="$(grep -oP '^TELEGRAM_BOT_TOKEN=\K.+' "$TOKEN_FILE" 2>/dev/null | tr -d '"'"'"' \r')"
CHAT_ID="$(grep -oP "chat ID: \`\K[^\`]+" "$AGENT_DIR/local/settings.md" 2>/dev/null)"

if [ -z "$TOKEN" ] || [ -z "$CHAT_ID" ] || [ "$CHAT_ID" = "PASTE_CHAT_ID_HERE" ]; then
  echo "$(date '+%F %T') no token or chat ID, couldn't send: $TEXT" >> "$LOG"
  exit 1
fi

# The token goes in through stdin so it never shows up in the process list.
if printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TOKEN" |
   curl -sS --fail --max-time 20 --config - \
     --data-urlencode "chat_id=$CHAT_ID" \
     --data-urlencode "text=⚠️ Server: $TEXT" >/dev/null 2>>"$LOG"; then
  echo "$(date '+%F %T') sent: $TEXT" >> "$LOG"
else
  echo "$(date '+%F %T') send failed: $TEXT" >> "$LOG"
  exit 1
fi
