alter table final_reports
  add column if not exists telegram_message_ids jsonb not null default '[]'::jsonb;
