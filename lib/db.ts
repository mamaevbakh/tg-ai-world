import { neon } from "@neondatabase/serverless";
import { requireEnv } from "@/lib/env";

type SqlTag = <T extends Record<string, unknown> = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

let cachedSql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!cachedSql) {
    cachedSql = neon(requireEnv("DATABASE_URL"));
  }

  return cachedSql;
}

export const sql: SqlTag = (strings, ...values) => {
  return getSql()(strings, ...values) as unknown as Promise<never[]>;
};
