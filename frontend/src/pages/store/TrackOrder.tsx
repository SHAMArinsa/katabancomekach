import { useMutation } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, Field, Input, StatusBadge } from '@/components/ui'
import { api, errorMessage } from '@/services/api'
import type { Shipment } from '@/types'
import { formatDate } from '@/utils/format'

interface Tracking {
  order_number: string; created_at: string; payment_status: string; fulfillment_status: string
  shipping_fee_status: string; free_delivery: boolean; shipments: Shipment[]
}

export function ShipmentTimeline({ shipments }: { shipments: Shipment[] }) {
  if (!shipments.length) return <p className="text-sm text-charcoal-500">Your order has not been dispatched yet. Tracking appears here once it leaves us.</p>
  return (
    <div className="space-y-8">
      {shipments.map((s) => (
        <div key={s.id}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{s.courier_name}</span>
            {s.tracking_number && <span className="text-charcoal-500">#{s.tracking_number}</span>}
            <StatusBadge status={s.status} />
            {s.is_test && <span className="text-xs text-champagne-600">(test shipment)</span>}
            {s.tracking_url && s.tracking_url.startsWith('http') && <a href={s.tracking_url} target="_blank" rel="noopener noreferrer" className="text-xs underline">Courier tracking ↗</a>}
          </div>
          <ol className="mt-5 space-y-4 border-l border-line pl-6">
            {[...s.events].reverse().map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[29px] top-1.5 h-2 w-2 rounded-full bg-champagne" />
                <p className="text-sm">{e.description}</p>
                <p className="text-xs text-charcoal-500">{formatDate(e.occurred_at, true)}{e.location ? ` · ${e.location}` : ''}</p>
              </li>
            ))}
            {s.shipped_at && <li className="relative"><span className="absolute -left-[29px] top-1.5 h-2 w-2 rounded-full bg-charcoal-400" /><p className="text-sm">Dispatched</p><p className="text-xs text-charcoal-500">{formatDate(s.shipped_at, true)}</p></li>}
          </ol>
        </div>
      ))}
    </div>
  )
}

export default function TrackOrder() {
  const [sp] = useSearchParams()
  const [num, setNum] = useState(sp.get('order') ?? '')
  const [email, setEmail] = useState('')
  const m = useMutation({ mutationFn: () => api.get<Tracking>('/public/track', { order_number: num.trim(), email: email.trim() }) })
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 md:py-24">
      <Seo title="Track your order" />
      <p className="eyebrow">Order tracking</p>
      <h1 className="mt-2 font-display text-5xl">Track your order</h1>
      <form onSubmit={submit} className="mt-10 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="Order number" htmlFor="t-num"><Input id="t-num" required value={num} onChange={(e) => setNum(e.target.value)} placeholder="GL…" /></Field>
        <Field label="Email used for the order" htmlFor="t-email"><Input id="t-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Button type="submit" loading={m.isPending}>Track</Button>
      </form>
      {m.isError && <Alert tone="bad" className="mt-6">{errorMessage(m.error)}</Alert>}
      {m.data && (
        <div className="mt-10 space-y-6 border border-line bg-white/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-2xl">Order {m.data.order_number}</p>
            <p className="text-xs text-charcoal-500">Placed {formatDate(m.data.created_at)}</p>
          </div>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div><dt className="text-[11px] uppercase tracking-luxe text-charcoal-500">Payment</dt><dd className="mt-1"><StatusBadge status={m.data.payment_status} /></dd></div>
            <div><dt className="text-[11px] uppercase tracking-luxe text-charcoal-500">Order</dt><dd className="mt-1"><StatusBadge status={m.data.fulfillment_status} /></dd></div>
            <div><dt className="text-[11px] uppercase tracking-luxe text-charcoal-500">Shipping fee</dt><dd className="mt-1"><StatusBadge status={m.data.shipping_fee_status} label={m.data.free_delivery ? 'Free delivery' : undefined} /></dd></div>
          </dl>
          <ShipmentTimeline shipments={m.data.shipments} />
        </div>
      )}
    </div>
  )
}
