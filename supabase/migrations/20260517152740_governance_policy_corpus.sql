-- Governing-document corpus (wiki_pages) for the application.
--
-- The policy documents behind the Governance tab were originally ingested into
-- the application's other data. To keep the application querying only this deployment's
-- own Supabase project, the policy table and its search RPCs are cloned here.
-- The companion data migration seeds the 55 policy pages.
--
-- Table/RPC names mirror the source (wiki_pages, match_wiki_pages,
-- search_wiki_pages) so lib/governance.ts needs no query changes. This copy
-- holds policy pages only.

create extension if not exists vector;

create table if not exists public.wiki_pages (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  content       text not null,
  page_type     text not null,
  parent_slug   text,
  metadata      jsonb default '{}'::jsonb,
  embedding     vector(1536),
  search_vector tsvector,
  version       integer default 1,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  -- Corpus tag carried over from the source rows; the search RPCs filter on it.
  -- Not a real auth user in this project, so no FK to auth.users.
  user_id       uuid,
  library       text not null default 'policy',
  constraint wiki_pages_page_type_check check (page_type = any (array[
    'jurisdiction_index', 'policy_area', 'policy_document'
  ]))
);

create index if not exists idx_wiki_pages_slug on public.wiki_pages (slug);
create index if not exists idx_wiki_pages_page_type on public.wiki_pages (page_type);
create index if not exists idx_wiki_pages_parent_slug on public.wiki_pages (parent_slug);
create index if not exists idx_wiki_pages_search_vector on public.wiki_pages using gin (search_vector);
create index if not exists idx_wiki_pages_library on public.wiki_pages (library);
create index if not exists idx_wiki_pages_library_type on public.wiki_pages (library, page_type);
-- No ANN index on embedding: 55 rows, an exact cosine scan is instant and more
-- accurate than ivfflat at this size.

-- search_vector is maintained by trigger from title + content.
create or replace function public.wiki_pages_search_vector_update()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.search_vector := to_tsvector('english', coalesce(new.title, '') || ' ' || coalesce(new.content, ''));
  return new;
end;
$$;

create or replace function public.wiki_pages_updated_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists wiki_pages_search_vector_trigger on public.wiki_pages;
create trigger wiki_pages_search_vector_trigger
  before insert or update of title, content on public.wiki_pages
  for each row execute function public.wiki_pages_search_vector_update();

drop trigger if exists wiki_pages_updated_at_trigger on public.wiki_pages;
create trigger wiki_pages_updated_at_trigger
  before update on public.wiki_pages
  for each row execute function public.wiki_pages_updated_at();

-- Semantic search RPC — cosine similarity over the policy embeddings.
create or replace function public.match_wiki_pages(
  p_user_id uuid,
  query_embedding vector,
  match_threshold double precision default 0.7,
  match_count integer default 10,
  filter_page_type text default null,
  p_library text default null
)
returns table (
  id uuid, slug text, title text, content text,
  page_type text, metadata jsonb, similarity double precision
)
language plpgsql set search_path to 'public' as $$
begin
  return query
    select wp.id, wp.slug, wp.title, wp.content, wp.page_type, wp.metadata,
      1 - (wp.embedding <=> query_embedding) as similarity
    from public.wiki_pages wp
    where wp.user_id = p_user_id
      and wp.embedding is not null
      and 1 - (wp.embedding <=> query_embedding) > match_threshold
      and (filter_page_type is null or wp.page_type = filter_page_type)
      and (p_library is null or wp.library = p_library)
    order by wp.embedding <=> query_embedding
    limit match_count;
end;
$$;

-- Full-text search RPC — ranked tsvector match.
create or replace function public.search_wiki_pages(
  p_user_id uuid,
  search_query text,
  result_limit integer default 10,
  filter_page_type text default null,
  p_library text default null
)
returns table (
  id uuid, slug text, title text, content text,
  page_type text, metadata jsonb, rank real
)
language plpgsql set search_path to 'public' as $$
begin
  return query
    select wp.id, wp.slug, wp.title, wp.content, wp.page_type, wp.metadata,
      ts_rank(wp.search_vector, plainto_tsquery('english', search_query)) as rank
    from public.wiki_pages wp
    where wp.user_id = p_user_id
      and wp.search_vector @@ plainto_tsquery('english', search_query)
      and (filter_page_type is null or wp.page_type = filter_page_type)
      and (p_library is null or wp.library = p_library)
    order by rank desc
    limit result_limit;
end;
$$;

-- Only the service-role client (lib/supabase.ts supabaseAdmin) reads this
-- table; service-role bypasses RLS. Enable RLS with no policies so anon and
-- authenticated roles get nothing.
alter table public.wiki_pages enable row level security;
