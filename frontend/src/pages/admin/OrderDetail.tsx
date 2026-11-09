import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Json } from '@/components/admin/kit'
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageLoader, Select, StatusBadge, Table, Td, Textarea, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { ShipmentTimeline } from '@/pages/store/TrackOrder'
import { adminApi, errorMessage } from '@/services/api'
import type { Order } from '@/types'
import { COUNTRY_NAMES, formatDate, formatINR, humanize } from '@/utils/format'

interface AdminOrder extends Order {
  email: string
  customer_note: string | null
  requires_attention: boolean
  attention_reason: string | null
  payments: { id: number; provider: string; provider_order_id: string; provider_payment_id: string | null; method: string; amount: string; currency: string; status: string; is_test: boolean; verified_at: string | null; failure_reason: string | null; created_at: string }[]
  refunds: { id: number; amount: string; reason: string; status: string; created_at: string }[]
  refunded_total: string
  shipping_fee_collection: { status: string; estimated_amount: string | null; collected_amount: string | null; notes: string | null; courier_reference: string | null } | null
  history: { field: string; from: string | null; to: string; note: string | null; at: string }[]
  courier_options: { provider_id: number; name: string; problems: string[] }[]
  customer: { id: number; email: string }
}

const NEXT: Record<string, string[]> = {
  unfulfilled: ['processing'], processing: ['packed'], packed: ['dispatched', 'processing'], dispatched: ['delivered', 'returned'], delivered: ['returned'],
}
const FEE_NEXT: Record<string, string[]> = {
  pending_collection: ['collected', 'collection_failed', 'waived', 'disputed'], collection_failed: ['collected', 'waived', 'disputed', 'pending_collection'],
  disputed: ['collected', 'waived', 'collection_failed'], collected: ['disputed'],
}

export default function OrderDetail() {
  const { orderNumber } = useParams()
  const { can } = useAdmin()
  const toast = useToast()
  const qc = useQueryClient()
  const key = ['admin', 'order', orderNumber]
  const { data: o, isLoading } = useQuery({ queryKey: key, queryFn: () => adminApi.get<AdminOrder>(`/admin/orders/${orderNumber}`) })
  const [dialog, setDialog] = useState<null | 'ship' | 'cancel' | 'refund' | 'fee' | 'event' | 'attention'>(null)
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => adminApi.post<AdminOrder>(`/admin/orders/${orderNumber}${path}`, body),
    onSuccess: (d) => { qc.setQueryData(key, d); setDialog(null); toast('Order updated') },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
  if (isLoading || !o) return <PageLoader />
  const ship = o.shipments.find((s) => s.kind === 'outbound')
  const paid = o.payment_status === 'paid'
  const a = o.shipping_address

  return (
    <AdminPage title={`Order ${o.order_number}`} subtitle={<>Placed {formatDate(o.created_at, true)} · <Link to={`/admin/customers/${o.customer.id}`} className="underline">{o.email}</Link>{o.is_test && <Badge tone="gold" className="ml-2">Test order</Badge>}</>}
      actions={<>
        {can('orders.write') && (NEXT[o.fulfillment_status] ?? []).map((s) => (
          <Button key={s} size="sm" variant={s === 'processing' && o.fulfillment_status === 'packed' ? 'ghost' : 'primary'}
            disabled={(s === 'dispatched' && (!paid || !ship))} title={s === 'dispatched' && !paid ? 'Payment must be verified first' : s === 'dispatched' && !ship ? 'Create a shipment first' : undefined}
            onClick={() => act.mutate({ path: '/fulfillment', body: { status: s } })}>Mark {humanize(s).toLowerCase()}</Button>
        ))}
        {can('orders.write') && paid && ['processing', 'packed'].includes(o.fulfillment_status) && !ship && <Button size="sm" variant="secondary" onClick={() => setDialog('ship')}>Create shipment</Button>}
        {can('orders.cancel') && ['unfulfilled', 'processing', 'packed'].includes(o.fulfillment_status) && <Button size="sm" variant="danger" onClick={() => setDialog('cancel')}>Cancel</Button>}
        {can('payments.refund') && ['paid', 'partially_refunded'].includes(o.payment_status) && <Button size="sm" variant="secondary" onClick={() => setDialog('refund')}>Refund</Button>}
      </>}>
      {o.requires_attention && (
        <Alert tone="warn" title="Needs attention">{o.attention_reason} {can('orders.write') && <button className="ml-2 underline" onClick={() => setDialog('attention')}>Mark resolved</button>}</Alert>
      )}
      {!paid && o.fulfillment_status !== 'cancelled' && <Alert tone="info">Dispatch is locked until the product payment is verified by the payment provider.</Alert>}

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard title="Product payment" status={o.payment_status}>{formatINR(o.total)} · {o.payment_method}{Number(o.refunded_total) > 0 && ` · refunded ${formatINR(o.refunded_total)}`}</StatusCard>
        <StatusCard title="Fulfilment" status={o.fulfillment_status}>{o.dispatched_at ? `Dispatched ${formatDate(o.dispatched_at)}` : 'Not dispatched'}</StatusCard>
        <StatusCard title="Shipping fee collection" status={o.shipping_fee_status}
          action={can('orders.write') && FEE_NEXT[o.shipping_fee_status] && <button className="text-xs underline" onClick={() => setDialog('fee')}>Update</button>}>
          {o.free_delivery ? 'Free delivery (store pays)' : `Recipient pays courier · est. ${formatINR(o.estimated_shipping_fee)}`}
          {o.shipping_fee_collection?.collected_amount && ` · collected ${formatINR(o.shipping_fee_collection.collected_amount)}`}
        </StatusCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card title="Items">
          <Table head={['Product', 'SKU', 'Qty', 'Unit', 'Discount', 'Tax', 'Total']}>
            {o.items.map((i) => (
              <tr key={i.id}>
                <Td>{i.product_name}{i.variant_name && <span className="text-charcoal-500"> · {i.variant_name}</span>}{i.gift_wrap && <Badge tone="gold" className="ml-2">Gift</Badge>}{i.returned_quantity > 0 && <span className="ml-2 text-xs text-charcoal-500">({i.returned_quantity} returned)</span>}</Td>
                <Td className="text-xs">{i.sku}</Td><Td>{i.quantity}</Td><Td>{formatINR(i.unit_price)}</Td><Td>{formatINR(i.discount)}</Td>
                <Td>{formatINR(i.tax)} <span className="text-xs text-charcoal-500">({Number(i.tax_rate)}%)</span></Td><Td>{formatINR(i.line_total)}</Td>
              </tr>
            ))}
          </Table>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <Row k="Subtotal" v={formatINR(o.subtotal)} />
            <Row k={`Discount ${o.coupon_code ? `(${o.coupon_code})` : ''}`} v={`− ${formatINR(o.discount)}`} />
            <Row k="Gift packaging" v={formatINR(o.gift_wrap)} />
            <Row k={`Tax${o.prices_include_tax ? ' (incl.)' : ''}`} v={formatINR(o.tax)} />
            <Row k="Charged online" v={<strong>{formatINR(o.total)}</strong>} />
            <Row k="Eligible subtotal / threshold" v={`${formatINR(o.eligible_subtotal)} / ${formatINR(o.free_delivery_threshold)}`} />
          </dl>
        </Card>
        <div className="space-y-4">
          <Card title="Ship to">
            {a && <address className="text-sm not-italic leading-relaxed">{a.full_name}<br />{a.line1}{a.line2 && <>, {a.line2}</>}<br />{a.city}{a.state && `, ${a.state}`} {a.postal_code}<br />{COUNTRY_NAMES[a.country_code] ?? a.country_code}{o.is_international && <Badge tone="info" className="ml-2">International</Badge>}<br />{a.phone}</address>}
            {o.customer_note && <p className="mt-3 border-t border-line pt-3 text-sm"><strong className="font-medium">Note:</strong> {o.customer_note}</p>}
          </Card>
          <Card title="Shipment" actions={ship && can('orders.write') && ['dispatched'].includes(o.fulfillment_status) && <button className="text-xs underline" onClick={() => setDialog('event')}>Add tracking event</button>}>
            {ship ? <ShipmentTimeline shipments={o.shipments} /> : <p className="text-sm text-charcoal-500">No shipment yet.</p>}
            {ship?.customs_data && <details className="mt-3 text-xs"><summary className="cursor-pointer">Customs / commercial invoice data</summary><Json value={ship.customs_data} /></details>}
          </Card>
        </div>
      </div>

      <Card title="Payments (read-only)">
        <Table head={['Provider', 'Reference', 'Method', 'Amount', 'Status', 'Verified', 'Notes']} empty={!o.payments.length}>
          {o.payments.map((p) => (
            <tr key={p.id}>
              <Td>{p.provider}{p.is_test && <Badge tone="gold" className="ml-1">TEST</Badge>}</Td>
              <Td className="text-xs">{p.provider_payment_id ?? p.provider_order_id}</Td><Td>{p.method}</Td><Td>{formatINR(p.amount)} {p.currency}</Td>
              <Td><StatusBadge status={p.status} /></Td><Td>{formatDate(p.verified_at, true)}</Td><Td className="text-xs text-red-800">{p.failure_reason}</Td>
            </tr>
          ))}
        </Table>
        {o.refunds.length > 0 && (
          <div className="mt-4"><p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-charcoal-500">Refunds</p>
            <Table head={['Date', 'Amount', 'Reason', 'Status']}>{o.refunds.map((r) => <tr key={r.id}><Td>{formatDate(r.created_at, true)}</Td><Td>{formatINR(r.amount)}</Td><Td>{r.reason}</Td><Td><StatusBadge status={r.status} /></Td></tr>)}</Table></div>
        )}
      </Card>

      <Card title="Status history">
        <ol className="space-y-2 text-sm">
          {o.history.map((h, i) => <li key={i} className="flex flex-wrap gap-2"><span className="text-charcoal-500">{formatDate(h.at, true)}</span><span>{humanize(h.field)}:</span><span>{h.from ? humanize(h.from) : '—'} → <strong className="font-medium">{humanize(h.to)}</strong></span>{h.note && <span className="text-charcoal-500">· {h.note}</span>}</li>)}
        </ol>
      </Card>

      {dialog === 'ship' && <ShipDialog order={o} busy={act.isPending} onClose={() => setDialog(null)} onSubmit={(b) => act.mutate({ path: '/shipments', body: b })} />}
      {dialog === 'cancel' && <ReasonDialog title="Cancel order" danger busy={act.isPending} onClose={() => setDialog(null)}
        intro={paid ? 'The customer will be refunded in full and stock restored.' : 'The stock reservation will be released.'}
        onSubmit={(reason) => act.mutate({ path: '/cancel', body: { reason } })} />}
      {dialog === 'attention' && <ReasonDialog title="Resolve attention flag" busy={act.isPending} onClose={() => setDialog(null)} intro={o.attention_reason ?? ''} onSubmit={(reason) => act.mutate({ path: '/resolve-attention', body: { reason } })} />}
      {dialog === 'refund' && <RefundDialog max={(Number(o.total) - Number(o.refunded_total)).toFixed(2)} busy={act.isPending} onClose={() => setDialog(null)} onSubmit={(b) => act.mutate({ path: '/refunds', body: b })} />}
      {dialog === 'fee' && <FeeDialog current={o.shipping_fee_status} busy={act.isPending} onClose={() => setDialog(null)} onSubmit={(b) => act.mutate({ path: '/shipping-fee', body: b })} />}
      {dialog === 'event' && ship && <EventDialog busy={act.isPending} onClose={() => setDialog(null)} onSubmit={(b) => act.mutate({ path: `/shipments/${ship.id}/events`, body: b })} />}
    </AdminPage>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) { return <div className="flex justify-between gap-4"><dt className="text-charcoal-600">{k}</dt><dd>{v}</dd></div> }

function StatusCard({ title, status, children, action }: { title: string; status: string; children: ReactNode; action?: ReactNode }) {
  return <Card title={title} actions={action}><StatusBadge status={status} /><p className="mt-2 text-sm text-charcoal-600">{children}</p></Card>
}

function ShipDialog({ order, onClose, onSubmit, busy }: { order: AdminOrder; onClose: () => void; onSubmit: (b: unknown) => void; busy: boolean }) {
  const ok = order.courier_options.filter((c) => c.problems.length === 0)
  const [provider, setProvider] = useState(ok[0]?.provider_id ?? order.courier_options[0]?.provider_id)
  const [tracking, setTracking] = useState('')
  const [insured, setInsured] = useState(false)
  const [notes, setNotes] = useState('')
  const sel = order.courier_options.find((c) => c.provider_id === Number(provider))
  return (
    <Dialog open onClose={onClose} title="Create shipment" footer={<><Button variant="ghost" onClick={onClose}>Close</Button>
      <Button loading={busy} disabled={!sel || sel.problems.length > 0} onClick={() => onSubmit({ provider_id: Number(provider), tracking_number: tracking || undefined, insured, packaging_notes: notes || undefined })}>Create shipment</Button></>}>
      <div className="space-y-4">
        <Field label="Courier"><Select value={provider} onChange={(e) => setProvider(Number(e.target.value))}>
          {order.courier_options.map((c) => <option key={c.provider_id} value={c.provider_id}>{c.name}{c.problems.length ? ' — incompatible' : ''}</option>)}
        </Select></Field>
        {sel && sel.problems.length > 0 && <Alert tone="bad" title="Unsupported courier arrangement"><ul className="list-disc pl-4">{sel.problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>}
        <Field label="Tracking number" hint="Leave blank for couriers with an API (the mock courier generates one)."><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>
        <Field label="Packaging notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        <Checkbox label="Insured shipment" checked={insured} onChange={(e) => setInsured(e.target.checked)} />
        {!order.free_delivery && <p className="flex gap-2 text-xs text-charcoal-600"><AlertTriangle className="h-4 w-4 text-champagne" />Shipping fee is collected from the recipient by the courier — confirm the courier collects it on this parcel.</p>}
      </div>
    </Dialog>
  )
}

function ReasonDialog({ title, intro, onClose, onSubmit, busy, danger }: { title: string; intro: string; onClose: () => void; onSubmit: (r: string) => void; busy: boolean; danger?: boolean }) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open onClose={onClose} title={title} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={reason.length < 3} onClick={() => onSubmit(reason)}>Confirm</Button></>}>
      <p className="mb-4 text-sm text-charcoal-700">{intro}</p>
      <Field label="Reason (recorded in the audit log)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  )
}

function RefundDialog({ max, onClose, onSubmit, busy }: { max: string; onClose: () => void; onSubmit: (b: unknown) => void; busy: boolean }) {
  const [amount, setAmount] = useState(max)
  const [reason, setReason] = useState('')
  const [key] = useState(() => `manual-${Date.now()}`)
  return (
    <Dialog open onClose={onClose} title="Issue refund" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} disabled={reason.length < 3 || Number(amount) <= 0 || Number(amount) > Number(max)} onClick={() => onSubmit({ amount, reason, idempotency_key: key })}>Refund {formatINR(amount)}</Button></>}>
      <div className="space-y-4">
        <Field label={`Amount (max ${formatINR(max)})`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-charcoal-500">Refunds go back to the original payment method through the payment provider.</p>
      </div>
    </Dialog>
  )
}

function FeeDialog({ current, onClose, onSubmit, busy }: { current: string; onClose: () => void; onSubmit: (b: unknown) => void; busy: boolean }) {
  const opts = FEE_NEXT[current] ?? []
  const [status, setStatus] = useState(opts[0])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  return (
    <Dialog open onClose={onClose} title="Shipping fee collection" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} onClick={() => onSubmit({ status, collected_amount: amount || undefined, note: note || undefined })}>Save</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-charcoal-600">Tracked independently of the product payment.</p>
        <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{opts.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
        {status === 'collected' && <Field label="Amount collected by courier (₹)"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></Field>
      </div>
    </Dialog>
  )
}

function EventDialog({ onClose, onSubmit, busy }: { onClose: () => void; onSubmit: (b: unknown) => void; busy: boolean }) {
  const [status, setStatus] = useState('in_transit')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  return (
    <Dialog open onClose={onClose} title="Add tracking event" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} onClick={() => onSubmit({ status, location: location || undefined, description: description || undefined })}>Add</Button></>}>
      <div className="space-y-4">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{['in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned', 'lost'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
        <Field label="Location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        <Field label="Description (optional)"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <p className="text-xs text-charcoal-500">“Delivered” also marks the order delivered. “Exception” and “Lost” flag the order for attention.</p>
      </div>
    </Dialog>
  )
}
