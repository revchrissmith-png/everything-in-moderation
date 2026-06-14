// POST /api/moderator/query — Parliamentarian answer, grounded + cited, over
// the RONR corpus + C&MA governing-document policy. Chair + support team only.
import { NextRequest, NextResponse } from 'next/server'
import { requireModerator } from '../_guard'
import { answerParliamentaryQuery } from '@/lib/moderator'

export async function POST(req: NextRequest) {
  const denied = await requireModerator()
  if (denied) return denied

  let body: { query?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) return NextResponse.json({ error: 'A question is required.' }, { status: 400 })
  if (query.length > 1000) return NextResponse.json({ error: 'Question is too long (1000 characters max).' }, { status: 400 })

  try {
    return NextResponse.json(await answerParliamentaryQuery(query))
  } catch (err) {
    console.error('[moderator] query failed:', err)
    return NextResponse.json({ error: 'The Parliamentarian could not answer right now. Try again in a moment.' }, { status: 500 })
  }
}
