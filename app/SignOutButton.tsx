'use client'

import { useRouter } from 'next/navigation'
import { createBrowserAuthClient } from '@/lib/supabase-browser'

export default function SignOutButton() {
  const router = useRouter()
  const signOut = async () => {
    await createBrowserAuthClient().auth.signOut()
    router.push('/login')
    router.refresh()
  }
  return (
    <button onClick={signOut} className="text-sm text-gray-500 hover:text-gray-800 font-medium">
      Sign out
    </button>
  )
}
