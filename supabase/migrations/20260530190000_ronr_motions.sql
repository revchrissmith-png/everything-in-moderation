-- RONR motion-characteristics table (the "Table II" / Standard Descriptive
-- Characteristics equivalent) for the GA Moderator assistant (#177).
--
-- One row per ranked parliamentary motion with typed lookup columns
-- (interrupt / second / debatable / amendable / vote / reconsider) PLUS the
-- verbatim SDC source sentence behind each field — so the moderator UI can
-- answer "is this in order / what vote?" instantly AND cite the exact rule
-- text ("cited responses only — no guessing", per #177).
--
-- Companion data migration seeds 27 motions. A synced prose row per motion is
-- also written into wiki_pages (page_type='motion', library='ronr') so the
-- existing FTS/semantic RPCs surface motions too — hence the CHECK widening.

create table if not exists public.ronr_motions (
  id            uuid primary key default gen_random_uuid(),
  citation      text not null unique,          -- SDC box citation, e.g. '16:5'
  section       integer not null,              -- RONR section §
  name          text not null,                 -- canonical motion name
  motion_class  text not null check (motion_class in
                  ('main','subsidiary','privileged','incidental','bring_back')),
  -- normalized lookup fields (null = not applicable / see source)
  interrupt           boolean,                 -- in order when another has the floor?
  needs_second        boolean,
  debatable           boolean,
  amendable           boolean,
  vote                text,                    -- majority | two-thirds | no vote | majority of entire membership | special
  vote_has_exceptions boolean default false,   -- true when the rule has except/unless clauses
  reconsider          text,                    -- yes | no | qualified | see_text
  -- verbatim SDC source sentences — the citation anchors
  src_interrupt   text,
  src_second      text,
  src_debatable   text,
  src_amendable   text,
  src_vote        text,
  src_reconsider  text,
  wiki_slug       text,                        -- linked wiki_pages prose row (ronr/motion/<section>)
  created_at      timestamptz default now()
);

create index if not exists idx_ronr_motions_section on public.ronr_motions (section);
create index if not exists idx_ronr_motions_class on public.ronr_motions (motion_class);
create index if not exists idx_ronr_motions_vote on public.ronr_motions (vote);

-- Service-role only (matches wiki_pages): RLS on, no policies.
alter table public.ronr_motions enable row level security;

-- Allow the synced motion prose rows in wiki_pages.
alter table public.wiki_pages
  drop constraint if exists wiki_pages_page_type_check;
alter table public.wiki_pages
  add constraint wiki_pages_page_type_check check (page_type = any (array[
    'jurisdiction_index', 'policy_area', 'policy_document',  -- policy library
    'rule_section', 'rule', 'motion'                         -- ronr library
  ]));
