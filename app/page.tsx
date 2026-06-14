export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { MODERATOR_EMAIL, isModeratorTeam } from '@/lib/moderator'
import ModeratorTab from './ModeratorTab'
import SignOutButton from './SignOutButton'

// The console is the whole app. Authorized = the chair (MODERATOR_EMAIL) or an
// allow-listed support-team member. Everyone else is bounced to sign in.
export default async function Home() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const email = user.email.toLowerCase()
  const isChair = !!MODERATOR_EMAIL && email === MODERATOR_EMAIL
  const authorized = isChair || (await isModeratorTeam(email))
  if (!authorized) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-[#00426A]">⚖️ Moderator console</h1>
            <p className="text-xs text-gray-400">{user.name ?? user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-4">
        <ModeratorTab />
      </main>
    </div>
  )
}
