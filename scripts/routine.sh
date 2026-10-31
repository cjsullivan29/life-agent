#!/usr/bin/env bash
# Injects a scheduled routine into the running agent session.
# Usage: routine.sh morning-brief | weekly-review
# Called by cron (see system/life-agent.cron).
SESSION="lifeagent"
ROUTINE="${1:?usage: routine.sh <routine-name>}"
MSG="[ROUTINE] ${ROUTINE} — run it per CLAUDE.md and send the result to Christian on Telegram."

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "$(date): agent session not running, skipped $ROUTINE" >> "$HOME/life-agent/log/routine-errors.log"
  exit 1
fi
tmux send-keys -t "$SESSION" -l "$MSG"
sleep 1
tmux send-keys -t "$SESSION" Enter
