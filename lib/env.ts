import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-5-mini"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_ADMIN_IDS: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  APP_URL: z.url(),
  ENABLE_BEHAVIOR_EVALUATOR: z.string().default("true")
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }

  return cachedEnv;
}

export const env = new Proxy({} as AppEnv, {
  get(_target, property: keyof AppEnv) {
    return getEnv()[property];
  }
});

export function getTelegramAdminIds(): string[] {
  return getEnv().TELEGRAM_ADMIN_IDS.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}
