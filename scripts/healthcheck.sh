#!/usr/bin/env bash
# Runs every 10 minutes from cron. If the agent's session is gone on two checks in a row,
# texts Christian directly (the agent can't, since it's the thing that's down).
# Texts once when it goes down and once when it's back. Two checks in a row means the
# nightly restart and quick systemd restarts never trigger an alert.
set -uo pipefail
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
SESSION="lifeagent"
STATE="$AGENT_DIR/log/health.state"   # holds: <consecutive failures> <alerted 0/1>

FAILS=0; ALERTED=0
[ -f "$STATE" ] && read -r FAILS ALERTED < "$STATE"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  if [ "$ALERTED" = "1" ]; then
    "$AGENT_DIR/scripts/alert.sh" "Life agent is back up."
  fi
  echo "0 0" > "$STATE"
  exit 0
fi

FAILS=$((FAILS + 1))
if [ "$FAILS" -ge 2 ] && [ "$ALERTED" = "0" ]; then
  if "$AGENT_DIR/scripts/alert.sh" "Life agent has been down for 10+ minutes and isn't restarting on its own. On the server, as root: systemctl restart life-agent. If that doesn't hold, journalctl -u life-agent -n 30 shows why."; then
    ALERTED=1
  fi
fi
echo "$FAILS $ALERTED" > "$STATE"
