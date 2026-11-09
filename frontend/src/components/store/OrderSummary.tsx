import { Info, Truck } from 'lucide-react'
import type { Quote } from '@/types'
import { formatINR, formatMoney } from '@/utils/format'
import { GlassImage } from './ProductCard'

export function DeliveryArrangement({ quote }: { quote: Quote }) {
  const s = quote.shipping
  return (
    <div className="space-y-3 border border-line bg-ivory-200/40 p-4 text-sm" data-testid="delivery-arrangement">
      <p className="flex items-center gap-2 font-medium"><Truck className="h-4 w-4 text-champagne" />
        {s.free_delivery ? 'Complimentary delivery' : 'Shipping paid by the recipient at delivery'}</p>
      <p className="text-charcoal-700">{s.note}</p>
      {!s.free_delivery && (
        <ul className="space-y-1 text-xs text-charcoal-600">
          <li>Shipping charged online now: <strong>{formatINR(0)}</strong></li>
          {s.estimated_fee && <li>Indicative courier charge collected from the recipient: about <strong>{formatINR(s.estimated_fee)}</strong> (final amount set by the courier)</li>}
          <li>Add {formatINR(s.amount_to_free_delivery)} more (eligible subtotal) for complimentary delivery — threshold {formatINR(s.threshold)}.</li>
        </ul>
      )}
      {s.estimated_days && <p className="text-xs text-charcoal-500">Estimated delivery {s.estimated_days[0]}–{s.estimated_days[1]} business days after dispatch{s.provider ? ` via ${s.provider}` : ''}.</p>}
      {s.contains_fragile && <p className="text-xs text-charcoal-500">Contains fragile glass — packed by hand with protective inserts.</p>}
      {s.customs_disclosure && <p className="flex gap-2 border-t border-line pt-3 text-xs text-charcoal-700"><Info className="h-4 w-4 shrink-0 text-champagne" />{s.customs_disclosure}</p>}
    </div>
  )
}

export function Totals({ quote }: { quote: Quote }) {
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between ${strong ? 'border-t border-line pt-3 text-base font-medium' : 'text-sm'}`}><dt>{label}</dt><dd>{value}</dd></div>
  )
  return (
    <dl className="space-y-2.5">
      {row('Subtotal', formatINR(quote.subtotal))}
      {Number(quote.discount) > 0 && row(`Discount${quote.coupon?.code ? ` (${quote.coupon.code})` : ''}`, `− ${formatINR(quote.discount)}`)}
      {Number(quote.gift_wrap) > 0 && row('Gift packaging', formatINR(quote.gift_wrap))}
      {row(quote.prices_include_tax ? 'Taxes (included)' : 'Taxes', formatINR(quote.tax))}
      {row('Shipping charged online', formatINR(0))}
      {row('Pay online now', formatINR(quote.total), true)}
      {quote.display.currency !== 'INR' && (
        <p className="text-xs text-charcoal-500">≈ {formatMoney(quote.display.total, quote.display.currency)}. {quote.display.note}</p>
      )}
    </dl>
  )
}

export function SummaryLines({ quote }: { quote: Quote }) {
  return (
    <ul className="divide-y divide-line">
      {quote.lines.map((l) => (
        <li key={`${l.variant_id}-${l.gift_wrap}`} className="flex gap-3 py-3">
          <div className="relative w-14 shrink-0">
            <GlassImage src={l.image_url} alt={l.product_name} className="aspect-[4/5] w-full object-cover" />
            <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-charcoal text-[10px] text-ivory">{l.quantity}</span>
          </div>
          <div className="flex-1 text-sm">
            <p className="font-display text-lg leading-tight">{l.product_name}</p>
            {l.variant_name && <p className="text-xs text-charcoal-500">{l.variant_name}</p>}
            {l.gift_wrap && <p className="text-xs text-champagne-600">Gift packaging</p>}
            {l.issue && <p className="text-xs text-red-700">{l.issue}</p>}
          </div>
          <p className="text-sm">{formatINR(l.line_subtotal)}</p>
        </li>
      ))}
    </ul>
  )
}
