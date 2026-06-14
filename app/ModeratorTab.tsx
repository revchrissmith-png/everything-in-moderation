'use client'

// GA Moderator assistant (#177) — Chris's floor tool, shared with an external
// moderation-support team (scoped to this panel only).
// PREP mode: build/reorder the agenda, nest resolutions under reports, manage team.
// LIVE mode: cited query bar, current item, motion console (report-focused), rules.
// Edit/Observe toggle lets anyone browse read-only with zero risk of changing data.
// Live sync: polls every 2.5s (paused while an inline editor or drag is active).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { sanitizeRich, htmlToPlain } from '@/lib/richtext'
import { nextAmendmentCode, codeDepth } from '@/lib/rescode'

type Mode = 'prep' | 'live'

// Render resolution wording with its amendment markup: deletions struck in red,
// insertions underlined in green. Sanitized again at the boundary (defence in
// depth — stored value is already clean). Shared by the planning pane and the
// live console so the marked-up text reads identically on both surfaces.
function ResolutionText({ html, className = '' }: { html: string; className?: string }) {
  return (
    <span
      className={`[&_s]:text-red-700 [&_s]:bg-red-50 [&_s]:rounded-sm [&_s]:px-0.5 [&_s]:decoration-red-600 [&_u]:text-emerald-800 [&_u]:bg-emerald-50 [&_u]:rounded-sm [&_u]:px-0.5 [&_u]:decoration-emerald-600 [&_u]:decoration-2 ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizeRich(html) }}
    />
  )
}

interface AgendaItem {
  id: string; position: number; title: string; description: string | null
  item_type: string; status: string; notes: string | null
}
interface FloorMotion {
  id: string; agenda_item_id: string | null; text: string; motion_class: string | null
  ronr_citation: string | null; requires_second: boolean | null; vote_required: string | null
  seconded: boolean; status: string; flags: string[]; votes_for: number | null; votes_against: number | null
  notes: string | null; sort_order: number; created_at: string
  code: string | null; amends: string | null
}
interface Motion {
  citation: string; section: number; name: string; motion_class: string
  interrupt: boolean | null; needs_second: boolean | null; debatable: boolean | null
  amendable: boolean | null; vote: string | null; vote_has_exceptions: boolean; reconsider: string | null
  src_debatable: string | null; src_vote: string | null; src_amendable: string | null
  src_second: string | null; src_interrupt: string | null; src_reconsider: string | null
}
interface TeamMember { email: string; name: string | null; added_by: string | null; created_at: string }
interface Answer { answer: string; sources: { slug: string; title: string; kind: string }[] }

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json()
}
async function jsend<T>(url: string, method: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json()
}

const prettyVote = (v: string | null) =>
  !v ? '—' : v === 'two-thirds_or_majority_with_notice' ? '⅔ (or majority w/ notice)'
    : v === 'majority of entire membership' ? 'majority of entire membership'
    : v.replace('two-thirds', '⅔')
const YN = (b: boolean | null) => (b === true ? 'Yes' : b === false ? 'No' : '—')
const SYNOD_FLAG_PREFIX = 'Synod-suggested threshold'

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600', active: 'bg-[#E6F1FB] text-[#00426A] ring-1 ring-[#0077C8]/40',
  tabled: 'bg-[#fbf1d9] text-[#8a6100]', disposed: 'bg-slate-100 text-slate-400 line-through',
  seconded: 'bg-[#E6F1FB] text-[#0077C8]', adopted: 'bg-[#e6f4ec] text-[#1d7a4d]',
  rejected: 'bg-[#fbeaea] text-[#b3261e]', withdrawn: 'bg-slate-100 text-slate-500',
  ruled_out_of_order: 'bg-[#fbeaea] text-[#b3261e]', }

// ── Shared edit-mode + polling context ──────────────────────────────────────
interface ModCtx { mode: Mode; editing: boolean; holdPoll: () => void; releasePoll: () => void }
const ModeratorCtx = createContext<ModCtx>({ mode: 'live', editing: false, holdPoll: () => {}, releasePoll: () => {} })
const useMod = () => useContext(ModeratorCtx)

// Touch + pointer sensors so drag works on the iPad/iPhone used on the floor.
function useDragSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
}

/** A sortable row with a drag handle on the left. Handle hidden when locked. */
function SortableRow({ id, locked, children }: { id: string; locked: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: locked })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1">
      {!locked && (
        <button {...attributes} {...listeners} aria-label="Drag to reorder"
          className="cursor-grab touch-none select-none text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded px-1 mt-1.5 leading-none text-base">⋮⋮</button>
      )}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

export default function ModeratorTab() {
  const [mode, setMode] = useState<Mode>('live')
  const [editing, setEditing] = useState(false)
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [floor, setFloor] = useState<FloorMotion[]>([])
  const [catalog, setCatalog] = useState<Motion[]>([])
  const [team, setTeam] = useState<TeamMember[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [loading, setLoading] = useState(true)
  const pollHold = useRef(0)

  // Default to Observe; restore last per-device choice.
  useEffect(() => { try { setEditing(localStorage.getItem('ga-mod-editing') === '1') } catch {} }, [])
  const toggleEditing = () => setEditing(e => {
    const n = !e; try { localStorage.setItem('ga-mod-editing', n ? '1' : '0') } catch {} ; return n
  })

  const refresh = useCallback(async () => {
    const [a, f, m] = await Promise.all([
      jget<{ items: AgendaItem[] }>('/api/moderator/agenda'),
      jget<{ motions: FloorMotion[] }>('/api/moderator/floor-motions'),
      jget<{ motions: Motion[] }>('/api/moderator/motions'),
    ])
    setAgenda(a.items); setFloor(f.motions); setCatalog(m.motions); setLoading(false)
  }, [])

  const refreshTeam = useCallback(async () => {
    // 200 ⇒ chair (owner); 403 ⇒ support member (no roster access).
    try { const r = await jget<{ members: TeamMember[] }>('/api/moderator/team'); setIsOwner(true); setTeam(r.members) }
    catch { setIsOwner(false); setTeam([]) }
  }, [])

  useEffect(() => { refresh().catch(() => setLoading(false)); refreshTeam() }, [refresh, refreshTeam])

  // Live sync — paused whenever an editor or drag holds the lock.
  useEffect(() => {
    const id = setInterval(() => { if (pollHold.current === 0) refresh().catch(() => {}) }, 2500)
    return () => clearInterval(id)
  }, [refresh])
  const holdPoll = useCallback(() => { pollHold.current += 1 }, [])
  const releasePoll = useCallback(() => { pollHold.current = Math.max(0, pollHold.current - 1) }, [])

  const current = agenda.find(i => i.status === 'active') ?? null
  if (loading) return <div className="p-8 text-center text-gray-400">Loading the floor…</div>

  return (
    <ModeratorCtx.Provider value={{ mode, editing, holdPoll, releasePoll }}>
      <div className="max-w-3xl mx-auto px-3 pb-24">
        {/* Mode + Edit/Observe toggle */}
        <div className="sticky top-0 z-20 -mx-3 px-3 py-2 bg-white/95 backdrop-blur border-b border-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
              {(['live', 'prep'] as Mode[]).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-4 py-1.5 text-sm font-semibold rounded-md transition ${mode === m ? 'bg-[#00426A] text-white shadow' : 'text-gray-600'}`}>
                  {m === 'live' ? '🔴 Live' : '📋 Prep'}
                </button>
              ))}
            </div>
            <button onClick={toggleEditing}
              aria-pressed={editing}
              className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition ring-1 ${
                editing ? 'bg-emerald-600 text-white ring-emerald-700' : 'bg-gray-200 text-gray-700 ring-gray-300'}`}>
              {editing ? '✏️ Editing' : '👁 Observing'}
            </button>
          </div>
          {!editing && (
            <p className="mt-1 text-[11px] text-slate-600">
              Read-only — browse freely. Tap <b>👁 Observing</b> to switch to <b>✏️ Editing</b> when you need to make changes.
            </p>
          )}
        </div>

        {mode === 'live'
          ? <LiveMode agenda={agenda} current={current} floor={floor} catalog={catalog} refresh={refresh} />
          : <PrepMode agenda={agenda} floor={floor} catalog={catalog} team={team} isOwner={isOwner}
              setAgenda={setAgenda} setFloor={setFloor} refresh={refresh} refreshTeam={refreshTeam} />}
      </div>
    </ModeratorCtx.Provider>
  )
}

/* ──────────────────────────── LIVE MODE ──────────────────────────── */

function LiveMode({ agenda, current, floor, catalog, refresh }: {
  agenda: AgendaItem[]; current: AgendaItem | null; floor: FloorMotion[]; catalog: Motion[]
  refresh: () => Promise<void>
}) {
  return (
    <div className="space-y-4 pt-3">
      <QueryBar />
      <CurrentItem current={current} agenda={agenda} refresh={refresh} />
      <MotionConsole floor={floor} catalog={catalog} current={current} refresh={refresh} />
      <RulesLookup catalog={catalog} />
    </div>
  )
}

// Read-only — available to observers too; asking Synod changes nothing.
function QueryBar() {
  const [q, setQ] = useState('')
  const [ans, setAns] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ask = async () => {
    const query = q.trim(); if (!query || busy) return
    setBusy(true); setErr(''); setAns(null)
    try { setAns(await jsend<Answer>('/api/moderator/query', 'POST', { query })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-stretch">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()}
          placeholder="Is this in order? What vote does it need?"
          className="flex-1 px-4 py-3 text-base text-slate-900 placeholder-slate-500 outline-none" />
        <button onClick={ask} disabled={busy}
          className="px-5 bg-[#00426A] text-white font-semibold text-sm disabled:opacity-50">
          {busy ? '…' : 'Ask'}
        </button>
      </div>
      {err && <div className="px-4 py-2 text-sm text-red-600 bg-red-50">{err}</div>}
      {ans && (
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
          <p className="text-[15px] text-slate-900 leading-relaxed whitespace-pre-wrap">{ans.answer}</p>
          {ans.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ans.sources.map(s => (
                <span key={s.slug} className="text-[11px] px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                  {s.kind}: {s.title}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CurrentItem({ current, agenda, refresh }: { current: AgendaItem | null; agenda: AgendaItem[]; refresh: () => Promise<void> }) {
  const { mode } = useMod()
  const [busy, setBusy] = useState(false)
  const advance = async () => { setBusy(true); try { await jsend('/api/moderator/agenda', 'POST', { action: 'advance' }); await refresh() } finally { setBusy(false) } }
  const back = async () => { setBusy(true); try { await jsend('/api/moderator/agenda', 'POST', { action: 'back' }); await refresh() } finally { setBusy(false) } }
  const upNext = agenda.find(i => i.status === 'pending')
  const canGoBack = agenda.some(i => i.status === 'disposed')
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Now before the assembly</span>
        {mode === 'live' && (
          <div className="flex items-center gap-2">
            <button onClick={back} disabled={busy || !canGoBack}
              className="px-3 py-1.5 rounded-lg border border-[#00426A] text-[#00426A] text-sm font-semibold disabled:opacity-40">
              {busy ? '…' : '◂ Back'}
            </button>
            <button onClick={advance} disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-[#00426A] text-white text-sm font-semibold disabled:opacity-50">
              {busy ? '…' : 'Advance ▸'}
            </button>
          </div>
        )}
      </div>
      {current ? (
        <>
          <h3 className="mt-1 text-xl font-bold text-gray-900 leading-tight">{current.title}</h3>
          {current.item_type === 'report' && <span className="text-[11px] text-amber-700 font-semibold">report — working its resolutions</span>}
          {current.description && <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{current.description}</p>}
        </>
      ) : (
        <p className="mt-1 text-slate-700">No active item. {upNext ? `Advance to start: “${upNext.title}”.` : 'Add agenda items in Prep.'}</p>
      )}
      {agenda.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agenda.map(i => (
            <span key={i.id} className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[i.status] ?? 'bg-gray-100'}`}>
              {i.title.length > 28 ? i.title.slice(0, 28) + '…' : i.title}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function MotionConsole({ floor, catalog, current, refresh }: {
  floor: FloorMotion[]; catalog: Motion[]; current: AgendaItem | null
  refresh: () => Promise<void>
}) {
  const { editing } = useMod()
  const [text, setText] = useState('')
  const [code, setCode] = useState('')
  const [pickedCitation, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const picked = catalog.find(m => m.citation === pickedCitation)
  const inReport = !!current && current.item_type === 'report'

  // Suggested code for an ad-hoc floor motion: next free FL number.
  const nextFL = `FL${floor.reduce((max, m) => {
    const n = m.code?.match(/^FL(\d+)$/i); return n ? Math.max(max, parseInt(n[1], 10)) : max
  }, 0) + 1}`

  const add = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const flags: string[] = []
      if (picked && picked.needs_second === false) flags.push('no second required')
      if (picked && picked.vote_has_exceptions) flags.push('vote threshold has exceptions — verify')
      await jsend('/api/moderator/floor-motions', 'POST', {
        text: text.trim(), agenda_item_id: current?.id ?? null, code: code.trim() || null,
        motion_class: picked?.motion_class ?? null, ronr_citation: picked?.citation ?? null,
        requires_second: picked?.needs_second ?? null, vote_required: picked?.vote ?? null, flags,
      })
      setText(''); setCode(''); setPicked(''); await refresh()
    } finally { setBusy(false) }
  }
  const patch = async (id: string, body: Record<string, unknown>) => { await jsend('/api/moderator/floor-motions', 'PATCH', { id, ...body }); await refresh() }
  const addAmendment = async (body: Record<string, unknown>) => { await jsend('/api/moderator/floor-motions', 'POST', body); await refresh() }

  // Amendments render nested under the motion they amend, never as top-level rows.
  const kids = new Map<string, FloorMotion[]>()
  for (const m of floor) {
    if (!m.amends) continue
    kids.set(m.amends, [...(kids.get(m.amends) ?? []), m].sort((a, b) => a.sort_order - b.sort_order))
  }

  // In a report: focus on that report's resolutions (all statuses, in order).
  // Otherwise: the classic live queue of pending/seconded ad-hoc motions.
  const reportMotions = inReport
    ? floor.filter(m => m.agenda_item_id === current!.id && !m.amends).sort((a, b) => a.sort_order - b.sort_order)
    : []
  const liveMotions = floor.filter(m =>
    !m.amends && ['pending', 'seconded'].includes(m.status) && (!inReport || m.agenda_item_id !== current!.id))

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 mb-2">
        {inReport ? `Resolutions — ${current!.title}` : 'Motion console'}
      </h3>

      {editing && (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            placeholder={inReport ? 'Add / record a resolution under this report…' : 'Motion from the floor…'}
            className="w-full px-3 py-2 text-[15px] bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={code} onChange={e => setCode(e.target.value)}
              placeholder={inReport ? 'Code…' : nextFL}
              className="w-24 px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 placeholder-slate-400 font-semibold" />
            <select value={pickedCitation} onChange={e => setPicked(e.target.value)}
              className="flex-1 min-w-[180px] px-2 py-2 text-sm border border-slate-300 rounded-lg bg-white text-slate-900">
              <option value="">Classify (optional)…</option>
              {['main', 'subsidiary', 'privileged', 'incidental', 'bring_back'].map(cls => (
                <optgroup key={cls} label={cls.replace('_', ' ')}>
                  {catalog.filter(m => m.motion_class === cls).map(m => (
                    <option key={m.citation} value={m.citation}>{m.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button onClick={add} disabled={busy} className="px-4 py-2 rounded-lg bg-[#00426A] text-white text-sm font-semibold disabled:opacity-50">Add</button>
          </div>
          {picked && (
            <div className="mt-2 text-xs text-slate-700 bg-slate-100 rounded-lg px-3 py-2">
              <b>{picked.name}</b> · second: {YN(picked.needs_second)} · debatable: {YN(picked.debatable)} · amendable: {YN(picked.amendable)} · vote: <b>{prettyVote(picked.vote)}</b>{picked.vote_has_exceptions ? ' ⚠' : ''}
            </div>
          )}
        </>
      )}

      {inReport && (
        <div className="mt-3 space-y-2">
          {reportMotions.length === 0 && <p className="text-sm text-slate-600">No resolutions yet under this report.</p>}
          {reportMotions.map((m, i) => <MotionCard key={m.id} m={m} index={i + 1} patch={patch} kids={kids} addAmendment={addAmendment} />)}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {inReport && liveMotions.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Other live motions</p>}
        {!inReport && liveMotions.length === 0 && <p className="text-sm text-slate-600">No pending motions.</p>}
        {liveMotions.map(m => <MotionCard key={m.id} m={m} patch={patch} kids={kids} addAmendment={addAmendment} />)}
      </div>
    </div>
  )
}

/** One motion: code, text, badges, Synod threshold confirm/override, status
 *  actions with explicit in-flight/recorded feedback, inline Amend flow, and
 *  nested amendment cards. All mutating affordances appear only in Edit mode. */
function MotionCard({ m, index, patch, kids, addAmendment }: {
  m: FloorMotion; index?: number; patch: (id: string, body: Record<string, unknown>) => Promise<void>
  kids?: Map<string, FloorMotion[]>; addAmendment?: (body: Record<string, unknown>) => Promise<void>
}) {
  const { editing } = useMod()
  const suggested = m.flags?.some(f => f.startsWith(SYNOD_FLAG_PREFIX))
  const clearSuggestion = (extra: Record<string, unknown> = {}) =>
    patch(m.id, { flags: (m.flags ?? []).filter(f => !f.startsWith(SYNOD_FLAG_PREFIX)), ...extra })

  // Disposition feedback: the clicked button shows a spinner while the PATCH is
  // in flight, then "✓ recorded" for a moment — so the chair knows it took.
  const [acting, setActing] = useState<string | null>(null)
  const [recorded, setRecorded] = useState<string | null>(null)
  const act = async (label: string, body: Record<string, unknown>) => {
    if (acting) return
    setActing(label)
    try {
      await patch(m.id, body)
      setRecorded(label); setTimeout(() => setRecorded(c => (c === label ? null : c)), 2000)
    } finally { setActing(null) }
  }
  const DispBtn = ({ label, body, color }: { label: string; body: Record<string, unknown>; color: string }) => (
    <button onClick={() => act(label, body)} disabled={!!acting}
      className={`px-2.5 py-1 text-xs rounded-md text-white font-semibold transition disabled:opacity-50 ${recorded === label ? 'bg-emerald-700 ring-2 ring-emerald-300' : color}`}>
      {acting === label ? '⏳ saving…' : recorded === label ? '✓ recorded' : label}
    </button>
  )

  // Inline Amend flow. RONR stops at second-order amendments; the suggested
  // code follows the GA scheme (GL2 → GL2.1; GL2.1 → GL2.1.1) from siblings
  // already pointed at this motion. Editor is seeded with this motion's text so
  // the change is marked as strikethrough/insertion against it.
  const children = kids?.get(m.id) ?? []
  const [amending, setAmending] = useState(false)
  const [amendCode, setAmendCode] = useState('')
  const [amendBusy, setAmendBusy] = useState(false)
  const canAmend = !!addAmendment && codeDepth(m.code) < 2 && ['pending', 'seconded', 'tabled'].includes(m.status)
  const openAmend = () => {
    setAmendCode(nextAmendmentCode(m.code, children.map(c => c.code)) ?? '')
    setAmending(true)
  }
  const submitAmend = async (html: string) => {
    if (!htmlToPlain(html).trim() || amendBusy) return
    setAmendBusy(true)
    try {
      await addAmendment!({ text: html, code: amendCode.trim() || null, amends: m.id, agenda_item_id: m.agenda_item_id })
      setAmending(false)
    } finally { setAmendBusy(false) }
  }

  return (
    <div className="border border-slate-200 bg-white rounded-xl p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px] text-slate-900 flex-1">
          {m.code && <span className="inline-block mr-1.5 px-1.5 py-0.5 rounded-md bg-[#E6F1FB] text-[#00426A] text-xs font-bold font-mono align-text-bottom">{m.code}</span>}
          {index != null && !m.code && <span className="text-slate-600 font-semibold mr-1">{index}.</span>}<ResolutionText html={m.text} />
        </p>
        <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[m.status]}`}>{m.status === 'rejected' ? 'defeated' : m.status}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-600">
        {m.ronr_citation && <span className="px-1.5 py-0.5 rounded-md bg-slate-100">RONR {m.ronr_citation}</span>}
        {m.vote_required && (
          <span className={`px-1.5 py-0.5 rounded ${suggested ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>
            vote: {prettyVote(m.vote_required)}{suggested ? ' · Synod (unconfirmed)' : ''}
          </span>
        )}
        {m.requires_second === false && <span className="px-1.5 py-0.5 rounded-md bg-slate-100">no second</span>}
        {m.flags?.filter(f => !f.startsWith(SYNOD_FLAG_PREFIX)).map(f =>
          <span key={f} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">⚠ {f}</span>)}
      </div>
      {suggested && m.notes && <p className="mt-1 text-[11px] italic text-amber-700">{m.notes}</p>}
      {editing && suggested && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-700">Threshold:</span>
          <button onClick={() => clearSuggestion()} className="px-2.5 py-1 text-xs rounded-md bg-emerald-600 text-white font-semibold">Confirm {prettyVote(m.vote_required)}</button>
          <select defaultValue="" onChange={e => { if (e.target.value) clearSuggestion({ vote_required: e.target.value }) }}
            className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white text-slate-900">
            <option value="">Override…</option>
            <option value="majority">majority</option>
            <option value="2/3">2/3</option>
          </select>
        </div>
      )}
      {editing && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!m.seconded && m.requires_second !== false && (
            <DispBtn label="Seconded" body={{ seconded: true, status: 'seconded' }} color="bg-indigo-600" />
          )}
          <DispBtn label="Adopted" body={{ status: 'adopted' }} color="bg-green-600" />
          <DispBtn label="Defeated" body={{ status: 'rejected' }} color="bg-red-600" />
          <DispBtn label="Tabled" body={{ status: 'tabled' }} color="bg-blue-600" />
          <DispBtn label="Withdrawn" body={{ status: 'withdrawn' }} color="bg-gray-400" />
          {canAmend && !amending && (
            <button onClick={openAmend} disabled={!!acting}
              className="px-2.5 py-1 text-xs rounded-md border border-[#00426A] text-[#00426A] font-semibold disabled:opacity-50">
              Amend…
            </button>
          )}
        </div>
      )}

      {editing && amending && (
        <div className="mt-2 ml-4 border-l-2 border-[#00426A] pl-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">Amendment</span>
            <input value={amendCode} onChange={e => setAmendCode(e.target.value)} placeholder="Code…"
              className="w-24 px-2 py-1 text-xs border border-slate-300 rounded-md bg-white text-slate-900 font-semibold" />
          </div>
          <RichEditor initialHTML={m.text} saving={amendBusy} onSave={submitAmend} onCancel={() => setAmending(false)} />
        </div>
      )}

      {children.length > 0 && (
        <div className="mt-2 ml-4 border-l-2 border-slate-300 pl-3 space-y-2">
          {children.map(c => <MotionCard key={c.id} m={c} patch={patch} kids={kids} addAmendment={addAmendment} />)}
        </div>
      )}
    </div>
  )
}

function RulesLookup({ catalog }: { catalog: Motion[] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim()
    return s ? catalog.filter(m => m.name.toLowerCase().includes(s) || m.citation.includes(s)) : catalog
  }, [q, catalog])
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-sm font-bold text-slate-800">
        <span>Motion rules quick-lookup</span><span className="text-slate-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter motions…"
            className="mt-2 w-full px-3 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-slate-600 border-b border-slate-200">
                <th className="py-1 pr-2">Motion</th><th className="px-1">Deb</th><th className="px-1">Amd</th><th className="px-1">2nd</th><th className="px-1">Vote</th><th className="px-1">Recon</th>
              </tr></thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.citation} className="border-b border-slate-200">
                    <td className="py-1.5 pr-2"><span className="font-semibold text-slate-900">{m.name}</span> <span className="text-slate-500">{m.citation}</span></td>
                    <td className="px-1 text-center">{YN(m.debatable)}</td>
                    <td className="px-1 text-center">{YN(m.amendable)}</td>
                    <td className="px-1 text-center">{YN(m.needs_second)}</td>
                    <td className="px-1 whitespace-nowrap">{prettyVote(m.vote)}{m.vote_has_exceptions ? '⚠' : ''}</td>
                    <td className="px-1 text-center">{m.reconsider ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ──────────────────────────── PREP MODE ──────────────────────────── */

// Minimal rich-text editor for amendment markup. contentEditable + execCommand
// keeps it dependency-free; the only formatting offered is what policy amendments
// need — strikethrough (deletion) and underline (insertion), plus bold/italic.
// Uncontrolled: innerHTML is seeded once and read back on save, so the live poll
// (held while focused) can't yank the caret mid-edit. Server sanitizes on write.
function RichEditor({ initialHTML, saving, onSave, onCancel }: {
  initialHTML: string; saving: boolean
  onSave: (html: string) => void; onCancel: () => void
}) {
  const { holdPoll, releasePoll } = useMod()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
    const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range)
  }, [])
  // execCommand is deprecated but universally supported and ideal for this tiny,
  // closed set of inline styles. preventDefault on the toolbar keeps the selection.
  const cmd = (c: string) => { document.execCommand(c); ref.current?.focus() }
  const tbtn = 'w-7 h-7 text-xs rounded bg-slate-200 text-slate-800 hover:bg-slate-300 font-semibold leading-none'
  return (
    <div className="text-[13px]">
      <div className="flex items-center gap-1 mb-1">
        <button type="button" title="Strikethrough — mark a deletion" onMouseDown={e => e.preventDefault()} onClick={() => cmd('strikeThrough')} className={`${tbtn} line-through`}>S</button>
        <button type="button" title="Underline — mark an insertion" onMouseDown={e => e.preventDefault()} onClick={() => cmd('underline')} className={`${tbtn} underline`}>U</button>
        <button type="button" title="Bold" onMouseDown={e => e.preventDefault()} onClick={() => cmd('bold')} className={`${tbtn} font-bold`}>B</button>
        <button type="button" title="Italic" onMouseDown={e => e.preventDefault()} onClick={() => cmd('italic')} className={`${tbtn} italic`}>I</button>
        <span className="ml-1.5 text-[10px] text-slate-500"><s className="text-red-700">deletion</s> · <u className="text-emerald-700 decoration-2">insertion</u></span>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
        onFocus={holdPoll} onBlur={releasePoll}
        dangerouslySetInnerHTML={{ __html: sanitizeRich(initialHTML) }}
        className="min-h-[3.5rem] w-full px-2 py-1.5 bg-white text-slate-900 border border-slate-300 rounded-md outline-none focus:border-[#00426A] whitespace-pre-wrap [&_s]:text-red-700 [&_s]:bg-red-50 [&_s]:rounded-sm [&_s]:px-0.5 [&_s]:decoration-red-600 [&_u]:text-emerald-800 [&_u]:bg-emerald-50 [&_u]:rounded-sm [&_u]:px-0.5 [&_u]:decoration-emerald-600 [&_u]:decoration-2" />
      <div className="mt-1 flex gap-2">
        <button onClick={() => onSave(ref.current?.innerHTML ?? '')} disabled={saving} className="px-3 py-1 text-xs rounded-md bg-[#00426A] text-white font-semibold disabled:opacity-50">Save</button>
        <button onClick={onCancel} className="px-3 py-1 text-xs rounded-md bg-slate-200 text-slate-800 hover:bg-slate-300 font-semibold">Cancel</button>
      </div>
    </div>
  )
}

// One resolution under a report — read-only chip that flips to an inline editor.
// Edits surface immediately in the live console, so the bones can go in now and
// be wordsmithed later as committees finalize.
function ResolutionRow({ r, idx, editResolution, recheckThreshold, delMotion }: {
  r: FloorMotion; idx: number
  editResolution: (id: string, body: { text?: string; code?: string | null }) => Promise<void>
  recheckThreshold: (id: string) => Promise<void>
  delMotion: (id: string) => Promise<void>
}) {
  const { editing, holdPoll, releasePoll } = useMod()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [code, setCode] = useState(r.code ?? '')
  const synodNote = r.notes?.startsWith('Synod:') ? r.notes : null
  const save = async (html: string) => {
    if (!htmlToPlain(html).trim() || saving) return
    setSaving(true)
    try { await editResolution(r.id, { text: html, code: code.trim() || null }); setOpen(false) }
    finally { setSaving(false) }
  }
  const recheck = async () => {
    if (rechecking) return
    setRechecking(true)
    try { await recheckThreshold(r.id) } finally { setRechecking(false) }
  }
  if (open && editing) {
    return (
      <div>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Code (e.g. GL2)…"
          onFocus={holdPoll} onBlur={releasePoll}
          className="mb-1 w-32 px-2 py-1 text-xs border border-slate-300 rounded-md bg-white text-slate-900 font-semibold" />
        <RichEditor initialHTML={r.text} saving={saving} onSave={save} onCancel={() => { setCode(r.code ?? ''); setOpen(false) }} />
      </div>
    )
  }
  return (
    <div>
      <div className="flex items-start gap-2 text-[13px]">
        <span className="text-slate-600 font-semibold w-4 pt-0.5">{idx + 1}.</span>
        <span className="flex-1 text-slate-900">
          {r.code && <span className="inline-block mr-1 px-1.5 py-px rounded-md bg-[#E6F1FB] text-[#00426A] text-[11px] font-bold font-mono">{r.code}</span>}
          <ResolutionText html={r.text} />
          {r.vote_required && <span className="ml-1 text-[11px] text-slate-500">({prettyVote(r.vote_required)})</span>}
        </span>
        {editing && <button onClick={() => { setCode(r.code ?? ''); setOpen(true) }} aria-label="Edit resolution" className="text-slate-500 hover:text-slate-900 rounded px-1 leading-none">✎</button>}
        {editing && <button onClick={recheck} disabled={rechecking} aria-label="Re-check vote threshold" title="Re-check vote threshold against the current wording" className="text-slate-500 hover:text-slate-900 disabled:opacity-50 rounded px-1 leading-none">{rechecking ? '…' : '↻'}</button>}
        {editing && <button onClick={() => delMotion(r.id)} aria-label="Delete resolution" className="text-slate-500 hover:text-white hover:bg-red-600 rounded px-1 leading-none">✕</button>}
      </div>
      {synodNote && <p className="ml-6 mt-0.5 text-[11px] text-slate-500 italic">{synodNote}</p>}
    </div>
  )
}

function AgendaItemRow({ item, idx, motions, patch, del, addResolution, editResolution, recheckThreshold, delMotion, reorderResolutions, collapsed, toggleCollapse }: {
  item: AgendaItem; idx: number; motions: FloorMotion[]
  patch: (id: string, body: Record<string, unknown>) => Promise<void>
  del: (id: string) => Promise<void>
  addResolution: (reportId: string, text: string, code: string | null) => Promise<void>
  editResolution: (id: string, body: { text?: string; code?: string | null }) => Promise<void>
  recheckThreshold: (id: string) => Promise<void>
  delMotion: (id: string) => Promise<void>
  reorderResolutions: (reportId: string, ids: string[]) => void
  collapsed: boolean; toggleCollapse: () => void
}) {
  const { editing, holdPoll, releasePoll } = useMod()
  const sensors = useDragSensors()
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState(item.description ?? '')
  const [saving, setSaving] = useState(false)
  const [resText, setResText] = useState('')
  const [resCode, setResCode] = useState('')
  const [addingRes, setAddingRes] = useState(false)
  const isReport = item.item_type === 'report'
  // Amendments live under their parent motion in the live console, not here.
  const resolutions = motions.filter(m => m.agenda_item_id === item.id && !m.amends).sort((a, b) => a.sort_order - b.sort_order)

  const save = async () => {
    setSaving(true)
    try { await patch(item.id, { description: desc.trim() || null }); setOpen(false) }
    finally { setSaving(false) }
  }
  const addRes = async () => {
    if (!resText.trim() || addingRes) return
    setAddingRes(true)
    try { await addResolution(item.id, resText.trim(), resCode.trim() || null); setResText(''); setResCode('') }
    finally { setAddingRes(false) }
  }
  const onResDragEnd = (e: DragEndEvent) => {
    releasePoll()
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = resolutions.map(r => r.id)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    reorderResolutions(item.id, next)
  }

  return (
    <li className="border border-slate-200 bg-white rounded-xl px-3 py-2 hover:border-slate-300 transition-colors">
      <div className="flex items-center gap-2">
        <button onClick={toggleCollapse} aria-label={collapsed ? 'Expand item' : 'Collapse item'}
          className="text-slate-500 hover:text-slate-900 w-5 text-sm leading-none">{collapsed ? '▸' : '▾'}</button>
        <span className="text-slate-600 font-semibold text-sm w-5">{idx + 1}.</span>
        <span className="flex-1 text-[15px] font-medium text-slate-900 truncate">{item.title} <span className="text-xs font-normal text-slate-500">· {item.item_type}</span>
          {collapsed && isReport && <span className="ml-1.5 text-[11px] text-slate-500 font-normal">({resolutions.length} res)</span>}
        </span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[item.status] ?? ''}`}>{item.status}</span>
        {editing && (
          <button onClick={() => { setDesc(item.description ?? ''); setOpen(o => !o) }} className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-slate-300 font-semibold">
            {item.description ? '✎ wording' : '+ wording'}
          </button>
        )}
        {editing && item.status === 'pending' && <button onClick={() => patch(item.id, { status: 'active' })} className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-semibold">Start</button>}
        {editing && <button onClick={() => del(item.id)} aria-label="Delete item" className="text-slate-500 hover:text-white hover:bg-red-600 rounded px-1.5 py-0.5 text-base leading-none">✕</button>}
      </div>

      {!collapsed && !open && item.description && (
        <p className="mt-1 ml-7 text-xs text-slate-700 whitespace-pre-wrap">{item.description}</p>
      )}
      {!collapsed && open && editing && (
        <div className="mt-2 ml-7">
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} autoFocus
            onFocus={holdPoll} onBlur={releasePoll}
            placeholder="Motion wording / details — surfaces under this item in the live console…"
            className="w-full px-3 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
          <div className="mt-1 flex gap-2">
            <button onClick={save} disabled={saving} className="px-3 py-1 text-xs rounded-md bg-[#00426A] text-white font-semibold disabled:opacity-50">Save</button>
            <button onClick={() => { setDesc(item.description ?? ''); setOpen(false) }} className="px-3 py-1 text-xs rounded-md bg-slate-200 text-slate-800 hover:bg-slate-300 font-semibold">Cancel</button>
          </div>
        </div>
      )}

      {/* Nested resolutions under a report */}
      {!collapsed && isReport && (
        <div className="mt-2 ml-7 border-l-2 border-slate-300 pl-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 mb-1">Resolutions ({resolutions.length})</p>
          {resolutions.length === 0 && <p className="text-xs text-slate-500">None yet.</p>}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={holdPoll} onDragEnd={onResDragEnd}>
            <SortableContext items={resolutions.map(r => r.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1">
                {resolutions.map((r, i) => (
                  <SortableRow key={r.id} id={r.id} locked={!editing}>
                    <ResolutionRow r={r} idx={i} editResolution={editResolution} recheckThreshold={recheckThreshold} delMotion={delMotion} />
                  </SortableRow>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {editing && (
            <div className="mt-2 flex gap-2">
              <input value={resCode} onChange={e => setResCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRes()}
                onFocus={holdPoll} onBlur={releasePoll}
                placeholder="GL2…"
                className="w-20 px-2 py-1.5 text-[13px] bg-white text-slate-900 border border-slate-300 rounded-md outline-none focus:border-[#00426A] placeholder-slate-400 font-semibold" />
              <input value={resText} onChange={e => setResText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRes()}
                onFocus={holdPoll} onBlur={releasePoll}
                placeholder="Add resolution wording…"
                className="flex-1 px-2 py-1.5 text-[13px] bg-white text-slate-900 border border-slate-300 rounded-md outline-none focus:border-[#00426A] placeholder-slate-500" />
              <button onClick={addRes} disabled={addingRes} className="px-3 py-1.5 text-xs rounded-md bg-[#00426A] text-white font-semibold disabled:opacity-50">Add</button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function PrepMode({ agenda, floor, catalog, team, isOwner, setAgenda, setFloor, refresh, refreshTeam }: {
  agenda: AgendaItem[]; floor: FloorMotion[]; catalog: Motion[]; team: TeamMember[]; isOwner: boolean
  setAgenda: React.Dispatch<React.SetStateAction<AgendaItem[]>>
  setFloor: React.Dispatch<React.SetStateAction<FloorMotion[]>>
  refresh: () => Promise<void>; refreshTeam: () => Promise<void>
}) {
  const { editing, holdPoll, releasePoll } = useMod()
  const sensors = useDragSensors()
  const [title, setTitle] = useState('')
  const [type, setType] = useState('business')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  // Collapsed agenda items — collapsing hides wording + resolutions so long
  // agendas are compact enough to drag-reorder comfortably.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const add = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await jsend('/api/moderator/agenda', 'POST', { title: title.trim(), item_type: type, description: desc.trim() || null })
      setTitle(''); setDesc(''); await refresh()
    } finally { setBusy(false) }
  }
  const reset = async () => {
    if (busy || !confirm('Reset the agenda to its starting state? Every item returns to pending — nothing active or disposed. Floor motions are not affected.')) return
    setBusy(true)
    try { await jsend('/api/moderator/agenda', 'POST', { action: 'reset' }); await refresh() } finally { setBusy(false) }
  }
  const canReset = agenda.some(i => i.status !== 'pending')
  const patch = async (id: string, body: Record<string, unknown>) => { await jsend('/api/moderator/agenda', 'PATCH', { id, ...body }); await refresh() }
  const del = async (id: string) => { await fetch(`/api/moderator/agenda?id=${id}`, { method: 'DELETE' }); await refresh() }
  const addResolution = async (reportId: string, text: string, code: string | null) => { await jsend('/api/moderator/floor-motions', 'POST', { text, code, agenda_item_id: reportId }); await refresh() }
  const editResolution = async (id: string, body: { text?: string; code?: string | null }) => { await jsend('/api/moderator/floor-motions', 'PATCH', { id, ...body }); await refresh() }
  const recheckThreshold = async (id: string) => { await jsend('/api/moderator/floor-motions', 'PATCH', { id, action: 'recheck-threshold' }); await refresh() }
  const delMotion = async (id: string) => { await fetch(`/api/moderator/floor-motions?id=${id}`, { method: 'DELETE' }); await refresh() }
  const reorderResolutions = (reportId: string, ids: string[]) => {
    setFloor(prev => prev.map(m => { const i = ids.indexOf(m.id); return i === -1 ? m : { ...m, sort_order: i + 1 } }))
    jsend('/api/moderator/floor-motions', 'PATCH', { order: ids }).catch(() => refresh())
  }

  const onAgendaDragEnd = (e: DragEndEvent) => {
    releasePoll()
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = agenda.map(a => a.id)
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setAgenda(prev => next.map((id, i) => ({ ...prev.find(a => a.id === id)!, position: i })))
    jsend('/api/moderator/agenda', 'PATCH', { order: next }).catch(() => refresh())
  }

  return (
    <div className="space-y-4 pt-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-800">Build the agenda</h3>
          {agenda.length > 0 && (
            <button onClick={() => setCollapsed(c => c.size === agenda.length ? new Set() : new Set(agenda.map(a => a.id)))}
              className="px-2.5 py-1 rounded-lg border border-slate-400 text-slate-600 text-xs font-semibold hover:bg-slate-100">
              {collapsed.size === agenda.length ? '▾ Expand all' : '▸ Collapse all'}
            </button>
          )}
          {editing && canReset && (
            <button onClick={reset} disabled={busy}
              className="px-2.5 py-1 rounded-lg border border-slate-400 text-slate-600 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50">
              ↺ Reset to start
            </button>
          )}
        </div>
        {editing && (
          <>
            <div className="flex flex-wrap gap-2">
              <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
                placeholder="Agenda item…" className="flex-1 min-w-[180px] px-3 py-2 text-[15px] bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
              <select value={type} onChange={e => setType(e.target.value)} className="px-2 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg">
                {['business', 'report', 'special_order', 'election', 'recess', 'ceremonial', 'other'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
              <button onClick={add} disabled={busy} className="px-4 py-2 rounded-lg bg-[#00426A] text-white text-sm font-semibold disabled:opacity-50">Add</button>
            </div>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2}
              onFocus={holdPoll} onBlur={releasePoll}
              placeholder="Motion wording / details (optional) — surfaces under this item in the live console…"
              className="mt-2 w-full px-3 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
            <p className="mt-1 text-[11px] text-slate-600">Tip: set type to <b>report</b> to nest a series of resolutions beneath it.</p>
          </>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={holdPoll} onDragEnd={onAgendaDragEnd}>
          <SortableContext items={agenda.map(a => a.id)} strategy={verticalListSortingStrategy}>
            <ul className="mt-3 space-y-1.5">
              {agenda.map((i, idx) => (
                <SortableRow key={i.id} id={i.id} locked={!editing}>
                  <AgendaItemRow item={i} idx={idx} motions={floor} patch={patch} del={del}
                    addResolution={addResolution} editResolution={editResolution} recheckThreshold={recheckThreshold}
                    delMotion={delMotion} reorderResolutions={reorderResolutions}
                    collapsed={collapsed.has(i.id)}
                    toggleCollapse={() => setCollapsed(c => { const n = new Set(c); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n })} />
                </SortableRow>
              ))}
              {agenda.length === 0 && <p className="text-sm text-slate-600">No agenda items yet. {editing ? 'Add them above before assembly.' : 'Switch to Editing to add them.'}</p>}
            </ul>
          </SortableContext>
        </DndContext>
      </div>

      {isOwner && <RosterManager team={team} refreshTeam={refreshTeam} />}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 mb-1">Motion rules — full reference ({catalog.length})</h3>
        <p className="text-xs text-slate-600 mb-2">Robert&apos;s Rules 12th ed. Standard Descriptive Characteristics. ⚠ = threshold has exceptions; verify on the floor.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-slate-600 border-b border-slate-200">
              <th className="py-1 pr-2">Motion</th><th className="px-1">Class</th><th className="px-1">Int</th><th className="px-1">2nd</th><th className="px-1">Deb</th><th className="px-1">Amd</th><th className="px-1">Vote</th><th className="px-1">Recon</th>
            </tr></thead>
            <tbody>
              {catalog.map(m => (
                <tr key={m.citation} className="border-b border-slate-200">
                  <td className="py-1.5 pr-2"><span className="font-semibold text-slate-900">{m.name}</span> <span className="text-slate-500">{m.citation}</span></td>
                  <td className="px-1 text-slate-600">{m.motion_class.replace('_', ' ')}</td>
                  <td className="px-1 text-center">{YN(m.interrupt)}</td>
                  <td className="px-1 text-center">{YN(m.needs_second)}</td>
                  <td className="px-1 text-center">{YN(m.debatable)}</td>
                  <td className="px-1 text-center">{YN(m.amendable)}</td>
                  <td className="px-1 whitespace-nowrap">{prettyVote(m.vote)}{m.vote_has_exceptions ? '⚠' : ''}</td>
                  <td className="px-1 text-center">{m.reconsider ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** Chair-only: manage the external moderation-support roster. */
function RosterManager({ team, refreshTeam }: { team: TeamMember[]; refreshTeam: () => Promise<void> }) {
  const { editing, holdPoll, releasePoll } = useMod()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const add = async () => {
    if (!email.trim() || busy) return
    setBusy(true); setErr(''); setMsg('')
    try {
      const r = await jsend<{ invited: boolean; inviteError?: string }>('/api/moderator/team', 'POST', { email: email.trim(), name: name.trim() || null })
      setEmail(''); setName(''); await refreshTeam()
      if (r.invited) setMsg('Added — invite email sent.')
      else setErr(`Added, but the invite email did not send${r.inviteError ? `: ${r.inviteError}` : ''}.`)
    }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async (e: string) => { await fetch(`/api/moderator/team?email=${encodeURIComponent(e)}`, { method: 'DELETE' }); await refreshTeam() }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-800 mb-1">Moderation support team</h3>
      <p className="text-xs text-slate-600 mb-2">External users scoped to this panel only. They sign in by email code and can edit agenda &amp; motions — they have no other access.</p>
      {editing && (
        <div className="flex flex-wrap gap-2">
          <input value={email} onChange={e => setEmail(e.target.value)} onFocus={holdPoll} onBlur={releasePoll}
            placeholder="email@example.com" type="email"
            className="flex-1 min-w-[180px] px-3 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
          <input value={name} onChange={e => setName(e.target.value)} onFocus={holdPoll} onBlur={releasePoll}
            placeholder="Name (optional)"
            className="min-w-[120px] px-3 py-2 text-sm bg-white text-slate-900 border border-slate-300 rounded-lg outline-none focus:border-[#00426A] placeholder-slate-500" />
          <button onClick={add} disabled={busy} className="px-4 py-2 rounded-lg bg-[#00426A] text-white text-sm font-semibold disabled:opacity-50">Invite</button>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {msg && <p className="mt-2 text-xs text-emerald-700 font-medium">{msg}</p>}
      <ul className="mt-3 space-y-1.5">
        {team.length === 0 && <p className="text-sm text-slate-600">No support members yet.</p>}
        {team.map(m => (
          <li key={m.email} className="flex items-center gap-2 border border-slate-200 bg-white rounded-xl px-3 py-2 hover:border-slate-300 transition-colors">
            <span className="flex-1 text-[14px] text-slate-900">{m.name ? <b>{m.name}</b> : null} <span className="text-slate-600">{m.email}</span></span>
            {editing && <button onClick={() => remove(m.email)} className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-800 hover:bg-red-600 hover:text-white font-semibold">Remove</button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
