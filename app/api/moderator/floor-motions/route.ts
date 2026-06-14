// /api/moderator/floor-motions — floor motion console CRUD + reorder. Chair or support team.
import { NextRequest, NextResponse } from 'next/server'
import { requireModerator } from '../_guard'
import { listFloorMotions, addFloorMotion, updateFloorMotion, deleteFloorMotion, reorderMotions, recheckMotionThreshold } from '@/lib/moderator'

export async function GET() {
  const denied = await requireModerator(); if (denied) return denied
  return NextResponse.json({ motions: await listFloorMotions() })
}

export async function POST(req: NextRequest) {
  const denied = await requireModerator(); if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Motion text is required.' }, { status: 400 })
  const motion = await addFloorMotion({
    text, agenda_item_id: body.agenda_item_id ?? null, motion_class: body.motion_class ?? null,
    ronr_citation: body.ronr_citation ?? null, requires_second: body.requires_second ?? null,
    vote_required: body.vote_required ?? null, flags: body.flags ?? [],
    code: body.code ?? null, amends: body.amends ?? null,
  })
  return NextResponse.json({ motion })
}

export async function PATCH(req: NextRequest) {
  const denied = await requireModerator(); if (denied) return denied
  const body = await req.json().catch(() => ({}))
  if (Array.isArray(body.order)) {
    await reorderMotions(body.order as string[])
    return NextResponse.json({ motions: await listFloorMotions() })
  }
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  if (body.action === 'recheck-threshold') {
    return NextResponse.json({ motion: await recheckMotionThreshold(body.id) })
  }
  return NextResponse.json({ motion: await updateFloorMotion(body.id, body) })
}

export async function DELETE(req: NextRequest) {
  const denied = await requireModerator(); if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  await deleteFloorMotion(id)
  return NextResponse.json({ ok: true })
}
