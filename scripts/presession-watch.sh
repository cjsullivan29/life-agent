#!/usr/bin/env bash
# Pre-session watcher. Cron runs it every 5 minutes from 4:00 to 6:55am.
# WHOOP scores recovery as soon as Christian ends his sleep. The first run after that sends the
# pre-session routine, once a day: today's session and targets, adjusted for recovery, before he trains.
set -uo pipefail
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
DB="$AGENT_DIR/db/life.db"
STATE="$AGENT_DIR/log/presession.last"
TODAY="$(date +%F)"

[ "$(cat "$STATE" 2>/dev/null)" = "$TODAY" ] && exit 0

python3 "$AGENT_DIR/scripts/whoop.py" sync --days 2 >/dev/null 2>>"$AGENT_DIR/log/whoop-errors.log" || true

scored="$(sqlite3 "$DB" "SELECT 1 FROM metrics WHERE metric_key='whoop_recovery' AND measured_on=date('now','localtime') LIMIT 1;")"
[ -n "$scored" ] || exit 0

echo "$TODAY" > "$STATE"
"$AGENT_DIR/scripts/routine.sh" pre-session
