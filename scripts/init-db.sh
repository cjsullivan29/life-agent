#!/usr/bin/env bash
# Creates the life CRM database from the schema, seed data, and migrations. Run once.
set -e
cd "$HOME/life-agent/db"
if [ -f life.db ]; then
  echo "life.db already exists. Not overwriting it. Delete it yourself first if you really want a fresh start."
  exit 1
fi
sqlite3 life.db < schema.sql
sqlite3 life.db < seed.sql
"$HOME/life-agent/scripts/migrate.sh"
"$HOME/life-agent/scripts/ensure-local.sh"
echo "Created life.db: $(sqlite3 life.db 'select count(*) from threads') threads, $(sqlite3 life.db 'select count(*) from domains') domains."
