#!/usr/bin/env bash
# Nightly backup of the life CRM.
# 1. Local copy of the database in backups/, last 30 days kept.
# 2. If local/offsite.env exists: the database plus local/ (settings, playbook, handoff note),
#    encrypted with age, uploaded with rclone, last 30 days kept. The provider only ever sees
#    encrypted data, and the key that unlocks it is not on this server.
# Any failure texts Christian directly.
set -euo pipefail
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
BACKUP_DIR="$AGENT_DIR/backups"
LOG="$AGENT_DIR/log/backup.log"
STAMP="$(date +%F)"
mkdir -p "$BACKUP_DIR" "$AGENT_DIR/log"

fail() {
  echo "$(date '+%F %T') FAILED: $1" >> "$LOG"
  "$AGENT_DIR/scripts/alert.sh" "Backup failed: $1. Details in log/backup.log." || true
  exit 1
}

# --- Local copy ---
sqlite3 "$AGENT_DIR/db/life.db" ".backup '$BACKUP_DIR/life-$STAMP.db'" || fail "local database copy"
find "$BACKUP_DIR" -name 'life-*.db' -mtime +30 -delete
echo "$(date '+%F %T') local OK: life-$STAMP.db" >> "$LOG"

# --- Off-server copy (only once it's set up; see SETUP.md, "Off-server backups") ---
OFFSITE_ENV="$AGENT_DIR/local/offsite.env"
[ -f "$OFFSITE_ENV" ] || exit 0
# shellcheck disable=SC1090
source "$OFFSITE_ENV"
[ -n "${OFFSITE_REMOTE:-}" ] && [ -n "${AGE_RECIPIENT:-}" ] || fail "local/offsite.env is missing OFFSITE_REMOTE or AGE_RECIPIENT"
command -v age >/dev/null || fail "age isn't installed (run update.sh)"
command -v rclone >/dev/null || fail "rclone isn't installed (run update.sh)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/life-agent-$STAMP.tar.gz.age"
tar -czf - -C "$AGENT_DIR" "backups/life-$STAMP.db" local \
  | age -r "$AGE_RECIPIENT" -o "$ARCHIVE" || fail "encrypting"
rclone copyto "$ARCHIVE" "$OFFSITE_REMOTE/$(basename "$ARCHIVE")" --quiet 2>>"$LOG" || fail "uploading"
rclone delete "$OFFSITE_REMOTE" --min-age 30d --include 'life-agent-*.tar.gz.age' --quiet 2>>"$LOG" \
  || echo "$(date '+%F %T') warning: couldn't prune old off-server copies" >> "$LOG"
echo "$(date '+%F %T') off-server OK: $(basename "$ARCHIVE")" >> "$LOG"
