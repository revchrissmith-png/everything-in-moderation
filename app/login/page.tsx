'use client'

import { useState } from 'react'
import { createBrowserAuthClient } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function Login() {
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [step, setStep] = useState<'request' | 'verify'>('request')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createBrowserAuthClient()

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) {
      setMessage(error.message.includes('not authorized') || error.message.includes('Signups not allowed')
        ? 'That email is not registered for access. Contact your district administrator.'
        : `Error: ${error.message}`)
    } else {
      setStep('verify')
    }
    setLoading(false)
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('Verifying…')
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) {
      setMessage(`Invalid code: ${error.message}`)
      setLoading(false)
    } else if (data.session) {
      router.push('/')
      router.refresh()
    } else {
      setMessage('Could not confirm session. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#EAEAEE' }}>
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-xl font-bold text-center" style={{ color: '#00426A' }}>Everything in Moderation</h1>
          <p className="text-sm text-gray-500 mt-1">Moderator console</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {step === 'request' ? (
            <form onSubmit={handleRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                  style={{ '--tw-ring-color': '#0077C8' } as React.CSSProperties}
                />
              </div>
              {message && <p className="text-sm text-red-500">{message}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ backgroundColor: '#0077C8' }}
              >
                {loading ? 'Sending…' : 'Send Access Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerify} className="space-y-4">
              <p className="text-sm text-gray-600">
                A 6-digit code was sent to <strong>{email}</strong>. Check your inbox.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Access code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:border-transparent"
                />
              </div>
              {message && (
                <p className={`text-sm ${message.startsWith('Invalid') ? 'text-red-500' : 'text-gray-500'}`}>
                  {message}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                style={{ backgroundColor: '#0077C8' }}
              >
                {loading ? 'Verifying…' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('request'); setMessage(''); setToken('') }}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                ← Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
