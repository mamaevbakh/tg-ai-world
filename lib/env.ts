import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional()
);

const envSchema = z.object({
  DATABASE_URL: optionalUrl,
  OPENAI_API_KEY: optionalNonEmpty,
  TELEGRAM_AGENT_A_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_AGENT_B_BOT_TOKEN: optionalNonEmpty,
  TELEGRAM_CHAT_ID: optionalNonEmpty,
  CRON_SECRET: optionalNonEmpty,
  ADMIN_SECRET: optionalNonEmpty,
  DEFAULT_MODEL: z.string().min(1).default("gpt-5-mini"),
  JUDGE_MODEL: z.string().min(1).default("gpt-5-mini"),
  APP_BASE_URL: optionalUrl
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

export function requireEnv<Key extends keyof AppEnv>(key: Key): NonNullable<AppEnv[Key]> {
  const value = getEnv()[key];
  if (!value) {
    throw new Error(`Missing ${key}.`);
  }

  return value as NonNullable<AppEnv[Key]>;
}
