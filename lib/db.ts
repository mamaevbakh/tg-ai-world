import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/env";

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

let cachedSql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!cachedSql) {
    cachedSql = neon(env.DATABASE_URL);
  }

  return cachedSql;
}

export const sql: SqlTag = (strings, ...values) => {
  return getSql()(strings, ...values) as unknown as Promise<Record<string, unknown>[]>;
};
