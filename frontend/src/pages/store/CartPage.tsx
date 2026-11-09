import { Gift, X } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { FreeDeliveryMeter, QtyStepper } from '@/components/store/CartDrawer'
import { DeliveryArrangement, Totals } from '@/components/store/OrderSummary'
import { GlassImage } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, ButtonLink, Empty, Field, Input, PageLoader, Price, Select, useToast } from '@/components/ui'
import { useCart } from '@/features/cart/CartContext'
import { useCurrencies, useDestinations } from '@/features/catalog/hooks'
import { errorMessage } from '@/services/api'

export default function CartPage() {
  const { quote, loading, setQty, remove, applyCoupon, country, setDestination, currency, setCurrency } = useCart()
  const { data: dests } = useDestinations()
  const { data: currencies } = useCurrencies()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (loading) return <PageLoader />
  const lines = quote?.lines ?? []

  const submitCoupon = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try { await applyCoupon(code.trim() || null) } catch (err) { toast(errorMessage(err), 'bad') } finally { setBusy(false) }
  }

  return (
    <div className="container-luxe py-12 md:py-16">
      <Seo title="Your bag" noindex />
      <h1 className="mb-10 font-display text-5xl">Your bag</h1>
      {lines.length === 0 ? (
        <Empty title="Your bag is empty" action={<ButtonLink to="/shop">Explore the collection</ButtonLink>}>Pieces you add will appear here.</Empty>
      ) : quote && (
        <div className="grid gap-12 lg:grid-cols-[1fr_400px]">
          <div>
            <div className="mb-6"><FreeDeliveryMeter quote={quote} /></div>
            <ul className="divide-y divide-line border-y border-line">
              {lines.map((l) => (
                <li key={`${l.variant_id}-${l.gift_wrap}`} className="grid grid-cols-[96px_1fr] gap-5 py-6 md:grid-cols-[120px_1fr_auto]">
                  <Link to={`/products/${l.product_slug}`}><GlassImage src={l.image_url} alt={l.product_name} className="aspect-[4/5] w-full object-cover" /></Link>
                  <div className="space-y-1.5">
                    <Link to={`/products/${l.product_slug}`} className="font-display text-2xl leading-tight">{l.product_name}</Link>
                    {l.variant_name && <p className="text-sm text-charcoal-500">{l.variant_name}</p>}
                    <Price value={l.unit_price} compareAt={l.compare_at_price} size="sm" />
                    {l.gift_wrap && <p className="flex items-center gap-1 text-xs text-champagne-600"><Gift className="h-3 w-3" /> Gift packaging (+{l.gift_wrap_amount})</p>}
                    {l.issue && <p className="text-sm text-red-700">{l.issue}</p>}
                    <div className="flex items-center gap-4 pt-3">
                      <QtyStepper value={l.quantity} max={Math.max(l.quantity, Math.min(99, l.available))}
                        onChange={(n) => setQty(l.variant_id, l.gift_wrap, n).catch((e) => toast(errorMessage(e), 'bad'))} />
                      <button onClick={() => remove(l.variant_id, l.gift_wrap)} className="flex items-center gap-1 text-xs uppercase tracking-[0.14em] text-charcoal-500 hover:text-charcoal"><X className="h-3 w-3" /> Remove</button>
                    </div>
                  </div>
                  <p className="col-start-2 text-right md:col-start-3">{l.line_subtotal && <Price value={l.line_subtotal} />}</p>
                </li>
              ))}
            </ul>
          </div>
          <aside className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <div className="space-y-5 border border-line bg-white/70 p-6">
              <h2 className="text-[12px] uppercase tracking-luxe">Summary</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Deliver to" htmlFor="dest">
                  <Select id="dest" value={country} onChange={(e) => setDestination(e.target.value)}>
                    {dests?.map((d) => <option key={d.country_code} value={d.country_code} disabled={!d.enabled}>{d.country_name}{!d.enabled ? ' (unavailable)' : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Show prices in" htmlFor="cur">
                  <Select id="cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {(currencies ?? [{ code: 'INR' }]).map((c) => <option key={c.code}>{c.code}</option>)}
                  </Select>
                </Field>
              </div>
              <form onSubmit={submitCoupon} className="flex items-end gap-2">
                <Field label="Promo code" htmlFor="coupon"><Input id="coupon" value={code} onChange={(e) => setCode(e.target.value)} placeholder={quote.coupon?.code ?? ''} /></Field>
                <Button type="submit" variant="secondary" loading={busy}>Apply</Button>
              </form>
              {quote.coupon && (quote.coupon.valid
                ? <p className="text-xs text-emerald-800">{quote.coupon.code} applied{quote.coupon.message ? ` — ${quote.coupon.message}` : ''}. <button className="underline" onClick={() => applyCoupon(null)}>Remove</button></p>
                : <p className="text-xs text-red-700">{quote.coupon.message}</p>)}
              <Totals quote={quote} />
            </div>
            <DeliveryArrangement quote={quote} />
            {quote.blocking_issues.length > 0 && (
              <Alert tone="warn" title="Before you check out">
                <ul className="list-disc pl-4">{quote.blocking_issues.map((b) => <li key={b}>{b}</li>)}</ul>
              </Alert>
            )}
            <ButtonLink to="/checkout" className={`w-full ${!quote.can_checkout ? 'pointer-events-none opacity-50' : ''}`}>Proceed to checkout</ButtonLink>
            <p className="text-center text-xs text-charcoal-500">Secure online payment · Cash on delivery not available for products</p>
          </aside>
        </div>
      )}
    </div>
  )
}
