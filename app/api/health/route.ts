import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  try {
    const env = getEnv();
    const tables = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `;

    return NextResponse.json({
      ok: true,
      appUrl: env.APP_URL,
      openaiModel: env.OPENAI_MODEL,
      telegramAdminIdsConfigured: env.TELEGRAM_ADMIN_IDS.split(",").filter(Boolean).length,
      tables: tables.map((row) => row.table_name)
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown health check error"
    }, { status: 500 });
  }
}
