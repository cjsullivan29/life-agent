# Life Agent

Christian's personal life agent: Claude Code on a private server, reachable through Telegram, running a life CRM with five improvement loops.

- `CLAUDE.md`: the agent's instructions
- `SETUP.md`: setup, WHOOP, GitHub updates, operations
- `db/`: schema, seed data, migrations (the database itself is never committed)
- `scripts/`: launch, routines, backup, WHOOP sync, migrations, updates
- `system/`: systemd service and cron schedule
- `templates/`: starting copies of the server-only files in `local/`

Personal data (`db/*.db`, `local/`, `secrets/`, `log/`, `backups/`) is gitignored and lives only on the server.
