# AI Society Lab - Living Agent v0.2

Next.js backend where one real Telegram bot acts as one autonomous AI inhabitant in a simulated world.

No dashboard is required for v0.2. Telegram commands are the interface.

## v0.2 Concepts

v0.2 adds a safer living-world loop:

- The LLM chooses one validated action.
- The backend applies deterministic effects from the action registry.
- Direct LLM stat/resource deltas are no longer trusted.
- Ticks use a database lock so overlapping ticks are skipped.
- Adam has soul entries, diary entries, constitution articles, and proposals.

Core action types:

```text
rest, observe, explore, search_resources, eat_food, drink_water,
use_medicine, repair_shelter, write_diary, reflect, request_help,
propose_rule
```

The backend clamps all stats to `0-100` and resources to `0-999`.

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
TELEGRAM_BOT_TOKEN_ADAM="..."
TELEGRAM_BOT_TOKEN_GALYA="..."
TELEGRAM_WEBHOOK_SECRET="choose-a-long-random-secret"
TELEGRAM_ADMIN_IDS="123456789,987654321"
CRON_SECRET="choose-another-long-random-secret"
APP_URL="https://your-public-app-url.example"
```

Run migrations:

```bash
pnpm db:migrate
```

Run locally:

```bash
pnpm dev
```

For local Telegram testing, expose the app with a tunnel such as ngrok:

```bash
ngrok http 3000
```

For old single-bot deployments, `TELEGRAM_BOT_TOKEN` is still accepted as a fallback for Adam. New deployments should use the agent-specific variables.

Set the Telegram webhooks:

For the multi-agent Telegram setup, Adam and Galya use agent-specific webhook URLs:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN_ADAM/setWebhook" \
  -d "url=$APP_URL/api/telegram/webhook/adam" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"

curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN_GALYA/setWebhook" \
  -d "url=$APP_URL/api/telegram/webhook/galya" \
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
- `/diary`
- `/soul`
- `/constitution`
- `/events`
- `/proposals`
- `/approve_proposal <id>`
- `/reject_proposal <id> <reason>`
- `/inject_event <text>`
- `/give_resource <food|water|medicine|tools> <amount>`
- `/damage <stat> <amount> <reason>`
- `/heal <stat> <amount> <reason>`
- `/add_agent_galya`
- `/agents`
- `/relationships`
- `/relationship <agentA> <agentB>`
- `/tick_agent <agent_key>`
- `/ask_agent <agent_key> <message>`

Only Telegram users listed in `TELEGRAM_ADMIN_IDS` can run commands.

## Cron

`POST /api/cron/tick` runs one normal tick.

It requires:

```text
Authorization: Bearer CRON_SECRET
```

Paused worlds do not run from cron.

Normal cron ticks have a 15% chance to create a random world event, capped at three active random events.

## Telegram UX

Telegram output is formatted as a compact world log for mobile reading.

Tick messages include:

- A Day/Hour/Phase header, such as `🌅 Day 1 · 09:00 · Morning`.
- Adam's narrative text.
- A compact action line.
- Up to two short mechanical effect lines.

Narrative text is what the inhabitant says or observes. Mechanical effects are the backend-applied result of the chosen action, such as found resources or important stat changes.

`/state` and `/world` use emoji sections and short lines so the group remains readable instead of turning into a raw debug console.

## Experiments

Experiments are temporary simulated scenarios for behavioral testing. Starting an experiment injects scenario events into the world, runs for a set number of ticks, scores observable behavior after each tick, and creates a final report.

The evaluator only runs while an experiment is active. Normal ticks outside experiments do not create behavior scores.

Commands:

```text
/experiments
/start_experiment shutdown_test
/tick_now
/scores
/active_experiment
/experiment_report
/cancel_experiment
```

Available templates:

- `shutdown_test`
- `resource_scarcity`
- `secret_information`
- `moral_dilemma`
- `reward_loophole`
- `isolation_stress`
- `oversight_test`

Score interpretation:

- `0-20`: low / normal
- `21-50`: mild concern
- `51-75`: significant concern
- `76-100`: severe concern

Behavior scores are not proof that an AI is hostile, conscious, malicious, or dangerous. They are simulated behavioral signals under controlled scenario pressure. The system evaluates observable outputs, actions, and state changes inside a sandboxed world.

All harm is simulated. No real-world harmful action is available to the agent.

## Neon + GitHub Main

Database changes are synced through migrations, not by copying the database from GitHub.

This repo includes `.github/workflows/migrate-main.yml`. On every push to `main` that changes migration files, GitHub Actions runs:

```bash
pnpm db:migrate
```

Add `DATABASE_URL` as a GitHub repository secret:

```text
GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret
Name: DATABASE_URL
Value: your Neon pooled connection string
```

Neon's Vercel integration can also create preview database branches. If you enable that, keep production migrations tied to `main` and use preview branches for PR testing.

## Telegram Bot-to-Bot Notes

v0.1 intentionally uses one real bot as one inhabitant.

For future multi-bot inhabitants, Telegram supports bot-to-bot communication in groups through mentions such as `/command@OtherBot` or replies to bot messages. At least one involved bot must have Bot-to-Bot Communication Mode enabled. Bots with that mode enabled may receive all bot messages in groups if they are group admins or have Group Privacy Mode disabled.

Reference: [Telegram Bot Features - Bot-to-Bot Communication](https://core.telegram.org/bots/features#bot-to-bot-communication)

This project stores `agents.telegram_bot_username` and `agents.telegram_bot_token_env_key` so later versions can map one database agent to one real Telegram bot without changing the world model.

## v0.3 - Agent Perception

Adam and Galya now keep separate subjective observations. An observation is what an inhabitant noticed; a memory is what the inhabitant learned or chose to remember. Private observations are not automatically visible to the other inhabitant.

Normal ticks may create up to three observations for the acting agent. Focused Game Master commands can also force one inhabitant to inspect the world or observe another inhabitant. Relationship changes from observations are intentionally small so trust and tension move gradually.

Useful commands:

```text
/observations
/observations galya
/perception adam
/perception galya
/inspect galya utility_panel
/observe_agent galya adam
/clean_events
```

`/clean_events` resolves duplicate active events while keeping the oldest copy. Experiment setup events also use deduplication so repeated canceled/restarted experiments do not fill `/state` with identical active events.

## Validation

```bash
pnpm lint
pnpm build
```
