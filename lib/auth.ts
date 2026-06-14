// Session helper for the standalone app. Reads the Supabase auth cookie and
// returns the signed-in user. Authorization (chair vs. support team) is decided
// by callers against MODERATOR_EMAIL and the ga_moderator_team allow-list.
import { createAuthClient } from './supabase-auth'

export interface SessionUser {
  email: string
  name: string | null
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null
  const name = (user.user_metadata?.name as string | undefined) ?? null
  return { email: user.email, name }
}
