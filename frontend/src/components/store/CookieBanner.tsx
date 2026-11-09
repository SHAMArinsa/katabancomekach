import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { useSettings } from '@/features/catalog/hooks'
import { api } from '@/services/api'

const KEY = 'gl_cookie_consent_v1'
export interface Consent { necessary: true; analytics: boolean; marketing: boolean }

export function readConsent(): Consent | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}

export function saveConsent(c: Consent) {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* ignore */ }
  api.post('/public/consent', c).catch(() => {})
  window.dispatchEvent(new Event('gl-consent'))
}

export function CookieBanner() {
  const { data } = useSettings()
  const [consent, setConsent] = useState<Consent | null>(readConsent)
  useEffect(() => {
    const on = () => setConsent(readConsent())
    window.addEventListener('gl-consent', on)
    return () => window.removeEventListener('gl-consent', on)
  }, [])
  if (!data?.privacy.cookie_banner_enabled || consent) return null
  const choose = (analytics: boolean) => saveConsent({ necessary: true, analytics, marketing: false })
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ivory/97 px-5 py-4 shadow-soft md:px-10" role="region" aria-label="Cookie consent">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-charcoal-700">
          We use essential cookies to run the store and, only with your permission, privacy-friendly analytics.{' '}
          <Link to="/cookie-preferences" className="underline decoration-champagne underline-offset-4">Preferences</Link>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => choose(false)}>Essential only</Button>
          <Button size="sm" onClick={() => choose(true)}>Accept analytics</Button>
        </div>
      </div>
    </div>
  )
}
