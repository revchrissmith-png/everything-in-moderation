# Database

The schema migrations in `migrations/` define everything the app queries:

- `governance_policy_corpus` — the `pgvector` extension, the `wiki_pages` corpus table, and the `match_wiki_pages` (semantic) search RPC.
- `governance_fts_or_query` — the `search_wiki_pages` (full-text) RPC.
- `ronr_page_types` — widens the corpus `page_type` check for rule / rule_section / motion rows.
- `ronr_motions` — the structured RONR motion-characteristics table (Table II).
- `ga_moderator`, `ga_nesting_and_team`, `ga_resolution_codes` — agenda items, floor motions (with amendment nesting + resolution codes), and the support-team allow-list.

Apply with `supabase db push`.

## Seed data (not in this repo)

The **corpus content** — Robert's Rules of Order (≈1,800 paragraphs + section indexes), the structured motions, and any governing-document text — is large generated SQL and is **not** committed here. Every corpus row is written under a single owner id; set `CORPUS_USER_ID` in your environment to that value so the search RPCs scope to it.

Seeding the corpus (RONR + your governing documents) via an ingest script is part of the remaining extraction work — see the root `README.md` **Status** section.
