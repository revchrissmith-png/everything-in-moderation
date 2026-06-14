import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Everything in Moderation',
  description: 'A floor console for the chair of a C&MA business session.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
