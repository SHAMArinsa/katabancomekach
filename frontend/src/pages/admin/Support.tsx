import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tabs } from '@/components/admin/kit'
import { Alert, Button, Checkbox, Dialog, Field, Input, PageLoader, Select, StatusBadge, Table, Td, Textarea, useToast } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { Claim, ReturnReq, Ticket } from '@/types'
import { cx, formatDate, humanize } from '@/utils/format'

const RET_NEXT: Record<string, string[]> = { requested: ['approved', 'rejected'], approved: ['received', 'rejected'], received: ['refunded', 'closed'], refunded: ['closed'], rejected: ['closed'] }
const CLAIM_NEXT = ['under_review', 'approved_refund', 'approved_replacement', 'rejected', 'resolved']

export default function Support() {
  const [tab, setTab] = useState<'returns' | 'claims' | 'tickets'>('returns')
  return (
    <AdminPage title="Returns, claims & support">
      <Tabs tabs={[{ id: 'returns', label: 'Returns & refunds' }, { id: 'claims', label: 'Damage / lost claims' }, { id: 'tickets', label: 'Support tickets' }]} value={tab} onChange={setTab} />
      {tab === 'returns' && <ReturnsTab />}{tab === 'claims' && <ClaimsTab />}{tab === 'tickets' && <TicketsTab />}
    </AdminPage>
  )
}

function ReturnsTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'returns'], queryFn: () => adminApi.get<ReturnReq[]>('/admin/returns') })
  const [sel, setSel] = useState<ReturnReq | null>(null)
  const [status, setStatus] = useState('')
  const [note, setNote] = useState('')
  const [restock, setRestock] = useState(true)
  const [amount, setAmount] = useState('')
  const [tracking, setTracking] = useState('')
  const m = useMutation({
    mutationFn: () => adminApi.post(`/admin/returns/${sel!.id}`, { status, admin_note: note || undefined, restock, refund_amount: amount || undefined, return_tracking_number: tracking || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'returns'] }); setSel(null); toast('Return updated') }, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  if (isLoading) return <PageLoader />
  return (
    <>
      <Table head={['#', 'Order', 'Requested', 'Reason', 'Items', 'Status', '']} empty={!data?.length}>
        {data?.map((r) => (
          <tr key={r.id}><Td>{r.id}</Td><Td><Link to={`/admin/orders/${r.order_number}`} className="underline">{r.order_number}</Link></Td><Td className="text-xs">{formatDate(r.created_at)}</Td>
            <Td className="max-w-xs truncate">{r.reason}</Td><Td>{r.items.reduce((n, i) => n + i.quantity, 0)}</Td><Td><StatusBadge status={r.status} /></Td>
            <Td>{RET_NEXT[r.status] && <button className="text-xs underline" onClick={() => { setSel(r); setStatus(RET_NEXT[r.status][0]); setNote(''); setAmount('') }}>Update</button>}</Td></tr>
        ))}
      </Table>
      {sel && (
        <Dialog open onClose={() => setSel(null)} title={`Return #${sel.id}`} footer={<><Button variant="ghost" onClick={() => setSel(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            <p className="text-sm text-charcoal-700">{sel.reason}</p>
            <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{RET_NEXT[sel.status].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
            {status === 'approved' && <Field label="Return tracking number (optional)"><Input value={tracking} onChange={(e) => setTracking(e.target.value)} /></Field>}
            {status === 'received' && <Checkbox label="Restock returned items" checked={restock} onChange={(e) => setRestock(e.target.checked)} />}
            {status === 'refunded' && <Field label="Refund amount (₹)" hint="Leave blank to refund the returned items’ value"><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
            <Field label="Note to customer"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Dialog>
      )}
    </>
  )
}

function Evidence({ claimId, count }: { claimId: number; count: number }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    const made: string[] = []
    Promise.all(Array.from({ length: count }).map((_, i) => adminApi.blobUrl(`/admin/claims/${claimId}/evidence/${i}`).then((u) => { made.push(u); return u }).catch(() => '')))
      .then((u) => alive && setUrls(u.filter(Boolean)))
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)) }
  }, [claimId, count])
  if (!count) return <p className="text-xs text-charcoal-500">No photos.</p>
  return <div className="grid grid-cols-3 gap-2">{urls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Evidence ${i + 1}`} className="aspect-square w-full border border-line object-cover" /></a>)}</div>
}

function ClaimsTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'claims'], queryFn: () => adminApi.get<Claim[]>('/admin/claims') })
  const [sel, setSel] = useState<Claim | null>(null)
  const [status, setStatus] = useState('under_review')
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const m = useMutation({
    mutationFn: () => adminApi.post(`/admin/claims/${sel!.id}`, { status, resolution_note: note || undefined, refund_amount: amount || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'claims'] }); setSel(null); toast('Claim updated') }, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  if (isLoading) return <PageLoader />
  return (
    <>
      <Table head={['#', 'Order', 'Type', 'Submitted', 'Photos', 'Status', '']} empty={!data?.length}>
        {data?.map((c) => (
          <tr key={c.id}><Td>{c.id}</Td><Td><Link to={`/admin/orders/${c.order_number}`} className="underline">{c.order_number}</Link></Td><Td>{humanize(c.claim_type)}</Td>
            <Td className="text-xs">{formatDate(c.created_at)}</Td><Td>{c.evidence_count}</Td><Td><StatusBadge status={c.status} /></Td>
            <Td><button className="text-xs underline" onClick={() => { setSel(c); setStatus('under_review'); setNote(c.resolution_note ?? '') }}>Review</button></Td></tr>
        ))}
      </Table>
      {sel && (
        <Dialog open wide onClose={() => setSel(null)} title={`Claim #${sel.id} · ${humanize(sel.claim_type)}`}
          footer={!['rejected', 'resolved'].includes(sel.status) && <><Button variant="ghost" onClick={() => setSel(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save decision</Button></>}>
          <div className="space-y-4">
            <p className="text-sm">{sel.description}</p>
            <Evidence claimId={sel.id} count={sel.evidence_count} />
            <p className="text-xs text-charcoal-500">Evidence is private and every view is audit-logged.</p>
            {['rejected', 'resolved'].includes(sel.status) ? <Alert tone="info">This claim is closed.</Alert> : (
              <>
                <Field label="Decision"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{CLAIM_NEXT.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
                {status === 'approved_refund' && <Field label="Refund amount (₹)" hint="Leave blank to refund the affected line"><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
                {status === 'approved_replacement' && <Alert tone="info">The order will be flagged so a replacement shipment can be arranged.</Alert>}
                <Field label="Resolution note"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}

function TicketsTab() {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState('open')
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'tickets', status], queryFn: () => adminApi.get<Ticket[]>('/admin/tickets', { status: status || undefined }) })
  const [sel, setSel] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const m = useMutation({
    mutationFn: (body: { reply?: string; status?: string }) => adminApi.post<Ticket>(`/admin/tickets/${sel!.id}`, body),
    onSuccess: (t) => { setSel(t); setReply(''); qc.invalidateQueries({ queryKey: ['admin', 'tickets'] }) }, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  return (
    <>
      <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48" aria-label="Status"><option value="">All</option>{['open', 'pending_customer', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
      {isLoading ? <PageLoader /> : (
        <Table head={['#', 'Subject', 'From', 'Order', 'Updated', 'Status', '']} empty={!data?.length}>
          {data?.map((t) => <tr key={t.id}><Td>{t.id}</Td><Td>{t.subject}</Td><Td>{t.name} <span className="text-xs text-charcoal-500">{t.email}</span></Td><Td>{t.order_number}</Td><Td className="text-xs">{formatDate(t.updated_at, true)}</Td><Td><StatusBadge status={t.status} /></Td><Td><button className="text-xs underline" onClick={() => setSel(t)}>Open</button></Td></tr>)}
        </Table>
      )}
      {sel && (
        <Dialog open wide onClose={() => setSel(null)} title={sel.subject}>
          <div className="space-y-3">
            {sel.messages.map((msg) => (
              <div key={msg.id} className={cx('max-w-[85%] p-3 text-sm', msg.is_staff ? 'ml-auto bg-champagne-50' : 'bg-ivory-200')}>
                <p className="whitespace-pre-wrap">{msg.body}</p><p className="mt-1 text-[11px] text-charcoal-500">{msg.is_staff ? 'Staff' : sel.name || sel.email} · {formatDate(msg.created_at, true)}</p>
              </div>
            ))}
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the customer" aria-label="Reply" rows={3} />
            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">{['resolved', 'closed'].map((s) => <Button key={s} size="sm" variant="ghost" onClick={() => m.mutate({ status: s })}>Mark {s}</Button>)}</div>
              <Button size="sm" disabled={!reply.trim()} loading={m.isPending} onClick={() => m.mutate({ reply })}>Send reply</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  )
}
