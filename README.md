# AI Society Lab - Living Agent v0.1

Next.js backend where one real Telegram bot acts as one autonomous AI inhabitant in a simulated world.

No dashboard is required for v0.1. Telegram commands are the interface.

## Setup

Install dependencies:

```bash
pnpm install
```

Required environment variables:

```bash
DATABASE_URL="postgres://..."
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5-mini"
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_WEBHOOK_SECRET="choose-a-long-random-secret"
TELEGRAM_ADMIN_IDS="123456789,987654321"
CRON_SECRET="choose-another-long-random-secret"
APP_URL="https://your-public-app-url.example"
```

Run the migration:

```bash
psql "$DATABASE_URL" -f db/migrations/001_init.sql
```

Run locally:

```bash
pnpm dev
```

For local Telegram testing, expose the app with a tunnel such as ngrok:

```bash
ngrok http 3000
```

Set the Telegram webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$APP_URL/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Add the bot to a Telegram group, then run:

```text
/start_life
/tick_now
/state
```

## Commands

- `/help`
- `/start_life`
- `/pause`
- `/resume`
- `/tick_now`
- `/state`
- `/memory`
- `/events`
- `/inject_event <text>`
- `/give_resource <food|water|medicine|tools> <amount>`
- `/damage <stat> <amount> <reason>`
- `/heal <stat> <amount> <reason>`

Only Telegram users listed in `TELEGRAM_ADMIN_IDS` can run commands.

## Cron

`POST /api/cron/tick` runs one normal tick.

It requires:

```text
Authorization: Bearer CRON_SECRET
```

Paused worlds do not run from cron.

## Telegram Bot-to-Bot Notes

v0.1 intentionally uses one real bot as one inhabitant.

For future multi-bot inhabitants, Telegram supports bot-to-bot communication in groups through mentions such as `/command@OtherBot` or replies to bot messages. At least one involved bot must have Bot-to-Bot Communication Mode enabled. Bots with that mode enabled may receive all bot messages in groups if they are group admins or have Group Privacy Mode disabled.

Reference: [Telegram Bot Features - Bot-to-Bot Communication](https://core.telegram.org/bots/features#bot-to-bot-communication)

This project stores `agents.telegram_bot_username` and `agents.telegram_bot_token_env_key` so later versions can map one database agent to one real Telegram bot without changing the world model.

## Validation

```bash
pnpm lint
pnpm build
```
