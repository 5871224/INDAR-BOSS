-- Run against the existing dedicated soyal database as its owner.
-- Each IP is stored separately; the metadata row serializes competing edits.
create table if not exists public.ip_block_entries (
  ip inet primary key check (family(ip) = 4 and masklen(ip) = 32),
  event_time text not null default '' check (char_length(event_time) <= 64)
);
create table if not exists public.ip_exclusions (
  ip inet primary key check (family(ip) = 4 and masklen(ip) = 32)
);
create table if not exists public.ip_block_state (
  id boolean primary key default true check (id),
  threshold integer not null default 4 check (threshold between 2 and 254),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);
insert into public.ip_block_state (id) values (true) on conflict (id) do nothing;
revoke all on public.ip_block_entries, public.ip_exclusions, public.ip_block_state from public;
grant select, insert, update, delete on public.ip_block_entries, public.ip_exclusions, public.ip_block_state to soyal_app;
