// GA Moderator assistant (#177) — Chris's personal parliamentary tool for the
// floor of General Assembly. Query layer + agenda/floor-motion state.
//
// Grounds answers ONLY in the RONR corpus (library='ronr': rule paragraphs,
// section indexes, and motion-characteristics prose) plus C&MA governing-document policy
// (library='policy') — all already in this project's wiki_pages, queried by the
// existing match_wiki_pages / search_wiki_pages RPCs with p_library=null
// (= every library for the corpus user).

import { supabaseAdmin } from './supabase'
import { POLICY_USER_ID } from './config'
import { sanitizeRich, htmlToPlain } from './richtext'
import { bumpAdoptedCode } from './rescode'

// District-billed; matches lib/governance.ts (Sonnet under-reasoned at Haiku tier).
const PARLIAMENTARIAN_MODEL = 'claude-sonnet-4-6'

// The chair's email — the single account with full roster + console control.
// Support-team members (ga_moderator_team) get console access but not roster control.
export const MODERATOR_EMAIL = (process.env.MODERATOR_EMAIL ?? '').toLowerCase()

export interface RetrievedPage {
  slug: string
  title: string
  content: string
  page_type: string
}

export interface MotionRow {
  citation: string
  section: number
  name: string
  motion_class: string
  interrupt: boolean | null
  needs_second: boolean | null
  debatable: boolean | null
  amendable: boolean | null
  vote: string | null
  vote_has_exceptions: boolean
  reconsider: string | null
  src_interrupt: string | null
  src_second: string | null
  src_debatable: string | null
  src_amendable: string | null
  src_vote: string | null
  src_reconsider: string | null
}

const STOP = new Set(['the','and','for','are','can','how','what','who','does','did','has','have','with','this','that','from','about','into','our','you','your','their','a','an','is','it','to','of','in','on','do','we','be','or','as','at','if','so','order','motion','rule'])

function ftsTerms(q: string): string {
  const t = q.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  return t.join(' OR ') || q
}

async function queryEmbedding(query: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: query, dimensions: 1536 }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { data: { embedding: number[] }[] }
    return data.data[0]?.embedding ?? null
  } catch { return null }
}

// Jurisdiction scope for the GA Moderator. The General Assembly is the NATIONAL
// C&MA body — it is not registered in SK or MB, so provincial statutes (SK
// Non-profit Corporations Act, SK Employment Act, MB Corporations Act) and other
// district policy have NO bearing on the assembly and must never ground a
// ruling. The dashboard's policy library carries all of those for district
// work; here we keep only RONR (slug 'ronr/…') + national governance
// ('policy/cma-national/…'). If the federal Canada Not-for-Profit Corporations
// Act is ever ingested, file it under cma-national (or add its prefix here).
function inModeratorScope(slug: string): boolean {
  return slug.startsWith('ronr/')                 // Robert's Rules
    || slug.startsWith('policy/cma-national')      // C&MA national governance
    || slug.startsWith('federal/')                 // federal statute (Canada NFP Corporations Act)
}

/** FTS + semantic search over RONR + national governance only (provincial/
 *  district law is filtered out). Over-fetch, then scope, then trim. */
export async function searchCorpus(query: string): Promise<RetrievedPage[]> {
  const [fts, embedding] = await Promise.all([
    supabaseAdmin.rpc('search_wiki_pages', {
      p_user_id: POLICY_USER_ID, search_query: ftsTerms(query), result_limit: 24, p_library: null,
    }),
    queryEmbedding(query),
  ])
  let semantic: RetrievedPage[] = []
  if (embedding) {
    const { data } = await supabaseAdmin.rpc('match_wiki_pages', {
      p_user_id: POLICY_USER_ID, query_embedding: embedding, match_threshold: 0.3, match_count: 24, p_library: null,
    })
    semantic = (data ?? []) as RetrievedPage[]
  }
  const seen = new Set<string>()
  const merged: RetrievedPage[] = []
  for (const p of [...((fts.data ?? []) as RetrievedPage[]), ...semantic]) {
    if (!seen.has(p.slug) && inModeratorScope(p.slug)) { seen.add(p.slug); merged.push(p) }
  }
  return merged.slice(0, 10)
}

const PARLIAMENTARIAN_IDENTITY = `You are the Parliamentarian, a private floor advisor to the Moderator (chair) of a General Assembly. The Moderator is presiding live and needs fast, decisive, correctly-cited rulings support.

Authority and lens — this is the NATIONAL General Assembly of The Christian and Missionary Alliance in Canada. Apply this order of authority, highest first:
1. The federal Canada Not-for-Profit Corporations Act (S.C. 2009, c. 23) — the statute under which the national body is incorporated. It is the highest legal authority over the assembly; where it sets a mandatory requirement (e.g. member voting rights, notice for fundamental changes, quorum minimums), nothing in the bylaws or RONR can override it. Cite it by section (e.g. "CNCA s. 197").
2. The C&MA's own national governing documents — constitution, bylaws, special rules of order, Policy on General Assembly. These supersede RONR but yield to the Act.
3. Robert's Rules of Order Newly Revised (12th ed.) — the parliamentary authority for anything the Act and the C&MA documents don't settle. Cite by section:paragraph (e.g. 25:14) or section (§25).
- JURISDICTION: The national corporation is NOT registered in Saskatchewan or Manitoba. Provincial statutes and district policy have NO application to this assembly — never cite or rely on them, even if they seem topically related.

Hard rules:
- Answer ONLY from the excerpts provided below. They are your entire knowledge for this question.
- Lead with the bottom line in one sentence — the Moderator may be reading this while standing. Then give the short "why" with citations.
- Cite every substantive claim: "(RONR 16:5)" or by document/section for policy. Never invent a citation, a vote threshold, or a rule.
- If the excerpts don't settle it, say so plainly and name what the Moderator should ask or look up next. A short honest answer is complete.
- You advise; you do not rule. Phrase as "The chair may rule…", "This requires…", not as a personal opinion on the underlying question. As Moderator, Chris stays neutral on the merits.
- Be concise. Two or three well-cited sentences beat a paragraph.`

// Long policy docs (e.g. the General Operating Bylaw, ~39k chars) bury relevant
// articles deep in the text, and a SINGLE window misses provisions that live in
// a different section than the query's densest term cluster — e.g. a "Board
// composition" question whose answer (one director per district, §6.3.4) sits in
// the elections article, far from the definitions block where "Board/Director/
// Member" cluster most densely. Select the top few non-overlapping hit clusters
// instead of just one. (Mirror of lib/governance.ts windowAroundHits.)
const WINDOW_SIZE = 4000
const MAX_WINDOWS = 3

function termList(query: string): string[] {
  return query.toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
}

function windowAroundHits(content: string, terms: string[]): string {
  if (content.length <= WINDOW_SIZE * MAX_WINDOWS) return content
  const lc = content.toLowerCase()
  let offsets: number[] = []
  for (const t of terms) {
    for (let i = lc.indexOf(t); i !== -1; i = lc.indexOf(t, i + t.length)) offsets.push(i)
  }
  if (offsets.length === 0) return content.slice(0, WINDOW_SIZE) + ' …[excerpt truncated]'
  offsets.sort((a, b) => a - b)

  // Greedily pick up to MAX_WINDOWS densest, non-overlapping windows.
  const picked: { start: number; end: number }[] = []
  for (let w = 0; w < MAX_WINDOWS && offsets.length > 0; w++) {
    let clusterStart = offsets[0], clusterEnd = offsets[0], best = 0
    for (let i = 0; i < offsets.length; i++) {
      let j = i
      while (j < offsets.length && offsets[j] < offsets[i] + WINDOW_SIZE) j++
      if (j - i > best) { best = j - i; clusterStart = offsets[i]; clusterEnd = offsets[j - 1] }
    }
    const pad = Math.max(0, Math.floor((WINDOW_SIZE - (clusterEnd - clusterStart)) / 2))
    let start = Math.max(0, clusterStart - pad)
    const end = Math.min(content.length, start + WINDOW_SIZE)
    start = Math.max(0, end - WINDOW_SIZE)
    picked.push({ start, end })
    offsets = offsets.filter(o => o < start || o >= end)
  }

  // Order by position and merge any overlapping/adjacent windows.
  picked.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  for (const win of picked) {
    const last = merged[merged.length - 1]
    if (last && win.start <= last.end) last.end = Math.max(last.end, win.end)
    else merged.push({ ...win })
  }

  // Snap each window to whitespace and assemble, marking every elided gap.
  return merged.map((win, k) => {
    let { start, end } = win
    if (start > 0) { const ws = content.indexOf(' ', start); if (ws !== -1 && ws < start + 200) start = ws + 1 }
    if (end < content.length) { const ws = content.lastIndexOf(' ', end); if (ws !== -1 && ws > end - 200) end = ws }
    const prefix = (k === 0 ? start > 0 : true) ? '…[earlier text omitted] ' : ''
    const suffix = (k === merged.length - 1 ? end < content.length : true) ? ' …[later text omitted]' : ''
    return prefix + content.slice(start, end) + suffix
  }).join('\n\n')
}

function buildContext(pages: RetrievedPage[], query: string): string {
  if (pages.length === 0) return 'NO EXCERPTS RETRIEVED. Tell the Moderator you have no rule or policy on point and suggest where to look.'
  const terms = termList(query)
  return pages.map(p => {
    const body = windowAroundHits(p.content, terms)
    const tag = p.slug.startsWith('federal/') ? 'FEDERAL ACT'
      : ['rule', 'rule_section', 'motion'].includes(p.page_type) ? 'RONR' : 'C&MA GOVERNANCE'
    return `--- [${tag}] ${p.title} (${p.slug}) ---\n${body}`
  }).join('\n\n')
}

export interface ParliamentaryAnswer {
  answer: string
  sources: { slug: string; title: string; kind: string }[]
}

export async function answerParliamentaryQuery(query: string): Promise<ParliamentaryAnswer> {
  const pages = await searchCorpus(query)
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')
  const user = `EXCERPTS:\n\n${buildContext(pages, query)}\n\n---\n\nMODERATOR'S QUESTION: ${query}`
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: PARLIAMENTARIAN_MODEL, max_tokens: 700, temperature: 0.1,
      system: PARLIAMENTARIAN_IDENTITY, messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const json = (await res.json()) as { content?: { type: string; text?: string }[] }
  const answer = json.content?.find(b => b.type === 'text')?.text?.trim() ?? ''
  return {
    answer,
    sources: pages.map(p => ({
      slug: p.slug, title: p.title,
      kind: p.slug.startsWith('federal/') ? 'Federal Act'
        : ['rule', 'rule_section', 'motion'].includes(p.page_type) ? 'RONR' : 'Policy',
    })),
  }
}

// ── Motion characteristics (structured Table II) ────────────────────────────

export async function listMotions(): Promise<MotionRow[]> {
  const { data } = await supabaseAdmin.from('ronr_motions').select('*').order('section')
  return (data ?? []) as MotionRow[]
}

// ── Agenda + floor-motion state ─────────────────────────────────────────────

export interface AgendaItem {
  id: string; position: number; title: string; description: string | null
  item_type: string; status: string; notes: string | null
}
export interface FloorMotion {
  id: string; agenda_item_id: string | null; text: string; motion_class: string | null
  ronr_citation: string | null; requires_second: boolean | null; vote_required: string | null
  seconded: boolean; status: string; flags: string[]; votes_for: number | null; votes_against: number | null
  notes: string | null; sort_order: number; created_at: string
  code: string | null; amends: string | null
}

export async function listAgenda(): Promise<AgendaItem[]> {
  const { data } = await supabaseAdmin.from('ga_agenda_items').select('*').order('position')
  return (data ?? []) as AgendaItem[]
}
export async function listFloorMotions(): Promise<FloorMotion[]> {
  const { data } = await supabaseAdmin.from('ga_floor_motions').select('*')
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  return (data ?? []) as FloorMotion[]
}

export async function addAgendaItem(input: Partial<AgendaItem>): Promise<AgendaItem> {
  const { data: maxRow } = await supabaseAdmin.from('ga_agenda_items')
    .select('position').order('position', { ascending: false }).limit(1).maybeSingle()
  const position = input.position ?? ((maxRow?.position ?? -1) + 1)
  const { data, error } = await supabaseAdmin.from('ga_agenda_items').insert({
    title: input.title, description: input.description ?? null,
    item_type: input.item_type ?? 'business', position,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data as AgendaItem
}

export async function updateAgendaItem(id: string, patch: Partial<AgendaItem>): Promise<AgendaItem> {
  const allowed = (({ title, description, item_type, status, notes, position }) =>
    ({ title, description, item_type, status, notes, position }))(patch)
  const clean = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
  const { data, error } = await supabaseAdmin.from('ga_agenda_items').update(clean).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as AgendaItem
}

export async function deleteAgendaItem(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('ga_agenda_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Advancing the agenda: dispose the current active item, activate the next pending one. */
export async function advanceAgenda(): Promise<void> {
  const items = await listAgenda()
  const active = items.find(i => i.status === 'active')
  if (active) await updateAgendaItem(active.id, { status: 'disposed' })
  const next = items.find(i => i.status === 'pending' && i.id !== active?.id)
  if (next) await updateAgendaItem(next.id, { status: 'active' })
}

/** Stepping back — the inverse of advanceAgenda, for recovering from a mis-click
 *  on the floor. The current active item returns to pending; the most recently
 *  disposed item before it (or, if nothing is active, the last disposed item
 *  overall) is re-activated. No-op when there is nothing disposed to return to. */
export async function regressAgenda(): Promise<void> {
  const items = await listAgenda() // ordered by position asc
  const active = items.find(i => i.status === 'active')
  const disposed = items.filter(i => i.status === 'disposed')
  if (disposed.length === 0) return
  const cutoff = active ? active.position : Infinity
  const prev = [...disposed].sort((a, b) => b.position - a.position)
    .find(i => i.position < cutoff) ?? disposed[disposed.length - 1]
  if (active) await updateAgendaItem(active.id, { status: 'pending' })
  if (prev) await updateAgendaItem(prev.id, { status: 'active' })
}

/** Reset the whole agenda to its pristine pre-session state — every item back to
 *  pending, nothing active or disposed. Used to clear a test run before going live. */
export async function resetAgenda(): Promise<void> {
  const { error } = await supabaseAdmin.from('ga_agenda_items')
    .update({ status: 'pending' }).neq('status', 'pending')
  if (error) throw new Error(error.message)
}

// Marker flag for a threshold Synod inferred but the Moderator hasn't confirmed.
// The client matches on this prefix to render the confirm/override control.
export const SYNOD_THRESHOLD_FLAG = 'Synod-suggested threshold — confirm'

const THRESHOLD_CLASSIFIER_SYSTEM = `You are the Parliamentarian classifying ONE motion for a General Assembly floor tracker. Determine the vote threshold required to ADOPT it.

Authority order (highest first): (1) Canada Not-for-Profit Corporations Act; (2) C&MA national governing documents — the Policy on General Assembly and the GA26 Business Session Voting Process; (3) Robert's Rules (RONR 12th ed.). This is the NATIONAL assembly: never apply provincial or district rules.

Rules of thumb:
- Bylaw / constitutional amendments and other entrenched changes → two-thirds (2/3).
- Amend something previously adopted, suspend the rules, close or limit debate (previous question), rescind without notice, object to consideration → two-thirds (2/3) per RONR.
- Ordinary main motions and most procedural motions → majority.
- Per the GA26 Voting Process, resolution thresholds are resolution-specific (many 2/3, some majority): judge by the motion's subject and effect, grounded in the excerpts.

Output STRICT JSON ONLY, no prose, no code fence:
{"vote_required":"2/3"|"majority"|"other","basis":"<=120 chars citing the rule/section","confidence":"high"|"medium"|"low"}
If the excerpts don't settle it, return "other" with low confidence and name what's missing in basis.`

export interface ThresholdSuggestion { vote_required: string; basis: string; confidence: string }

/** Synod infers the adoption threshold for a free-text motion. Returns null on
 *  any failure — must NEVER block motion entry on the live floor. */
export async function suggestMotionThreshold(text: string): Promise<ThresholdSuggestion | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !text.trim()) return null
  try {
    const pages = await searchCorpus(`${text}\nvote threshold required to adopt this motion: two-thirds or majority?`)
    const user = `EXCERPTS:\n\n${buildContext(pages, text)}\n\n---\n\nMOTION:\n${text}\n\nReturn the adoption threshold as JSON.`
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: PARLIAMENTARIAN_MODEL, max_tokens: 200, temperature: 0,
        system: THRESHOLD_CLASSIFIER_SYSTEM, messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { content?: { type: string; text?: string }[] }
    const raw = json.content?.find(b => b.type === 'text')?.text?.trim() ?? ''
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as Partial<ThresholdSuggestion>
    if (!parsed.vote_required) return null
    return { vote_required: parsed.vote_required, basis: parsed.basis ?? '', confidence: parsed.confidence ?? 'low' }
  } catch { return null }
}

export async function addFloorMotion(input: Partial<FloorMotion>): Promise<FloorMotion> {
  let vote_required = input.vote_required ?? null
  let flags = input.flags ?? []
  let notes: string | null = null

  // Resolutions may carry amendment markup (struck deletions / underlined
  // insertions). Store a sanitized HTML subset; classify against plain text.
  const text = sanitizeRich(input.text)
  const plainText = htmlToPlain(text)

  // If the motion arrives without an authoritative threshold (e.g. a free-text
  // resolution that didn't match the RONR catalog), Synod infers one and tags it
  // unconfirmed for the Moderator to accept or override. Failure is silent —
  // never let classification block entering a motion mid-session.
  if (!vote_required) {
    const s = await suggestMotionThreshold(plainText)
    if (s && s.vote_required !== 'other') {
      vote_required = s.vote_required
      flags = [...flags, SYNOD_THRESHOLD_FLAG]
      notes = `Synod: ${s.vote_required} (${s.confidence}) — ${s.basis}`
    } else if (s) {
      flags = [...flags, 'Synod could not determine threshold — set manually']
      notes = `Synod: ${s.basis}`
    }
  }

  // Append after the last motion in the same group (report or ad-hoc/null).
  const agendaId = input.agenda_item_id ?? null
  let maxQuery = supabaseAdmin.from('ga_floor_motions').select('sort_order')
  maxQuery = agendaId === null ? maxQuery.is('agenda_item_id', null) : maxQuery.eq('agenda_item_id', agendaId)
  const { data: maxRow } = await maxQuery.order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const sort_order = input.sort_order ?? ((maxRow?.sort_order ?? 0) + 1)

  const { data, error } = await supabaseAdmin.from('ga_floor_motions').insert({
    text, agenda_item_id: agendaId,
    motion_class: input.motion_class ?? null, ronr_citation: input.ronr_citation ?? null,
    requires_second: input.requires_second ?? null, vote_required,
    flags, notes, sort_order, status: input.status ?? 'pending',
    code: input.code?.trim() || null, amends: input.amends ?? null,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data as FloorMotion
}

/** Re-run Synod's threshold classifier on an EXISTING motion — for when the
 *  wording changed enough to alter what the motion does (editing text alone does
 *  not re-classify). Strips any prior Synod-suggested flag/note, then re-tags
 *  from the current text. Returns the row unchanged if classification fails —
 *  must never throw on the floor. */
export async function recheckMotionThreshold(id: string): Promise<FloorMotion> {
  const { data: row, error: readErr } = await supabaseAdmin.from('ga_floor_motions')
    .select('text, flags').eq('id', id).single()
  if (readErr) throw new Error(readErr.message)
  const baseFlags = ((row?.flags ?? []) as string[])
    .filter(f => !f.startsWith(SYNOD_THRESHOLD_FLAG) && !f.startsWith('Synod could not determine'))

  const s = await suggestMotionThreshold(htmlToPlain((row?.text ?? '') as string))
  if (!s) return updateFloorMotion(id, { flags: baseFlags }) // classifier unavailable — leave threshold as-is

  if (s.vote_required !== 'other') {
    return updateFloorMotion(id, {
      vote_required: s.vote_required,
      flags: [...baseFlags, SYNOD_THRESHOLD_FLAG],
      notes: `Synod: ${s.vote_required} (${s.confidence}) — ${s.basis}`,
    })
  }
  return updateFloorMotion(id, {
    flags: [...baseFlags, 'Synod could not determine threshold — set manually'],
    notes: `Synod: ${s.basis}`,
  })
}

export async function updateFloorMotion(id: string, patch: Partial<FloorMotion>): Promise<FloorMotion> {
  const allowed = (({ text, status, seconded, votes_for, votes_against, notes, flags, motion_class, ronr_citation, requires_second, vote_required, agenda_item_id, sort_order, code, amends }) =>
    ({ text, status, seconded, votes_for, votes_against, notes, flags, motion_class, ronr_citation, requires_second, vote_required, agenda_item_id, sort_order, code, amends }))(patch)
  const clean = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
  if (typeof clean.text === 'string') clean.text = sanitizeRich(clean.text) // resolution amendment markup
  if (typeof clean.code === 'string') clean.code = clean.code.trim() || null

  // Adopting an amendment creates a new main motion: bump the parent's code
  // (GL2 → GL2a) and flag it for a wording update. Read the prior status first
  // so a re-click can't double-bump.
  let adopting = false
  if (clean.status === 'adopted') {
    const { data: prev } = await supabaseAdmin.from('ga_floor_motions').select('status, amends').eq('id', id).single()
    adopting = !!prev && prev.status !== 'adopted' && !!prev.amends
  }

  const { data, error } = await supabaseAdmin.from('ga_floor_motions').update(clean).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  const motion = data as FloorMotion

  if (adopting && motion.amends) {
    const { data: parent } = await supabaseAdmin.from('ga_floor_motions').select('id, code, flags').eq('id', motion.amends).single()
    const bumped = bumpAdoptedCode(parent?.code)
    if (parent && bumped) {
      await supabaseAdmin.from('ga_floor_motions').update({
        code: bumped,
        flags: [...((parent.flags ?? []) as string[]), `amended by ${motion.code ?? 'adopted amendment'} — apply wording`],
      }).eq('id', parent.id)
    }
  }
  return motion
}

export async function deleteFloorMotion(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('ga_floor_motions').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Persist a new ordering. `ids` is the full ordered list; sort_order = index. */
export async function reorderMotions(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) =>
    supabaseAdmin.from('ga_floor_motions').update({ sort_order: i + 1 }).eq('id', id)))
}

export async function reorderAgenda(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) =>
    supabaseAdmin.from('ga_agenda_items').update({ position: i }).eq('id', id)))
}

// ── Moderator support team (external, scoped to the panel only) ─────────────

export interface ModeratorTeamMember { email: string; name: string | null; added_by: string | null; created_at: string }

export async function getModeratorTeam(): Promise<ModeratorTeamMember[]> {
  const { data } = await supabaseAdmin.from('ga_moderator_team').select('*').order('created_at', { ascending: true })
  return (data ?? []) as ModeratorTeamMember[]
}

/** True if this email is an allow-listed support user (not Chris). */
export async function isModeratorTeam(email: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('ga_moderator_team').select('email').eq('email', email.toLowerCase()).maybeSingle()
  return !!data
}

/** Provision a support user: create the Supabase auth user (so OTP login works
 *  with shouldCreateUser:false) and allow-list them. Idempotent on re-add. */
export async function addModeratorTeamMember(email: string, name: string | null, addedBy: string): Promise<ModeratorTeamMember> {
  const lower = email.trim().toLowerCase()
  // Create the auth user; ignore "already registered" so re-adding is safe.
  const { error: authErr } = await supabaseAdmin.auth.admin.createUser({ email: lower, email_confirm: true })
  if (authErr && !/already.*registered|already been registered|email.*exists/i.test(authErr.message)) {
    throw new Error(`Auth provisioning failed: ${authErr.message}`)
  }
  const { data, error } = await supabaseAdmin.from('ga_moderator_team')
    .upsert({ email: lower, name: name?.trim() || null, added_by: addedBy }, { onConflict: 'email' })
    .select('*').single()
  if (error) throw new Error(error.message)
  return data as ModeratorTeamMember
}

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

/** Send a branded invite via Resend (same sender as the rest of the app). The
 *  account is created with email_confirm, so this just tells the person how to
 *  sign in — they request a one-time code at /login with this email. Non-fatal:
 *  returns {sent:false, detail} rather than throwing so a mail failure never
 *  blocks adding the member. */
export async function sendModeratorInvite(email: string, name: string | null): Promise<{ sent: boolean; detail?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, detail: 'RESEND_API_KEY not configured' }
  const greeting = name?.trim() ? `Hi ${name.trim()},` : 'Hi,'
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
    <h2 style="color:#00426A;margin:16px 0 8px">GA Moderator — support team access</h2>
    <p>${greeting}</p>
    <p>You've been added to the General Assembly Moderator support team. This gives you access to the
       live Moderator panel only — agenda and motions — and nothing else in the district system.</p>
    <p><b>To sign in:</b></p>
    <ol style="padding-left:18px">
      <li>Go to <a href="${APP_URL}/login" style="color:#0077C8;font-weight:600">${APP_URL}/login</a></li>
      <li>Enter <b>this email address</b> (${email}).</li>
      <li>We'll email you a 6-digit code — enter it to sign in.</li>
      <li>You'll land directly in the Moderator panel.</li>
    </ol>
    <p style="margin-top:16px">
      <a href="${APP_URL}/login" style="background:#00426A;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Open the Moderator panel →</a>
    </p>
    <p style="color:#6b7280;font-size:13px;margin-top:20px">Sign in with the exact email this was sent to — that's the address on the access list.</p>
  </div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? 'GA Moderator <onboarding@resend.dev>',
        to: [email],
        subject: 'You have access to the GA Moderator panel',
        html,
      }),
    })
    if (!res.ok) return { sent: false, detail: (await res.text().catch(() => '')).slice(0, 300) }
    return { sent: true }
  } catch (e) {
    return { sent: false, detail: (e as Error).message }
  }
}

/** De-list a support user. Leaves the auth user in place (harmless without an
 *  allow-list entry; the guard denies them) unless hardDelete is set. */
export async function removeModeratorTeamMember(email: string, hardDelete = false): Promise<void> {
  const lower = email.trim().toLowerCase()
  const { error } = await supabaseAdmin.from('ga_moderator_team').delete().eq('email', lower)
  if (error) throw new Error(error.message)
  if (hardDelete) {
    const { data: list } = await supabaseAdmin.auth.admin.listUsers()
    const u = list?.users.find(x => x.email?.toLowerCase() === lower)
    if (u) await supabaseAdmin.auth.admin.deleteUser(u.id)
  }
}
