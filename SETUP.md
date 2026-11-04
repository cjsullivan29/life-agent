# Life Agent: Setup Guide

Your agent is Claude Code running 24/7 on a small cloud server. You reach it through Telegram, and it keeps your life in a private database on that server. Plan on about an hour the first time. Paste the commands as written; anything in `CAPS` is yours to fill in.

## What's in this folder

| File | What it does |
|---|---|
| `CLAUDE.md` | The agent's brain: personality, how it logs, proactive rules, routines, what it can do alone vs. ask first. Claude Code reads it automatically. |
| `local/` | Server-only files, never in git: `settings.md` (your chat ID) and `playbook.md` (rules the agent learned, which you approved). Created from `templates/`. |
| `knowledge/food.md` | Food preferences and targets the meal planner works from. |
| `db/schema.sql` | The life CRM structure: domains, people, threads, entries, tasks, goals, metrics. |
| `db/seed.sql` | Starting data: 9 life domains with proactive rules, your current threads, health metrics. |
| `db/migrations/` | Database additions, such as the five loops (experiments, meal plans, decision journal, daily focus, self-improvement). |
| `scripts/init-db.sh` | Creates the database. Run once. |
| `scripts/migrate.sh` | Applies new database migrations. Safe to rerun. |
| `scripts/update.sh` | Installs the latest version from GitHub, keeping all your data. |
| `scripts/whoop.py` | Connects WHOOP and syncs your data. |
| `scripts/start-agent.sh` | Launches Claude Code with the Telegram channel. |
| `scripts/routine.sh` | Sends the agent a scheduled task (morning brief, evening check-in, meal plan, weekly review). |
| `scripts/backup.sh` | Nightly database backup, keeps 30 days. |
| `system/life-agent.service` | Keeps the agent running and restarts it if it crashes. |
| `system/life-agent.cron` | The schedule: 6:45am weekday brief, 8:30pm check-in, Saturday 9am meal plan, Sunday 7pm review, nightly backup and restart. |

## What you need

- Your Claude Pro or Max plan. The agent runs on your plan's usage, with no separate API bill.
- Telegram on your phone.
- A cloud server: **Ubuntu 24.04**, a US region, **at least 2 GB of RAM**.

---

## Step 1: Set up the server

Create the server in your provider's dashboard. Copy its IP address, then from your computer's terminal:

```bash
ssh root@SERVER_IP
```

On the server, run:

```bash
# Create a user for the agent, set your timezone, install basics
adduser --disabled-password --gecos "" agent
timedatectl set-timezone America/Indianapolis
apt update && apt install -y tmux curl unzip git sqlite3
```

## Step 2: Copy the agent folder up

Unzip `life-agent.zip` on your computer. Then, from your computer (not the server):

```bash
scp -r life-agent root@SERVER_IP:/home/agent/
```

Back on the server:

```bash
chown -R agent:agent /home/agent/life-agent
chmod +x /home/agent/life-agent/scripts/*.sh
```

## Step 3: Install Claude Code and Bun, and create the database

```bash
su - agent
curl -fsSL https://claude.ai/install.sh | bash
curl -fsSL https://bun.sh/install | bash
exec bash -l   # reload so both commands are found
claude --version && bun --version

~/life-agent/scripts/init-db.sh
```

The last line should report 16 threads and 9 domains.

Log in to Claude:

```bash
cd ~/life-agent
claude
```

It shows a login link. Open it, sign in with your Claude account, and paste the code back. Accept the prompt to trust the `life-agent` folder.

## Step 4: Create your Telegram bot

On your phone, open Telegram and message **@BotFather**:

1. Send `/newbot`
2. Give it a display name (whatever you'll call the agent)
3. Give it a username ending in `bot`, like `christian_ops_bot`
4. Copy the token it gives you. Treat it like a password.

## Step 5: Install and connect the Telegram plugin

Still inside Claude Code on the server:

```
/plugin install telegram@claude-plugins-official
```

Choose **user scope** when asked. If it says the marketplace isn't found, run `/plugin marketplace add anthropics/claude-plugins-official` first and retry. If it says to run `/reload-plugins`, do that.

```
/telegram:configure YOUR_BOT_TOKEN
```

Then exit Claude Code (`/exit`) and relaunch with the channel on:

```bash
claude --channels plugin:telegram@claude-plugins-official
```

## Step 6: Pair your phone and lock it down

1. In Telegram, send your bot any message. It replies with a pairing code.
2. On the server, in Claude Code:
   ```
   /telegram:access pair THE_CODE
   /telegram:access policy allowlist
   ```
   The allowlist step matters. After it, only your account can talk to the agent.
3. In Telegram, ask: **"What's my Telegram chat ID?"** Copy the number it gives you.
4. Exit Claude Code. Open `local/settings.md` and replace `PASTE_CHAT_ID_HERE` with that number:
   ```bash
   nano ~/life-agent/local/settings.md
   ```
   (Ctrl+O to save, Ctrl+X to exit.)

## Step 7: Make it always-on

Switch back to root (`exit`), then:

```bash
cp /home/agent/life-agent/system/life-agent.service /etc/systemd/system/
cp /home/agent/life-agent/system/life-agent.cron /etc/cron.d/life-agent
chmod 644 /etc/cron.d/life-agent
systemctl daemon-reload
systemctl enable --now life-agent
```

The first time it launches unattended, Claude Code asks you once to confirm skip-permissions mode. Attach to the session to accept it:

```bash
sudo -u agent tmux attach -t lifeagent
```

Accept the prompt, then detach without stopping it: **Ctrl+B, then D**.

## Step 8: Test it

1. In Telegram: **"Let's get set up."** It should start onboarding, one question at a time.
2. Send a WHOOP screenshot. It should log your recovery and sleep and give one line of interpretation.
3. Send a photo of a meal. It should estimate macros and tell you today's protein so far.
4. Fire a morning brief manually from the server:
   ```bash
   sudo -u agent /home/agent/life-agent/scripts/routine.sh morning-brief
   ```
5. Reboot the server (`reboot`), wait a minute, and text it again to confirm it came back on its own.

---

## How to use it

Just text it like a person. It does all the logging. Some examples:

- "Coffee with Mike, he's leaving his job. Follow up in 2 weeks."
- "Recovery 34% today." (or send the WHOOP screenshot)
- "Chicken bowl, double meat, rice, no sauce."
- "Medicare survey's at 4 of 10."
- "Idea: build a golf swing tracker." (expect it to push back)
- "What should I do next?"
- "Who haven't I talked to in a while?"
- "How's my protein been this week?"

## Connecting WHOOP

The agent pulls recovery, HRV, resting heart rate, sleep, strain, and calories burned straight from WHOOP at 6:25am, 10am, and 8pm. One-time setup, about 10 minutes.

**1. Create a WHOOP developer app** at [developer.whoop.com](https://developer.whoop.com), signing in with your WHOOP account. Create a team if it asks, then an app:

- **Name:** anything, like `Life Agent`
- **Redirect URL:** exactly `http://localhost:3000/callback`
- **Scopes:** turn on `offline`, `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:body_measurement`
- If the form requires anything else (a privacy policy URL, a logo), stop and ask rather than guessing.

Copy the **Client ID** and **Client Secret**. The secret is a password: don't paste it into any chat.

**2. Connect, on the server as the agent user:**

```bash
su - agent
python3 ~/life-agent/scripts/whoop.py auth
```

Paste the Client ID and Secret when asked. It prints a link: open it on your laptop or phone, sign in to WHOOP, and approve. Your browser then lands on a `localhost` page that **won't load. That's expected.** Copy the whole address from the address bar (it contains `?code=`) and paste it back into the terminal.

**3. Pull your history**, which also gives your experiments a baseline:

```bash
python3 ~/life-agent/scripts/whoop.py sync --days 30
python3 ~/life-agent/scripts/whoop.py status
```

You should see `SYNC OK` with a count of values and days.

The credentials live in `~/life-agent/secrets/`, readable only by the agent user. If a sync ever fails with a token error, run `whoop.py auth` again.

## Connecting to GitHub (one time)

Updates come from a private GitHub repo (`cjsullivan29/life-agent`). The repo holds only the agent's code and instructions. Your database, logs, backups, secrets, and `local/` files are excluded and never leave the server.

The server reads the repo with a **deploy key**: a key that can read this one repo and nothing else on your account.

**1. Make the server's key**, as the agent user:

```bash
su - agent
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "life-agent-server"
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null
cat ~/.ssh/github_deploy.pub
```

**2. Add it to the repo.** On GitHub: the `life-agent` repo, then **Settings → Deploy keys → Add deploy key**. Title it `linode`, paste the line that `cat` printed, and leave **Allow write access unchecked**.

**3. Test it:**

```bash
ssh -T git@github.com
```

It should say you've successfully authenticated (and that GitHub doesn't provide shell access, which is fine).

**4. Connect your existing folder.** This keeps all your data and moves your chat ID and playbook into `local/`:

```bash
git clone git@github.com:cjsullivan29/life-agent.git ~/life-agent-repo
bash ~/life-agent-repo/scripts/adopt-git.sh
exit
bash /home/agent/life-agent/scripts/update.sh
```

The `exit` returns you to root for the last line. A backup of the old folder is kept as `life-agent.pre-git-<date>`.

## The dashboard (private, through Tailscale)

The dashboard is a web page over your life database: Today, Health, Life, Food, and Loops, with a **Together** switch for check-ins with Maddie. It runs on the server but has **no public address**: it only answers on the server itself, and Tailscale (a private network between your own devices) carries it to your phone and laptop. `update.sh` installs and starts it; these steps make it reachable.

**1. Put the server on Tailscale**, as root:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

`tailscale up` prints a login link. Open it and sign in (create a free Tailscale account if you don't have one).

**2. Serve the dashboard on your private network:**

```bash
tailscale serve --bg 8787
```

If it says HTTPS isn't enabled for your network, it prints a link to turn it on in the Tailscale admin console. Do that, then run the command again. It ends by printing your dashboard's address, like `https://localhost.your-tailnet.ts.net`. (`tailscale serve status` shows it again later.)

**3. Your phone and laptop:** install the Tailscale app, sign in with the same account, and open that address. On iPhone: Share → **Add to Home Screen** makes it open like an app.

**4. Lock it to you (recommended).** Tailscale tells the dashboard who's visiting. Allow only your login:

```bash
echo 'DASHBOARD_ALLOWED_LOGINS=your-tailscale-login@example.com' > /home/agent/life-agent/local/dashboard.env
chown agent:agent /home/agent/life-agent/local/dashboard.env
systemctl restart life-dashboard
```

Use the email you signed in to Tailscale with. If the page then says "Not allowed," the email doesn't match exactly.

**Maddie on her own laptop:** you can share just this server with her Tailscale account (Tailscale admin console → the machine → Share), then add her login to `DASHBOARD_ALLOWED_LOGINS`, comma-separated. Keep in mind Together mode is a display filter, not a lock: anyone you let in can switch it off.

**If it won't load:** `systemctl status life-dashboard --no-pager` on the server shows whether it's running, and `journalctl -u life-dashboard -n 30` shows its recent output.

## Alerts when the agent is down

Nothing to set up. Every 10 minutes the server checks that the agent is running. If it's been down for two checks in a row, the server texts you through the same Telegram bot (messages start with ⚠️ Server), and texts again when it's back. You'll also get a text if a scheduled routine is skipped or a backup fails. The nightly restart takes seconds, so it never triggers an alert.

To test it, on the server as root:

```bash
sudo -u agent /home/agent/life-agent/scripts/alert.sh "Test alert"
```

If no text arrives, `cat /home/agent/life-agent/log/alerts.log` says why.

The same check watches for Claude usage limits. A limited agent looks alive but can't reply, so if the agent's screen shows a usage-limit message, you get a text quoting it, and another once it's working again.

## Off-server backups (one time, about 15 minutes)

The nightly backup keeps 30 days of copies on the server itself. If the server is ever lost, those go with it. This adds an encrypted copy somewhere else each night.

How it works: each night the database and your `local/` files (settings, playbook, handoff note) are locked with a key and uploaded. The storage provider only ever sees scrambled data. The key that unlocks it lives in your password manager, not on the server, so a lost server doesn't take the key with it.

These steps use Backblaze B2, because its free tier easily covers a database this size. Any storage rclone supports works the same way.

**1. Run the update first** (it installs the two tools this uses), as root:

```bash
bash /home/agent/life-agent/scripts/update.sh
```

**2. Make the encryption key**, still as root:

```bash
age-keygen
```

It prints three lines. **Save all three in your password manager** as "Life agent backup key." The `AGE-SECRET-KEY-1…` line is what unlocks your backups; without it they can't be opened by anyone, including you. Copy the `age1…` public key from the second line for step 4. Nothing was saved on the server.

**3. Create the storage**, at [backblaze.com](https://www.backblaze.com) (create a B2 account if you don't have one):

- **Buckets → Create a Bucket.** Pick a unique name like `life-agent-backup-cs29`, and leave it **Private**.
- **Application Keys → Add a New Application Key.** Name it `linode`, allow access to **only that bucket**, with Read and Write.
- Copy the **keyID** and **applicationKey**. Backblaze shows the second one only once.

**4. Connect the server**, as the agent user. Replace the four `CAPS` values:

```bash
su - agent
rclone config create offsite b2 account=KEY_ID key=APPLICATION_KEY hard_delete=true
printf 'OFFSITE_REMOTE=offsite:BUCKET_NAME\nAGE_RECIPIENT=AGE_PUBLIC_KEY\n' > ~/life-agent/local/offsite.env
chmod 600 ~/life-agent/local/offsite.env
~/life-agent/scripts/backup.sh && tail -2 ~/life-agent/log/backup.log
exit
```

The last line should end with `off-server OK`. You'll also see the file in the bucket on Backblaze. From now on it runs every night at 3:15am.

**To restore**, on any computer: download the newest `life-agent-….tar.gz.age` from the bucket, save the three key lines from your password manager as `key.txt`, then:

```bash
age -d -i key.txt life-agent-DATE.tar.gz.age | tar -xz
```

That gives you `backups/life-DATE.db` (copy it to `db/life.db` on the new server) and the `local/` folder. WHOOP credentials aren't in the backup on purpose; run `whoop.py auth` again on a new server.

## Updating

Whenever there's a new version, on the server as root:

```bash
bash /home/agent/life-agent/scripts/update.sh
```

It shows what changed, backs up the database, pulls the update, applies database changes, and restarts the agent. If nothing changed, it says so.

## Day-to-day operations

| You want to… | Do this |
|---|---|
| See what the agent is doing | `sudo -u agent tmux attach -t lifeagent` (detach with Ctrl+B, D) |
| Restart it | `systemctl restart life-agent` |
| Change routine times | Edit `/etc/cron.d/life-agent` |
| Check missed routines | `cat /home/agent/life-agent/log/routine-errors.log` |
| Check backups | `tail /home/agent/life-agent/log/backup.log` |
| See what alerts were sent | `cat /home/agent/life-agent/log/alerts.log` |
| Read the agent's handoff note | `cat /home/agent/life-agent/local/handoff.md` |
| Look at the raw data | `sudo -u agent sqlite3 /home/agent/life-agent/db/life.db` |
| Change its personality or rules | Edit `CLAUDE.md`, then restart |

**Why the nightly restart:** a conversation that runs for weeks fills up its context. Restarting at 3:30am gives it a clean slate each day. At 3:10am the agent writes a short handoff note (`local/handoff.md`) with anything from the day that isn't in the database, like a conversation left mid-thread, and reads it after the restart. Backups run at 3:15am, so the note is included.

---

## Phase 2 (after two weeks)

Once it's earned its keep:

- **WHOOP API.** Pull recovery, sleep and strain automatically every morning instead of sending screenshots. This needs a WHOOP developer app and a small sync script; we'll build it together.
- **Calendar.** Today's meetings in the morning brief. In Claude Code, run `/mcp` to see whether your claude.ai Google Calendar connector shows up there.
- **Dashboard.** A visual view of the CRM (domains, threads, trends), built on the same database.
- **Gmail, last.** Read access to your inbox carries the most risk (see below), so it comes after everything else is solid.

## Security notes, read once

- **Skip-permissions mode** means the agent doesn't stop to ask the server's permission before using tools. That's what makes unattended replies possible. The guardrails are the Telegram allowlist (only you), the rules in `CLAUDE.md` (it must ask you before sending, deleting, or touching your calendar), and the server holding nothing beyond your own life data.
- **The database holds personal data**: health numbers, people, money decisions. It stays on your server, backed up nightly. Telegram and Anthropic see the messages you send, so keep things like account numbers out of the chat.
- **The real risk is content, not people.** Once it reads email or web pages, a malicious message could try to instruct it. `CLAUDE.md` tells it to treat all content as data and ask you first. That's why Gmail comes last.
- **Keep Abby Care client data off this server.** It's PHI. `CLAUDE.md` tells the agent to refuse to log it, but the real control is you not pasting it.
- **Never add anyone else to the allowlist.** Anyone on it can give the agent instructions.
- **Channels are a research preview.** Commands or behavior may change. If something breaks after an update, check the [channels docs](https://code.claude.com/docs/en/channels).
