-- Run this file while connected to the separate `soyal` database.
-- The application role should be `soyal_app`; do not run the API with a superuser.

create table if not exists public.door_settings (
  id bigint generated always as identity primary key,
  door_no integer not null check (door_no >= 0),
  door_name text not null check (char_length(btrim(door_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint door_settings_door_no_key unique (door_no)
);

create table if not exists public.user_settings (
  id bigint generated always as identity primary key,
  user_address integer not null check (user_address >= 0),
  user_name text not null check (char_length(btrim(user_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_user_address_key unique (user_address)
);

revoke all on schema public from public;
grant usage on schema public to soyal_app;
revoke all on public.door_settings, public.user_settings from public;
grant select, insert, update, delete on public.door_settings, public.user_settings to soyal_app;
grant usage, select on sequence public.door_settings_id_seq, public.user_settings_id_seq to soyal_app;
