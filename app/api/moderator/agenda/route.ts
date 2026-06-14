// /api/moderator/agenda — GA agenda CRUD + advance + reorder. Chair or support team.
import { NextRequest, NextResponse } from 'next/server'
import { requireModerator } from '../_guard'
import { listAgenda, addAgendaItem, updateAgendaItem, deleteAgendaItem, advanceAgenda, regressAgenda, resetAgenda, reorderAgenda } from '@/lib/moderator'

export async function GET() {
  const denied = await requireModerator(); if (denied) return denied
  return NextResponse.json({ items: await listAgenda() })
}

export async function POST(req: NextRequest) {
  const denied = await requireModerator(); if (denied) return denied
  const body = await req.json().catch(() => ({}))
  if (body.action === 'advance') { await advanceAgenda(); return NextResponse.json({ items: await listAgenda() }) }
  if (body.action === 'back') { await regressAgenda(); return NextResponse.json({ items: await listAgenda() }) }
  if (body.action === 'reset') { await resetAgenda(); return NextResponse.json({ items: await listAgenda() }) }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 })
  const item = await addAgendaItem({ title, description: body.description, item_type: body.item_type })
  return NextResponse.json({ item })
}

export async function PATCH(req: NextRequest) {
  const denied = await requireModerator(); if (denied) return denied
  const body = await req.json().catch(() => ({}))
  if (Array.isArray(body.order)) {
    await reorderAgenda(body.order as string[])
    return NextResponse.json({ items: await listAgenda() })
  }
  if (!body.id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  return NextResponse.json({ item: await updateAgendaItem(body.id, body) })
}

export async function DELETE(req: NextRequest) {
  const denied = await requireModerator(); if (denied) return denied
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  await deleteAgendaItem(id)
  return NextResponse.json({ ok: true })
}
