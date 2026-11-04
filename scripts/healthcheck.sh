#!/usr/bin/env bash
# Runs every 10 minutes from cron. If the agent's session is gone on two checks in a row,
# texts Christian directly (the agent can't, since it's the thing that's down).
# Texts once when it goes down and once when it's back. Two checks in a row means the
# nightly restart and quick systemd restarts never trigger an alert.
# Also watches the agent's screen for a Claude usage-limit message, since a limited agent
# looks alive but can't reply or run routines.
set -uo pipefail
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
SESSION="lifeagent"
STATE="$AGENT_DIR/log/health.state"   # holds: <consecutive failures> <alerted 0/1>

FAILS=0; ALERTED=0
[ -f "$STATE" ] && read -r FAILS ALERTED < "$STATE"

check_usage_limit() {
  local LIMIT_STATE="$AGENT_DIR/log/limit.state" was=0 line
  [ -f "$LIMIT_STATE" ] && read -r was < "$LIMIT_STATE"
  # Last lines of the screen, minus inbound Telegram messages (lines with "←") so his own
  # texts mentioning limits don't count.
  line="$(tmux capture-pane -p -t "$SESSION" 2>/dev/null | grep -v '←' | grep -v '^[[:space:]]*$' | tail -n 15 \
          | grep -iE 'usage limit|limit reached|hit your (usage )?limit|out of (extra )?usage|rate.limit' | tail -n 1 \
          | sed 's/^[[:space:]│|>]*//; s/[[:space:]│|]*$//' | cut -c1-200)"
  if [ -n "$line" ] && [ "$was" = "0" ]; then
    "$AGENT_DIR/scripts/alert.sh" "Life agent hit a Claude usage limit, so it can't reply or run routines until it resets. On screen: \"$line\"" && echo 1 > "$LIMIT_STATE"
  elif [ -z "$line" ] && [ "$was" = "1" ]; then
    "$AGENT_DIR/scripts/alert.sh" "Life agent is past the usage limit and working again. Anything scheduled while it was limited may not have gone out." && echo 0 > "$LIMIT_STATE"
  fi
}

if tmux has-session -t "$SESSION" 2>/dev/null; then
  if [ "$ALERTED" = "1" ]; then
    "$AGENT_DIR/scripts/alert.sh" "Life agent is back up."
  fi
  echo "0 0" > "$STATE"
  check_usage_limit
  exit 0
fi

FAILS=$((FAILS + 1))
if [ "$FAILS" -ge 2 ] && [ "$ALERTED" = "0" ]; then
  if "$AGENT_DIR/scripts/alert.sh" "Life agent has been down for 10+ minutes and isn't restarting on its own. On the server, as root: systemctl restart life-agent. If that doesn't hold, journalctl -u life-agent -n 30 shows why."; then
    ALERTED=1
  fi
fi
echo "$FAILS $ALERTED" > "$STATE"
