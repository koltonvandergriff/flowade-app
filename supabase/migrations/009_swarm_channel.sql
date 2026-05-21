-- 009_swarm_channel.sql
-- Append-only event log for swarm orchestration runs.

create table if not exists public.swarm_channel_events (
  id            bigint generated always as identity primary key,
  run_id        text not null,
  token_id      bigint not null,
  worker_id     text,            -- nullable for orchestrator-side or system events
  kind          text not null check (kind in ('plan','intent','claim','progress','blocker','diff','done','review-fail','cancel','finish')),
  payload       jsonb not null default '{}'::jsonb,
  user_id       uuid not null default auth.uid(),
  posted_at     timestamptz not null default now(),
  unique (run_id, token_id)
);

create index if not exists swarm_channel_events_run_token_idx on public.swarm_channel_events (run_id, token_id);
create index if not exists swarm_channel_events_user_run_idx on public.swarm_channel_events (user_id, run_id);

alter table public.swarm_channel_events enable row level security;

drop policy if exists swarm_channel_events_owner_select on public.swarm_channel_events;
create policy swarm_channel_events_owner_select on public.swarm_channel_events
  for select using (auth.uid() = user_id);

drop policy if exists swarm_channel_events_owner_insert on public.swarm_channel_events;
create policy swarm_channel_events_owner_insert on public.swarm_channel_events
  for insert with check (auth.uid() = user_id);

-- No update/delete policies — append-only.

grant select, insert on public.swarm_channel_events to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.swarm_channel_events;
exception when duplicate_object then null;
end $$;
