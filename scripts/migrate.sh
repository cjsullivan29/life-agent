#!/usr/bin/env bash
# Applies any database migrations in db/migrations/ that haven't run yet. Safe to run repeatedly.
set -euo pipefail
AGENT_DIR="${AGENT_DIR:-$HOME/life-agent}"
DB="$AGENT_DIR/db/life.db"
[ -f "$DB" ] || { echo "No database at $DB. Run init-db.sh first."; exit 1; }

sqlite3 "$DB" "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT DEFAULT (datetime('now','localtime')));"

for f in "$AGENT_DIR"/db/migrations/*.sql; do
  [ -e "$f" ] || continue
  version="$(basename "$f" .sql)"
  if [ -n "$(sqlite3 "$DB" "SELECT 1 FROM schema_migrations WHERE version='$version';")" ]; then
    echo "  already applied: $version"
  else
    sqlite3 "$DB" < "$f"
    sqlite3 "$DB" "INSERT OR IGNORE INTO schema_migrations (version) VALUES ('$version');"
    echo "  applied: $version"
  fi
done
