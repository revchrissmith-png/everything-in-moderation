// Shared guard for /api/moderator/* — two tiers:
//   requireModerator      → the chair (MODERATOR_EMAIL) OR an allow-listed
//                           support-team member (ga_moderator_team). Full edit
//                           parity on agenda + motions.
//   requireModeratorOwner → the chair only. Roster management.
// Returns null when authorized, or a 401/403 response.
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { MODERATOR_EMAIL, isModeratorTeam } from '@/lib/moderator'

export async function requireModerator(): Promise<NextResponse | null> {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = user.email.toLowerCase()
  if (MODERATOR_EMAIL && email === MODERATOR_EMAIL) return null
  if (await isModeratorTeam(email)) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function requireModeratorOwner(): Promise<NextResponse | null> {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MODERATOR_EMAIL || user.email.toLowerCase() !== MODERATOR_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
