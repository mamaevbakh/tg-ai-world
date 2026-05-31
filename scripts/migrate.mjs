import { neon } from "@neondatabase/serverless";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadDotEnv() {
  const envPath = ".env";
  if (!existsSync(envPath)) return;

  const contents = readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let statement = "";
  let quote = null;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const next = sqlText[index + 1];

    if (!quote && char === "-" && next === "-") {
      while (index < sqlText.length && sqlText[index] !== "\n") index += 1;
      statement += "\n";
      continue;
    }

    statement += char;

    if ((char === "'" || char === '"') && sqlText[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }

    if (!quote && char === ";") {
      const trimmed = statement.trim();
      if (trimmed) statements.push(trimmed);
      statement = "";
    }
  }

  const trailing = statement.trim();
  if (trailing) statements.push(trailing);

  return statements;
}

loadDotEnv();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const sql = neon(process.env.DATABASE_URL);
const migrationsDir = join(process.cwd(), "db", "migrations");
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

await sql.query(`
  create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )
`);

for (const file of files) {
  const applied = await sql.query("select id from schema_migrations where id = $1", [file]);
  if (applied.length > 0) {
    console.log(`Already applied: ${file}`);
    continue;
  }

  const migration = readFileSync(join(migrationsDir, file), "utf8");
  const statements = splitSqlStatements(migration);

  console.log(`Applying: ${file}`);
  await sql.query("begin");
  try {
    for (const statement of statements) {
      await sql.query(statement);
    }
    await sql.query("insert into schema_migrations (id) values ($1)", [file]);
    await sql.query("commit");
    console.log(`Applied: ${file}`);
  } catch (error) {
    await sql.query("rollback");
    throw error;
  }
}

console.log("Migrations complete.");
