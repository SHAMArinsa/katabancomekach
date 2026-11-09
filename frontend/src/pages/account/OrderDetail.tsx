import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { GlassImage } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, ButtonLink, Card, ConfirmDialog, Dialog, Field, Input, PageLoader, Select, StatusBadge, Textarea, useToast } from '@/components/ui'
import { ShipmentTimeline } from '@/pages/store/TrackOrder'
import { api, errorMessage } from '@/services/api'
import type { Order } from '@/types'
import { COUNTRY_NAMES, formatDate, formatINR, humanize } from '@/utils/format'

export default function OrderDetail() {
  const { orderNumber } = useParams()
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['account', 'order', orderNumber]
  const { data: o, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<Order>(`/customer/orders/${orderNumber}`) })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [claimOpen, setClaimOpen] = useState(false)
  const [reviewItem, setReviewItem] = useState<{ product_id: number; name: string } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  const cancel = useMutation({
    mutationFn: () => api.post(`/customer/orders/${orderNumber}/cancel`),
    onSuccess: () => { setCancelOpen(false); refresh(); toast('Order cancelled') },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })

  if (isLoading || !o) return <PageLoader />
  const a = o.shipping_address
  return (
    <div className="space-y-8">
      <Seo title={`Order ${o.order_number}`} noindex />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/account/orders" className="text-xs uppercase tracking-luxe text-charcoal-500 hover:text-charcoal">← Orders</Link>
          <h2 className="mt-2 font-display text-3xl">Order {o.order_number}</h2>
          <p className="text-sm text-charcoal-500">Placed {formatDate(o.created_at, true)}{o.is_test && ' · test order'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {o.can_pay && <ButtonLink to={`/checkout/pay/${o.order_number}`}>Complete payment</ButtonLink>}
          {o.can_return && <Button variant="secondary" onClick={() => setReturnOpen(true)}>Request a return</Button>}
          {o.can_claim && <Button variant="secondary" onClick={() => setClaimOpen(true)}>{o.fulfillment_status === 'dispatched' ? 'Report lost parcel' : 'Report damage'}</Button>}
          {o.can_cancel && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Payment"><StatusBadge status={o.payment_status} /><p className="mt-2 text-sm">{formatINR(o.total)} paid online</p></Card>
        <Card title="Order status"><StatusBadge status={o.fulfillment_status} />{o.cancel_reason && <p className="mt-2 text-sm text-charcoal-500">{o.cancel_reason}</p>}</Card>
        <Card title="Shipping fee">
          <StatusBadge status={o.shipping_fee_status} label={o.free_delivery ? 'Complimentary delivery' : undefined} />
          {!o.free_delivery && <p className="mt-2 text-xs text-charcoal-600">Collected by the courier from the recipient{o.estimated_shipping_fee ? ` (approx. ${formatINR(o.estimated_shipping_fee)})` : ''}.</p>}
        </Card>
      </div>

      <Card title="Items">
        <ul className="divide-y divide-line">
          {o.items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 py-3">
              <GlassImage src={i.image_url} alt={i.product_name} className="h-16 w-14 object-cover" />
              <div className="flex-1 text-sm">
                <p className="font-display text-lg">{i.product_name}</p>
                <p className="text-charcoal-500">{i.variant_name && `${i.variant_name} · `}Qty {i.quantity} × {formatINR(i.unit_price)}{i.gift_wrap && ' · gift packaging'}</p>
                {i.returned_quantity > 0 && <p className="text-xs text-charcoal-500">{i.returned_quantity} returned</p>}
              </div>
              <div className="text-right text-sm">
                <p>{formatINR(i.line_total)}</p>
                {o.fulfillment_status === 'delivered' && i.product_id && <button className="mt-1 text-xs underline" onClick={() => setReviewItem({ product_id: i.product_id!, name: i.product_name })}>Write a review</button>}
              </div>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{formatINR(o.subtotal)}</dd></div>
          {Number(o.discount) > 0 && <div className="flex justify-between"><dt>Discount {o.coupon_code && `(${o.coupon_code})`}</dt><dd>− {formatINR(o.discount)}</dd></div>}
          {Number(o.gift_wrap) > 0 && <div className="flex justify-between"><dt>Gift packaging</dt><dd>{formatINR(o.gift_wrap)}</dd></div>}
          <div className="flex justify-between"><dt>Taxes {o.prices_include_tax && '(included)'}</dt><dd>{formatINR(o.tax)}</dd></div>
          <div className="flex justify-between font-medium"><dt>Paid online</dt><dd>{formatINR(o.total)}</dd></div>
        </dl>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Delivery address">
          {a && <address className="text-sm not-italic leading-relaxed">{a.full_name}<br />{a.line1}{a.line2 && <>, {a.line2}</>}<br />{a.city}{a.state && `, ${a.state}`} {a.postal_code}<br />{COUNTRY_NAMES[a.country_code] ?? a.country_code}<br />{a.phone}</address>}
          {o.customs_disclosure && <Alert tone="info" className="mt-4">{o.customs_disclosure}</Alert>}
        </Card>
        <Card title="Tracking"><ShipmentTimeline shipments={o.shipments} /></Card>
      </div>

      {(o.returns?.length || o.claims?.length) ? (
        <Card title="Returns & claims">
          <ul className="space-y-2 text-sm">
            {o.returns?.map((r) => <li key={`r${r.id}`} className="flex justify-between">Return #{r.id} · {r.reason.slice(0, 60)}<StatusBadge status={r.status} /></li>)}
            {o.claims?.map((c) => <li key={`c${c.id}`} className="flex justify-between">{humanize(c.claim_type)} claim #{c.id}<StatusBadge status={c.status} /></li>)}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this order?" danger confirmLabel="Cancel order"
        loading={cancel.isPending} onConfirm={() => cancel.mutate()}
        message={o.payment_status === 'paid' ? 'Your payment will be refunded in full to the original payment method.' : 'No payment has been taken for this order.'} />
      {returnOpen && <ReturnDialog order={o} onClose={() => setReturnOpen(false)} onDone={refresh} />}
      {claimOpen && <ClaimDialog order={o} onClose={() => setClaimOpen(false)} onDone={refresh} />}
      {reviewItem && <ReviewDialog orderNumber={o.order_number} item={reviewItem} onClose={() => setReviewItem(null)} />}
    </div>
  )
}

function ReturnDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [qty, setQty] = useState<Record<number, number>>({})
  const m = useMutation({
    mutationFn: () => api.post(`/customer/orders/${order.order_number}/returns`, {
      reason, items: Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ order_item_id: Number(id), quantity: q })),
    }),
    onSuccess: () => { toast('Return requested'); onDone(); onClose() },
  })
  return (
    <Dialog open onClose={onClose} title="Request a return" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} disabled={reason.length < 5 || !Object.values(qty).some((q) => q > 0)} onClick={() => m.mutate()}>Submit request</Button></>}>
      <div className="space-y-4">
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        {order.items.map((i) => {
          const max = i.quantity - i.returned_quantity
          return (
            <div key={i.id} className="flex items-center justify-between gap-4 text-sm">
              <span>{i.product_name}</span>
              <Select className="w-24" value={qty[i.id] ?? 0} onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })} aria-label={`Quantity of ${i.product_name} to return`}>
                {Array.from({ length: max + 1 }).map((_, n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </div>
          )
        })}
        <Field label="Reason" htmlFor="ret-reason"><Textarea id="ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-charcoal-500">Items must be unused and in their original packaging.</p>
      </div>
    </Dialog>
  )
}

function ClaimDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const lost = order.fulfillment_status === 'dispatched'
  const [desc, setDesc] = useState('')
  const [item, setItem] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const m = useMutation({
    mutationFn: () => {
      const f = new FormData()
      f.set('description', desc)
      f.set('claim_type', lost ? 'lost' : 'damaged')
      if (item) f.set('order_item_id', item)
      Array.from(files ?? []).forEach((file) => f.append('files', file))
      return api.upload(`/customer/orders/${order.order_number}/claims`, f)
    },
    onSuccess: () => { toast('Report submitted — we will be in touch'); onDone(); onClose() },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }
  return (
    <Dialog open onClose={onClose} title={lost ? 'Report a lost parcel' : 'Report damage'}>
      <form onSubmit={submit} className="space-y-4">
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        {!lost && (
          <Field label="Which item?" htmlFor="cl-item">
            <Select id="cl-item" value={item} onChange={(e) => setItem(e.target.value)}>
              <option value="">Whole order</option>{order.items.map((i) => <option key={i.id} value={i.id}>{i.product_name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="What happened?" htmlFor="cl-desc"><Textarea id="cl-desc" required minLength={10} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        {!lost && (
          <Field label="Photos of the item and packaging" htmlFor="cl-files" hint="Up to 6 JPEG, PNG or WebP images. Stored privately.">
            <Input id="cl-files" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => setFiles(e.target.files)} className="h-auto py-2" />
          </Field>
        )}
        <div className="flex justify-end gap-3"><Button type="button" variant="ghost" onClick={onClose}>Close</Button><Button type="submit" loading={m.isPending} disabled={desc.length < 10 || (!lost && !files?.length)}>Submit</Button></div>
      </form>
    </Dialog>
  )
}

function ReviewDialog({ orderNumber, item, onClose }: { orderNumber: string; item: { product_id: number; name: string }; onClose: () => void }) {
  const toast = useToast()
  const [rating, setRating] = useState(5)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const m = useMutation({
    mutationFn: () => api.post<{ message: string }>('/customer/reviews', { order_number: orderNumber, product_id: item.product_id, rating, title, body }),
    onSuccess: (r) => { toast(r.message); onClose() },
  })
  return (
    <Dialog open onClose={onClose} title={`Review ${item.name}`} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Submit review</Button></>}>
      <div className="space-y-4">
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} stars`} onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? 'text-champagne' : 'text-ivory-300'}`}>★</button>)}
        </div>
        <Field label="Title" htmlFor="rv-t"><Input id="rv-t" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></Field>
        <Field label="Your review" htmlFor="rv-b"><Textarea id="rv-b" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
        <p className="text-xs text-charcoal-500">Reviews are published after a quick check.</p>
      </div>
    </Dialog>
  )
}
