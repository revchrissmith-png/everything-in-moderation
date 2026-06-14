-- Switch search_wiki_pages from plainto_tsquery (AND) to websearch_to_tsquery.
--
-- plainto_tsquery requires every term to match. This caused retrieval misses
-- when the query uses a morphological variant absent from the document
-- (e.g. "acquired" stems to 'acquir' but "acquisition" stems to 'acquisit').
-- The client now joins terms with ' OR ' so websearch_to_tsquery produces an
-- OR query, improving recall. ts_rank still ranks by term density, so the
-- most relevant pages win. Semantic search (match_wiki_pages) remains the
-- precision layer.

CREATE OR REPLACE FUNCTION public.search_wiki_pages(
  p_user_id uuid,
  search_query text,
  result_limit integer DEFAULT 10,
  filter_page_type text DEFAULT NULL::text,
  p_library text DEFAULT NULL::text
)
RETURNS TABLE(id uuid, slug text, title text, content text, page_type text, metadata jsonb, rank real)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  return query
    select wp.id, wp.slug, wp.title, wp.content, wp.page_type, wp.metadata,
      ts_rank(wp.search_vector, websearch_to_tsquery('english', search_query)) as rank
    from public.wiki_pages wp
    where wp.user_id = p_user_id
      and wp.search_vector @@ websearch_to_tsquery('english', search_query)
      and (filter_page_type is null or wp.page_type = filter_page_type)
      and (p_library is null or wp.library = p_library)
    order by rank desc
    limit result_limit;
end;
$$;
