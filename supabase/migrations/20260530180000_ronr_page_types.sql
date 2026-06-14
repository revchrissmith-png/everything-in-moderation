-- Governance corpus — admit Robert's Rules of Order (RONR 12th ed.) as a
-- second library in wiki_pages (library = 'ronr'), alongside the existing
-- policy corpus. RONR is the parliamentary authority behind the GA Moderator
-- assistant; co-locating it here lets the governance query layer search
-- Robert's Rules + governing-document policy in one call.
--
-- The companion data migration seeds 63 rule_section parent rows + 1,738 rule
-- paragraph rows. This migration only widens the page_type CHECK so those
-- two new types are accepted. Everything else (search_vector trigger,
-- match_wiki_pages / search_wiki_pages RPCs, library indexes) already supports
-- the new rows unchanged.

alter table public.wiki_pages
  drop constraint if exists wiki_pages_page_type_check;

alter table public.wiki_pages
  add constraint wiki_pages_page_type_check check (page_type = any (array[
    'jurisdiction_index', 'policy_area', 'policy_document',  -- policy library
    'rule_section', 'rule'                                   -- ronr library
  ]));
