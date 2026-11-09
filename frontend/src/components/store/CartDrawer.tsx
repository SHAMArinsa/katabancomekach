import { Gift, Minus, Plus, X } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ButtonLink, Price, useToast } from '@/components/ui'
import { useCart } from '@/features/cart/CartContext'
import { errorMessage } from '@/services/api'
import type { Quote } from '@/types'
import { formatINR } from '@/utils/format'
import { GlassImage } from './ProductCard'

export function FreeDeliveryMeter({ quote }: { quote: Quote }) {
  const s = quote.shipping
  const pct = Math.min(100, (Number(s.eligible_subtotal) / Math.max(1, Number(s.threshold))) * 100)
  return (
    <div className="space-y-2" data-testid="free-delivery-meter">
      <p className="text-xs text-charcoal-700">
        {s.free_delivery
          ? <>You have unlocked <strong className="font-medium">complimentary delivery</strong>{quote.destination.is_international ? ' to your destination' : ''}.</>
          : <>Add <strong className="font-medium">{formatINR(s.amount_to_free_delivery)}</strong> more for complimentary {quote.destination.is_international ? 'international' : ''} delivery.</>}
      </p>
      <div className="h-[3px] w-full bg-ivory-300" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-champagne transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function QtyStepper({ value, max, onChange, disabled }: { value: number; max: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex h-9 items-center border border-line">
      <button type="button" className="px-2.5 disabled:opacity-40" aria-label="Decrease quantity" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}><Minus className="h-3 w-3" /></button>
      <span className="w-8 text-center text-sm" aria-live="polite">{value}</span>
      <button type="button" className="px-2.5 disabled:opacity-40" aria-label="Increase quantity" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Plus className="h-3 w-3" /></button>
    </div>
  )
}

export function CartDrawer() {
  const { drawerOpen, setDrawerOpen, quote, setQty, remove } = useCart()
  const toast = useToast()
  const loc = useLocation()
  useEffect(() => { setDrawerOpen(false) }, [loc.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, setDrawerOpen])
  if (!drawerOpen) return null
  const lines = quote?.lines ?? []
  const change = (vid: number, gift: boolean, q: number) => setQty(vid, gift, q).catch((e) => toast(errorMessage(e), 'bad'))
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-charcoal/40" onClick={() => setDrawerOpen(false)} aria-hidden />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-ivory shadow-2xl animate-fade-up" role="dialog" aria-modal="true" aria-label="Shopping bag">
        <header className="flex items-center justify-between border-b border-line px-6 py-5">
          <h2 className="font-display text-2xl">Your bag</h2>
          <button onClick={() => setDrawerOpen(false)} aria-label="Close bag"><X className="h-5 w-5" /></button>
        </header>
        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
            <p className="font-display text-2xl">Your bag is empty</p>
            <ButtonLink to="/shop" variant="secondary">Explore the collection</ButtonLink>
          </div>
        ) : (
          <>
            {quote && <div className="border-b border-line px-6 py-4"><FreeDeliveryMeter quote={quote} /></div>}
            <ul className="flex-1 divide-y divide-line overflow-y-auto px-6">
              {lines.map((l) => (
                <li key={`${l.variant_id}-${l.gift_wrap}`} className="flex gap-4 py-5">
                  <Link to={`/products/${l.product_slug}`} className="w-20 shrink-0"><GlassImage src={l.image_url} alt={l.product_name} className="aspect-[4/5] w-full object-cover" /></Link>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="flex justify-between gap-2">
                      <Link to={`/products/${l.product_slug}`} className="font-display text-lg leading-tight">{l.product_name}</Link>
                      <button onClick={() => remove(l.variant_id, l.gift_wrap)} className="text-charcoal-400 hover:text-charcoal" aria-label={`Remove ${l.product_name}`}><X className="h-4 w-4" /></button>
                    </div>
                    {l.variant_name && <p className="text-xs text-charcoal-500">{l.variant_name}</p>}
                    {l.gift_wrap && <p className="flex items-center gap-1 text-xs text-champagne-600"><Gift className="h-3 w-3" /> Gift packaging</p>}
                    {l.issue && <p className="text-xs text-red-700">{l.issue}</p>}
                    <div className="mt-auto flex items-center justify-between">
                      <QtyStepper value={l.quantity} max={Math.max(l.quantity, Math.min(99, l.available))} onChange={(n) => change(l.variant_id, l.gift_wrap, n)} />
                      <Price value={l.line_subtotal} size="sm" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <footer className="space-y-4 border-t border-line px-6 py-5">
              <div className="flex justify-between text-sm"><span>Subtotal</span><span>{formatINR(quote?.subtotal)}</span></div>
              <p className="text-xs text-charcoal-500">Taxes {quote?.prices_include_tax ? 'included' : 'calculated at checkout'}. Delivery terms are confirmed at checkout. Cash on delivery is not available for products.</p>
              <ButtonLink to="/cart" variant="secondary" className="w-full">View bag</ButtonLink>
              <ButtonLink to="/checkout" className="w-full">Checkout</ButtonLink>
            </footer>
          </>
        )}
      </aside>
    </div>
  )
}
