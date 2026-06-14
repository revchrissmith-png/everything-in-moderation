// GET /api/moderator/motions — the structured RONR motion-characteristics table
// (Table II) for the motion console + quick-lookup grid. Chris-only.
import { NextResponse } from 'next/server'
import { requireModerator } from '../_guard'
import { listMotions } from '@/lib/moderator'

export async function GET() {
  const denied = await requireModerator()
  if (denied) return denied
  try {
    return NextResponse.json({ motions: await listMotions() })
  } catch (err) {
    console.error('[moderator] motions failed:', err)
    return NextResponse.json({ error: 'Could not load motions.' }, { status: 500 })
  }
}
