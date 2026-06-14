// Corpus owner id for the governing-document store (wiki_pages). Every corpus
// row — Robert's Rules plus your governing documents — is written under this id,
// and the search RPCs filter by it. Set CORPUS_USER_ID in the environment to the
// same value your seed/ingest used.
//
// NOTE (extraction baseline): the authority hierarchy and jurisdiction scoping
// are currently hardcoded to the national-assembly preset in lib/moderator.ts.
// Making them per-organization configuration is the multi-tenant work tracked in
// the project spec — see the README "Status" section.
export const POLICY_USER_ID = process.env.CORPUS_USER_ID ?? ''
