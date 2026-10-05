-- AD ZONEX — run this ONCE in Supabase → SQL Editor → New query → Run.

-- 1) Table for enquiries, gallery, reviews, service edits, backups, login lock-outs.
create table if not exists public.kv_store (
  key         text primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

-- Lock it down: with RLS on and NO policies, the public/anon key can read and
-- write NOTHING. Only the website's server (service role key) can access it.
alter table public.kv_store enable row level security;
revoke all on public.kv_store from anon, authenticated;

-- 2) Private bucket for uploaded photos (served through /api/media/<id>).
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;
