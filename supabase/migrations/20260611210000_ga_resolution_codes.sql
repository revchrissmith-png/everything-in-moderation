-- Resolution codes + amendment lineage for the GA floor tracker.
-- code: structured resolution number, e.g. GL2, GL2.1 (1st-order amendment),
--       GL2.1.1 (2nd-order), GL2a (main motion after an adopted amendment).
-- amends: the motion this one amends (null for main motions/resolutions).
alter table public.ga_floor_motions
  add column if not exists code text,
  add column if not exists amends uuid references public.ga_floor_motions(id) on delete set null;

create index if not exists idx_ga_motions_amends on public.ga_floor_motions (amends);
