#!/usr/bin/env bash
# Nightly backup of the life CRM. Keeps the last 30 days.
BACKUP_DIR="$HOME/life-agent/backups"
mkdir -p "$BACKUP_DIR"
sqlite3 "$HOME/life-agent/db/life.db" ".backup '$BACKUP_DIR/life-$(date +%F).db'"
find "$BACKUP_DIR" -name 'life-*.db' -mtime +30 -delete
