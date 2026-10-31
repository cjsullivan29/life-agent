#!/usr/bin/env bash
# Installs the latest version of the agent from GitHub. Run as root:
#   bash /home/agent/life-agent/scripts/update.sh
# Your data (database, logs, backups, secrets, local settings) is never touched by git.
#
# Two phases: this copy pulls the update, then hands off to the freshly pulled copy
# (--after-pull) so new install steps always run, even when this file itself changed.
set -euo pipefail

main() {
  DEST="/home/agent/life-agent"
  [ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
  [ -d "$DEST/.git" ] || { echo "$DEST isn't connected to GitHub yet. See SETUP.md, 'Connecting to GitHub'."; exit 1; }
  as_agent() { sudo -u agent -H bash -c "cd '$DEST' && $*"; }

  if [ "${1:-}" != "--after-pull" ]; then
    echo "1/5 Checking GitHub for updates"
    as_agent "git fetch --quiet origin"
    OLD="$(as_agent 'git rev-parse HEAD')"
    NEW="$(as_agent 'git rev-parse origin/main')"
    if [ "$OLD" = "$NEW" ]; then
      echo "   Already up to date."
    else
      echo "   Changes:"
      as_agent "git log --oneline $OLD..$NEW" | sed 's/^/     /'
    fi

    echo "2/5 Backing up the database"
    as_agent "./scripts/backup.sh"

    echo "3/5 Installing the update"
    as_agent "git merge --ff-only --quiet origin/main"
    exec bash "$DEST/scripts/update.sh" --after-pull
  fi

  chmod +x "$DEST"/scripts/*.sh "$DEST"/scripts/*.py
  as_agent "./scripts/ensure-local.sh"

  echo "4/5 Updating the database"
  as_agent "AGENT_DIR='$DEST' ./scripts/migrate.sh"

  echo "5/5 Updating the schedule and restarting"
  install -m 644 "$DEST/system/life-agent.cron" /etc/cron.d/life-agent
  for unit in "$DEST"/system/*.service; do
    install -m 644 "$unit" "/etc/systemd/system/$(basename "$unit")"
  done
  systemctl daemon-reload
  systemctl enable --quiet life-dashboard 2>/dev/null || true
  systemctl restart life-agent
  systemctl restart life-dashboard
  echo
  echo "Done. Now running: $(as_agent 'git log -1 --format="%h %s"')"
}

main "$@"
