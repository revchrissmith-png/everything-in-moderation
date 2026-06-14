-- GA Moderator console: motion ordering (nesting under reports) + scoped support team.

-- 1. Stable ordering for floor motions. Resolutions nested under a report are
--    worked one-by-one, and the agenda/motion lists are drag-reorderable.
alter table public.ga_floor_motions
  add column if not exists sort_order integer not null default 0;

-- Backfill order from creation time, numbered within each agenda grouping.
with ordered as (
  select id,
         row_number() over (partition by agenda_item_id order by created_at) as rn
  from public.ga_floor_motions
)
update public.ga_floor_motions m
set sort_order = ordered.rn
from ordered
where ordered.id = m.id;

create index if not exists idx_ga_motions_sort
  on public.ga_floor_motions (agenda_item_id, sort_order);

-- 2. Allowlist of external moderation-support users, scoped to the Moderator
--    panel ONLY (support-team members are separate from any host-app roles
--    system). Emails are stored lowercased by the application.
create table if not exists public.ga_moderator_team (
  email      text primary key,
  name       text,
  added_by   text,
  created_at timestamptz not null default now()
);

-- Service-role API only (requireModerator reads it; requireModeratorOwner gates
-- writes). RLS on with no policies = no direct client access.
alter table public.ga_moderator_team enable row level security;
