import { useMutation, useQuery } from '@tanstack/react-query'
import { CreditCard, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AddressForm } from '@/components/store/AddressForm'
import { DeliveryArrangement, SummaryLines, Totals } from '@/components/store/OrderSummary'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, ButtonLink, Checkbox, Empty, PageLoader, useToast } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { useCart } from '@/features/cart/CartContext'
import { useSettings } from '@/features/catalog/hooks'
import type { AddressValues } from '@/schemas/forms'
import { api, ApiError, errorMessage } from '@/services/api'
import type { Address, Order, Quote } from '@/types'
import { COUNTRY_NAMES, cx } from '@/utils/format'

export default function Checkout() {
  const { user } = useAuth()
  const { data: settings } = useSettings()
  const { currency, refetch } = useCart()
  const nav = useNavigate()
  const toast = useToast()
  const addresses = useQuery({ queryKey: ['account', 'addresses'], queryFn: () => api.get<Address[]>('/customer/addresses') })
  const [addressId, setAddressId] = useState<number | 'new' | null>(null)
  const [draftDest, setDraftDest] = useState<{ country_code?: string; postal_code?: string }>({ country_code: 'IN' })
  const [terms, setTerms] = useState(false)
  const [customs, setCustoms] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (addressId === null && addresses.data) {
      const def = addresses.data.find((a) => a.is_default) ?? addresses.data[0]
      setAddressId(def?.id ?? 'new')
    }
  }, [addresses.data, addressId])

  const selected = typeof addressId === 'number' ? addresses.data?.find((a) => a.id === addressId) : undefined
  const dest = selected ? { country_code: selected.country_code, postal_code: selected.postal_code } : draftDest

  const quoteQ = useQuery({
    queryKey: ['checkout-quote', dest.country_code, dest.postal_code, currency],
    enabled: !!dest.country_code,
    queryFn: () => api.post<Quote>('/customer/checkout/quote', { country_code: dest.country_code, postal_code: dest.postal_code || undefined, display_currency: currency }),
    placeholderData: (p) => p,
  })
  const quote = quoteQ.data
  const intl = !!quote?.destination.is_international

  const place = useMutation({
    mutationFn: (address?: AddressValues) => api.post<Order>('/customer/checkout/orders', {
      address_id: typeof addressId === 'number' ? addressId : undefined,
      address: address ? { ...address, label: address.label || 'Home', is_default: false } : undefined,
      display_currency: currency, note: note || undefined, payment_method: 'online',
      accept_shipping_terms: terms, accept_customs_terms: customs,
    }),
    onSuccess: (o) => { refetch(); nav(`/checkout/pay/${o.order_number}`) },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })

  if (quoteQ.isLoading || addresses.isLoading) return <PageLoader />
  if (quote && quote.lines.length === 0) return <div className="container-luxe py-24"><Empty title="Your bag is empty" action={<ButtonLink to="/shop">Continue shopping</ButtonLink>} /></div>

  const unverified = settings?.account.require_email_verification && !user?.email_verified
  const canPlace = !!quote?.can_checkout && terms && (!intl || customs) && !unverified

  const confirmBlock = quote && (
    <div className="space-y-5">
      <DeliveryArrangement quote={quote} />
      <div className="space-y-3 border border-line bg-white/70 p-5">
        <h3 className="flex items-center gap-2 text-[12px] uppercase tracking-luxe"><CreditCard className="h-4 w-4 text-champagne" /> Payment</h3>
        <label className="flex items-center gap-3 border border-charcoal px-4 py-3 text-sm">
          <input type="radio" checked readOnly className="accent-charcoal" aria-label="Pay online" />
          <span>Pay online — {settings?.payment.methods.map((m) => m.toUpperCase()).join(' · ')}</span>
        </label>
        <p className="text-xs text-charcoal-500">{settings?.payment.instructions || 'Cash on delivery is not available for products.'}</p>
      </div>
      <div className="space-y-3">
        <Checkbox checked={terms} onChange={(e) => setTerms(e.target.checked)}
          label={<span>I understand that the product amount is paid online now{quote.shipping.free_delivery ? ' and delivery is complimentary.' : ', and the courier’s shipping charge will be collected from the recipient at delivery.'} I agree to the <Link to="/terms" className="underline">terms</Link> and <Link to="/shipping-policy" className="underline">shipping policy</Link>.</span>} />
        {intl && <Checkbox checked={customs} onChange={(e) => setCustoms(e.target.checked)}
          label="I understand that import duties, taxes and customs fees may be charged by the destination country and are payable by the recipient." />}
      </div>
      <label className="block text-sm">
        <span className="text-[11px] uppercase tracking-luxe text-charcoal-600">Order note (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="mt-1.5 w-full border border-line bg-white/70 p-3 text-sm focus:border-champagne focus:outline-none" />
      </label>
    </div>
  )

  return (
    <div className="container-luxe py-12 md:py-16">
      <Seo title="Checkout" noindex />
      <ol className="mb-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em]" aria-label="Checkout progress">
        {['Bag', 'Details', 'Payment', 'Done'].map((step, i) => (
          <li key={step} className={`flex items-center gap-2 ${i === 1 ? 'text-charcoal' : 'text-charcoal-400'}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${i < 1 ? 'border-champagne bg-champagne text-ivory' : i === 1 ? 'border-charcoal' : 'border-charcoal-300'}`}>{i < 1 ? '✓' : i + 1}</span>
            {i === 0 ? <Link to="/cart" className="hover:underline">{step}</Link> : step}
            {i < 3 && <span className="hidden h-px w-8 bg-charcoal-300 sm:block" aria-hidden />}
          </li>
        ))}
      </ol>
      <h1 className="mb-2 font-display text-5xl">Checkout</h1>
      <p className="mb-10 flex items-center gap-2 text-xs text-charcoal-500"><Lock className="h-3 w-3" /> Secure checkout · amounts confirmed by our server</p>
      {unverified && <Alert tone="warn" className="mb-6" title="Please verify your email">We have sent a verification link to {user?.email}. <Link to="/verify-email" className="underline">Resend or enter it here</Link>.</Alert>}
      <div className="grid gap-12 lg:grid-cols-[1fr_420px]">
        <div className="space-y-10">
          <section>
            <h2 className="mb-5 text-[12px] uppercase tracking-luxe">1 · Delivery address</h2>
            {!!addresses.data?.length && (
              <div className="mb-5 grid gap-3 md:grid-cols-2">
                {addresses.data.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAddressId(a.id!)} aria-pressed={addressId === a.id}
                    className={cx('border p-4 text-left text-sm transition', addressId === a.id ? 'border-charcoal bg-white' : 'border-line hover:border-charcoal-400')}>
                    <p className="font-medium">{a.full_name} <span className="text-xs font-normal text-charcoal-500">· {a.label}</span></p>
                    <p className="text-charcoal-600">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.postal_code}</p>
                    <p className="text-charcoal-600">{COUNTRY_NAMES[a.country_code] ?? a.country_code}</p>
                  </button>
                ))}
                <button type="button" onClick={() => setAddressId('new')} aria-pressed={addressId === 'new'}
                  className={cx('border border-dashed p-4 text-left text-sm', addressId === 'new' ? 'border-charcoal' : 'border-line')}>+ Use a new address</button>
              </div>
            )}
            {addressId === 'new' && (
              <div className="border border-line bg-white/60 p-5">
                <AddressForm showDefault={false} onChange={setDraftDest} submitLabel="Place order & pay" busy={place.isPending}
                  onSubmit={(v) => { if (canPlace) place.mutate(v); else toast('Please review the delivery terms and any notes in the summary.', 'bad') }}>
                  <div className="pt-4">{confirmBlock}</div>
                </AddressForm>
              </div>
            )}
          </section>
          {addressId !== 'new' && (
            <section>
              <h2 className="mb-5 text-[12px] uppercase tracking-luxe">2 · Review & pay</h2>
              {confirmBlock}
              <Button size="lg" className="mt-6 w-full md:w-auto" disabled={!canPlace} loading={place.isPending} onClick={() => place.mutate(undefined)}>Place order & pay</Button>
            </section>
          )}
          {place.error instanceof ApiError && place.error.detailList.length > 0 && (
            <Alert tone="bad" title={place.error.message}><ul className="list-disc pl-4">{place.error.detailList.map((d) => <li key={d}>{d}</li>)}</ul></Alert>
          )}
        </div>
        {quote && (
          <aside className="space-y-5 lg:sticky lg:top-28 lg:self-start">
            <div className="border border-line bg-white/70 p-6">
              <h2 className="mb-3 text-[12px] uppercase tracking-luxe">Order summary</h2>
              <SummaryLines quote={quote} />
              <div className="mt-4 border-t border-line pt-4"><Totals quote={quote} /></div>
            </div>
            {quote.blocking_issues.length > 0 && (
              <Alert tone="warn" title="This order cannot be placed yet"><ul className="list-disc pl-4">{quote.blocking_issues.map((b) => <li key={b}>{b}</li>)}</ul></Alert>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
