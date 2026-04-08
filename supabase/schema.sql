create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  username text not null,
  avatar text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subject text not null default '',
  date date not null,
  start_time time not null,
  end_time time not null,
  type text not null,
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_time_order check (end_time > start_time)
);

create table if not exists public.actuals (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null unique references public.plans(id) on delete cascade,
  actual_start_time time not null,
  actual_end_time time not null,
  title text not null default '',
  subject text not null default '',
  is_aligned_to_plan boolean not null default true,
  note text not null default '',
  updated_at timestamptz not null default now(),
  constraint actuals_time_order check (actual_end_time > actual_start_time)
);

create table if not exists public.day_notes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  quick_memo text not null default '',
  reflection text not null default '',
  next_focus text not null default '',
  checked_plan boolean not null default false,
  checked_record boolean not null default false,
  checked_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint day_notes_user_date_unique unique (user_id, date)
);

create table if not exists public.month_events (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null,
  start_time time not null,
  end_time time not null,
  repeat text not null default 'none',
  repeat_until date null,
  excluded_dates text[] not null default '{}',
  url text not null default '',
  memo text not null default '',
  checklist jsonb not null default '[]'::jsonb,
  location_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint month_events_time_order check (end_time > start_time)
);

create index if not exists plans_user_date_idx on public.plans (user_id, date);
create index if not exists actuals_user_updated_idx on public.actuals (user_id, updated_at desc);
create index if not exists day_notes_user_date_idx on public.day_notes (user_id, date);
create index if not exists month_events_user_date_idx on public.month_events (user_id, date);

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.actuals enable row level security;
alter table public.day_notes enable row level security;
alter table public.month_events enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "plans_manage_own" on public.plans;
create policy "plans_manage_own"
on public.plans
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "actuals_manage_own" on public.actuals;
create policy "actuals_manage_own"
on public.actuals
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "day_notes_manage_own" on public.day_notes;
create policy "day_notes_manage_own"
on public.day_notes
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "month_events_manage_own" on public.month_events;
create policy "month_events_manage_own"
on public.month_events
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
