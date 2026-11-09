import { useMutation } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Checkbox, Input, useToast } from '@/components/ui'
import { Mail, Phone } from 'lucide-react'
import { useCategories, useSettings } from '@/features/catalog/hooks'
import { api, errorMessage } from '@/services/api'
import { Logo } from './Header'

export function NewsletterForm({ dark }: { dark?: boolean }) {
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const toast = useToast()
  const m = useMutation({
    mutationFn: () => api.post('/public/newsletter', { email, consent }),
    onSuccess: () => { setEmail(''); setConsent(false); toast('Thank you — you are on the list.') },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Newsletter sign-up">
      <div className="flex gap-2">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address"
          className={dark ? 'border-charcoal-600 bg-transparent text-ivory placeholder:text-charcoal-400' : ''} />
        <Button type="submit" variant={dark ? 'gold' : 'primary'} loading={m.isPending} disabled={!consent}>Join</Button>
      </div>
      <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} className={dark ? 'text-charcoal-400' : ''}
        label={<span className="text-xs">I would like to receive emails and can unsubscribe at any time.</span>} />
    </form>
  )
}

export function Footer() {
  const { data } = useSettings()
  const { data: cats } = useCategories()
  const s = data?.store
  const social = Object.entries(s?.social ?? {}).filter(([, v]) => v)
  const col = (title: string, links: [string, string][]) => (
    <div>
      <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.06em]">{title}</h3>
      <ul className="space-y-2.5 text-sm text-charcoal-600">{links.map(([to, l]) => <li key={to}><Link to={to} className="hover:text-champagne-600">{l}</Link></li>)}</ul>
    </div>
  )
  return (
    <footer className="mt-20 border-t border-line bg-ivory-100 text-charcoal">
      {data?.content.newsletter_enabled && (
        <div className="bg-champagne-50">
          <div className="container-luxe grid items-center gap-6 py-10 md:grid-cols-2">
            <div>
              <h3 className="font-display text-2xl font-semibold">Stay in touch</h3>
              <p className="mt-1 text-sm text-charcoal-600">{data.content.newsletter_text}</p>
            </div>
            <NewsletterForm />
          </div>
        </div>
      )}
      <div className="container-luxe grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-charcoal-600">{s?.footer_text}</p>
          <ul className="mt-5 space-y-2 text-sm">
            {s?.contact_email && <li className="flex items-center gap-2"><Mail className="h-4 w-4 text-champagne-500" /><a href={`mailto:${s.contact_email}`} className="hover:text-champagne-600">{s.contact_email}</a></li>}
            {s?.contact_phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4 text-champagne-500" /><a href={`tel:${s.contact_phone}`} className="hover:text-champagne-600">{s.contact_phone}</a></li>}
          </ul>
          {social.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {social.map(([k, v]) => <li key={k}><a href={v} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold capitalize hover:border-champagne-400">{k}</a></li>)}
            </ul>
          )}
        </div>
        {col('Shop', (cats ?? []).filter((c) => !c.parent_id).slice(0, 6).map((c) => [`/categories/${c.slug}`, c.name] as [string, string]).concat([['/sale', 'Sale']]))}
        {col('Quick links', [['/new-arrivals', 'New in'], ['/bestsellers', 'Bestsellers'], ['/gifts', 'Gifts'], ['/collections', 'Collections'], ['/about', 'About us']])}
        {col('Help', [['/contact', 'Contact us'], ['/track', 'Track your order'], ['/faq', 'FAQs'], ['/shipping-policy', 'Shipping policy'], ['/returns-policy', 'Returns & refunds']])}
      </div>
      <div className="border-t border-line bg-white">
        <div className="container-luxe flex flex-col gap-4 py-5 text-xs text-charcoal-500 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} {s?.brand_name}. All rights reserved.{s?.gstin ? ` · GSTIN ${s.gstin}` : ''}</p>
          <ul className="flex flex-wrap items-center gap-2" aria-label="Payment methods">
            {['UPI', 'Visa', 'Mastercard', 'RuPay', 'Net banking'].map((m) => <li key={m} className="rounded border border-line bg-white px-2 py-1 font-bold text-charcoal-600">{m}</li>)}
          </ul>
          <ul className="flex flex-wrap gap-4">
            <li><Link to="/privacy-policy" className="hover:text-champagne-600">Privacy</Link></li>
            <li><Link to="/terms" className="hover:text-champagne-600">Terms</Link></li>
            <li><Link to="/cookie-preferences" className="hover:text-champagne-600">Cookies</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
