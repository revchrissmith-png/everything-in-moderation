// /api/moderator/team — roster of external moderation-support users. Chair-only
// (requireModeratorOwner). POST provisions a Supabase auth user so OTP login works.
import { NextRequest, NextResponse } from 'next/server'
import { requireModeratorOwner } from '../_guard'
import { getSessionUser } from '@/lib/auth'
import { getModeratorTeam, addModeratorTeamMember, removeModeratorTeamMember, sendModeratorInvite } from '@/lib/moderator'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function GET() {
  const denied = await requireModeratorOwner(); if (denied) return denied
  return NextResponse.json({ members: await getModeratorTeam() })
}

export async function POST(req: NextRequest) {
  const denied = await requireModeratorOwner(); if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  const actor = await getSessionUser()
  try {
    const member = await addModeratorTeamMember(email, typeof body.name === 'string' ? body.name : null, actor?.email ?? 'owner')
    const invite = await sendModeratorInvite(member.email, member.name)
    return NextResponse.json({ member, invited: invite.sent, inviteError: invite.sent ? undefined : invite.detail })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireModeratorOwner(); if (denied) return denied
  const email = new URL(req.url).searchParams.get('email')
  if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 })
  await removeModeratorTeamMember(email)
  return NextResponse.json({ ok: true })
}
