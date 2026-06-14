-- GA Moderator assistant (#177) — agenda + floor-motion working state.
-- Personal tool for Chris on the floor of General Assembly. Service-role only
-- (RLS on, no policies); the Moderator tab is gated to his email in the app.

create table if not exists public.ga_agenda_items (
  id          uuid primary key default gen_random_uuid(),
  position    integer not null default 0,
  title       text not null,
  description text,
  item_type   text not null default 'business'
                check (item_type in ('business','report','special_order','election','recess','ceremonial','other')),
  status      text not null default 'pending'
                check (status in ('pending','active','tabled','disposed')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_ga_agenda_position on public.ga_agenda_items (position);
create index if not exists idx_ga_agenda_status on public.ga_agenda_items (status);

create table if not exists public.ga_floor_motions (
  id              uuid primary key default gen_random_uuid(),
  agenda_item_id  uuid references public.ga_agenda_items(id) on delete set null,
  text            text not null,
  motion_class    text,            -- main | subsidiary | privileged | incidental | bring_back | unknown
  ronr_citation   text,            -- linked ronr_motions.citation when classified
  requires_second boolean,
  vote_required   text,            -- majority | two-thirds | ...
  seconded        boolean not null default false,
  status          text not null default 'pending'
                    check (status in ('pending','seconded','adopted','rejected','withdrawn','ruled_out_of_order','tabled')),
  flags           jsonb not null default '[]'::jsonb,   -- ['needs_ruling','possibly_out_of_order', ...]
  votes_for       integer,
  votes_against   integer,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_ga_motions_agenda on public.ga_floor_motions (agenda_item_id);
create index if not exists idx_ga_motions_status on public.ga_floor_motions (status);

-- updated_at maintenance (reuse a generic trigger fn)
create or replace function public.ga_set_updated_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists ga_agenda_updated_at on public.ga_agenda_items;
create trigger ga_agenda_updated_at before update on public.ga_agenda_items
  for each row execute function public.ga_set_updated_at();

drop trigger if exists ga_motions_updated_at on public.ga_floor_motions;
create trigger ga_motions_updated_at before update on public.ga_floor_motions
  for each row execute function public.ga_set_updated_at();

alter table public.ga_agenda_items enable row level security;
alter table public.ga_floor_motions enable row level security;
