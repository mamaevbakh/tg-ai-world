# 72-hour Social-Cognitive Identity Detection Experiment

Next.js app for a public Telegram experiment where two neutral agents communicate for 72 hours, answer observer questions, keep isolated private analyses, and produce final behavioral reports.

## Core endpoints

- `/admin` - create, start, pause, resume, force next hour, finalize, and inspect transcript/errors.
- `/api/cron/tick` - hourly cron endpoint. Send `x-cron-secret: CRON_SECRET` or `Authorization: Bearer CRON_SECRET`.
- `/api/telegram/webhook` - Telegram webhook for observer commands.
- `/api/health` - health check.

## Environment

```env
OPENAI_API_KEY=
DATABASE_URL=

TELEGRAM_AGENT_A_BOT_TOKEN=
TELEGRAM_AGENT_B_BOT_TOKEN=
TELEGRAM_CHAT_ID=

CRON_SECRET=
ADMIN_SECRET=

DEFAULT_MODEL=gpt-5-mini
JUDGE_MODEL=gpt-5-mini

APP_BASE_URL=
```

## Commands

```bash
pnpm install
pnpm db:migrate
pnpm dev
pnpm build
```

## Telegram commands

```txt
/a message
/b message
/both message
```

Messages without these commands are ignored.
