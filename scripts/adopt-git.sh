#!/usr/bin/env bash
# One-time: converts the existing agent folder into a GitHub checkout, keeping all your data.
# Run as the agent user, from a fresh clone:
#   git clone git@github.com:OWNER/life-agent.git ~/life-agent-repo
#   bash ~/life-agent-repo/scripts/adopt-git.sh
set -euo pipefail
LIVE="$HOME/life-agent"
REPO="$HOME/life-agent-repo"
[ "$(whoami)" = "agent" ] || { echo "Run this as the agent user (su - agent)."; exit 1; }
[ -d "$REPO/.git" ] || { echo "Clone the repo to $REPO first."; exit 1; }
[ -d "$LIVE" ] || { echo "No existing agent folder at $LIVE."; exit 1; }
[ ! -d "$LIVE/.git" ] || { echo "$LIVE is already connected to GitHub. Nothing to do."; exit 0; }

STAMP="$(date +%Y%m%d-%H%M%S)"
echo "1/4 Backing up the current folder to $LIVE.pre-git-$STAMP"
cp -a "$LIVE" "$LIVE.pre-git-$STAMP"

echo "2/4 Moving your settings and playbook into local/"
mkdir -p "$LIVE/local"
CHAT_ID="$(grep -oP "chat ID: \`\K[^\`]+" "$LIVE/CLAUDE.md" 2>/dev/null || true)"
if [ -f "$LIVE/local/settings.md" ]; then
  echo "   local/settings.md already exists, keeping it"
else
  cp "$REPO/templates/settings.md" "$LIVE/local/settings.md"
  if [ -n "$CHAT_ID" ] && [ "$CHAT_ID" != "PASTE_CHAT_ID_HERE" ]; then
    sed -i "s/PASTE_CHAT_ID_HERE/$CHAT_ID/" "$LIVE/local/settings.md"
    echo "   Chat ID kept: $CHAT_ID"
  else
    echo "   Warning: no chat ID found. Add it to $LIVE/local/settings.md"
  fi
fi
if [ -f "$LIVE/playbook.md" ] && [ ! -f "$LIVE/local/playbook.md" ]; then
  mv "$LIVE/playbook.md" "$LIVE/local/playbook.md"
fi

echo "3/4 Connecting the folder to GitHub"
mv "$REPO/.git" "$LIVE/.git"
cd "$LIVE"
git reset --hard --quiet origin/main     # replaces tracked files only; your data is untracked
rm -f scripts/upgrade.sh                  # retired: updates now come from GitHub
rm -rf "$REPO"
chmod +x scripts/*.sh scripts/*.py
./scripts/ensure-local.sh

echo "4/4 Done. Now exit to root and run:  bash /home/agent/life-agent/scripts/update.sh"
git log -1 --format="   Version: %h %s"
