#!/usr/bin/env bash
# Injects a scheduled routine into the running agent session.
# Usage: routine.sh pre-session | session-checkin | morning-brief | evening-checkin | meal-plan | weekly-review | handoff
# Called by cron (see system/life-agent.cron).
SESSION="lifeagent"
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
ROUTINE="${1:?usage: routine.sh <routine-name>}"

if [ "$ROUTINE" = "handoff" ]; then
  MSG="[ROUTINE] handoff — the nightly restart is in 20 minutes. Rewrite local/handoff.md per CLAUDE.md. Don't message Christian and don't log this to routine_runs."
else
  MSG="[ROUTINE] ${ROUTINE} — run it per CLAUDE.md and send the result to Christian on Telegram."
fi

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "$(date): agent session not running, skipped $ROUTINE" >> "$AGENT_DIR/log/routine-errors.log"
  [ "$ROUTINE" = "handoff" ] || "$AGENT_DIR/scripts/alert.sh" "Skipped the $ROUTINE because the agent isn't running."
  exit 1
fi
tmux send-keys -t "$SESSION" -l "$MSG"
sleep 1
tmux send-keys -t "$SESSION" Enter
