import { useState } from 'react'
import { readConsent, saveConsent } from '@/components/store/CookieBanner'
import { Seo } from '@/components/store/Seo'
import { Button, Checkbox, useToast } from '@/components/ui'

export default function CookiePreferences() {
  const existing = readConsent()
  const [analytics, setAnalytics] = useState(existing?.analytics ?? false)
  const [marketing, setMarketing] = useState(existing?.marketing ?? false)
  const toast = useToast()
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 md:py-24">
      <Seo title="Cookie preferences" />
      <h1 className="font-display text-5xl">Cookie preferences</h1>
      <p className="mt-4 text-charcoal-600">Choose which optional cookies we may use. Essential cookies keep you signed in and make checkout work; they cannot be switched off.</p>
      <div className="mt-10 space-y-6 border border-line bg-white/60 p-6">
        <Checkbox checked disabled label={<span><strong className="font-medium">Essential</strong> — sign-in, bag and checkout.</span>} />
        <Checkbox checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} label={<span><strong className="font-medium">Analytics</strong> — privacy-friendly, aggregated visit statistics.</span>} />
        <Checkbox checked={marketing} onChange={(e) => setMarketing(e.target.checked)} label={<span><strong className="font-medium">Marketing</strong> — not currently used.</span>} />
        <Button onClick={() => { saveConsent({ necessary: true, analytics, marketing }); toast('Preferences saved') }}>Save preferences</Button>
      </div>
    </div>
  )
}
