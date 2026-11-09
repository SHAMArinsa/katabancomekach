import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, Field, PageLoader, StatusBadge, Table, Td, Textarea, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { Ticket } from '@/types'
import { formatDate, formatINR } from '@/utils/format'

interface Detail { id: number; email: string; full_name: string; phone: string | null; email_verified: boolean; marketing_opt_in: boolean; created_at: string; restricted: boolean; restriction_reason: string | null; deletion_requested_at: string | null; deleted: boolean; last_login_at: string | null
  orders: { order_number: string; created_at: string; total: string; payment_status: string; fulfillment_status: string }[]; lifetime_value: string
  addresses?: { label: string; full_name: string; line1: string; city: string; postal_code: string; country_code: string; phone: string }[]; tickets: Ticket[] }

export default function CustomerDetail() {
  const { id } = useParams()
  const { can } = useAdmin()
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['admin', 'customer', id]
  const { data: c, isLoading } = useQuery({ queryKey: key, queryFn: () => adminApi.get<Detail>(`/admin/customers/${id}`) })
  const [restrictOpen, setRestrictOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [reason, setReason] = useState('')
  const restrict = useMutation({
    mutationFn: () => adminApi.post(`/admin/customers/${id}/restrict`, { restricted: !c!.restricted, reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setRestrictOpen(false); setReason(''); toast('Account updated') }, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  const del = useMutation({
    mutationFn: () => adminApi.post(`/admin/customers/${id}/process-deletion`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); setDeleteOpen(false); toast('Account anonymised') }, onError: (e) => { setDeleteOpen(false); toast(errorMessage(e), 'bad') },
  })
  if (isLoading || !c) return <PageLoader />
  return (
    <AdminPage title={c.full_name} subtitle={`${c.email} · joined ${formatDate(c.created_at)}`} actions={<>
      {can('customers.write') && !c.deleted && <Button size="sm" variant={c.restricted ? 'secondary' : 'danger'} onClick={() => setRestrictOpen(true)}>{c.restricted ? 'Lift restriction' : 'Restrict account'}</Button>}
      {can('customers.write', 'customers.pii') && c.deletion_requested_at && !c.deleted && <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>Process deletion request</Button>}
    </>}>
      {c.restricted && <Alert tone="bad" title="Account restricted">{c.restriction_reason}</Alert>}
      {c.deletion_requested_at && !c.deleted && <Alert tone="info">Deletion requested on {formatDate(c.deletion_requested_at)}.</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Profile"><dl className="space-y-1 text-sm"><div>Phone: {c.phone ?? '—'}</div><div>Email verified: {c.email_verified ? 'Yes' : 'No'}</div><div>Marketing: {c.marketing_opt_in ? 'Opted in' : 'No'}</div><div>Last sign-in: {formatDate(c.last_login_at, true)}</div></dl></Card>
        <Card title="Lifetime value"><p className="font-display text-3xl">{formatINR(c.lifetime_value)}</p><p className="text-sm text-charcoal-500">{c.orders.length} orders</p></Card>
        <Card title="Addresses">{c.addresses ? (c.addresses.length ? c.addresses.map((a, i) => <p key={i} className="text-sm">{a.label}: {a.line1}, {a.city} {a.postal_code} {a.country_code}</p>) : <p className="text-sm text-charcoal-500">None</p>) : <Badge>Requires PII permission</Badge>}</Card>
      </div>
      <Card title="Orders">
        <Table head={['Order', 'Date', 'Total', 'Payment', 'Fulfilment']} empty={!c.orders.length}>
          {c.orders.map((o) => <tr key={o.order_number}><Td><Link to={`/admin/orders/${o.order_number}`} className="underline">{o.order_number}</Link></Td><Td>{formatDate(o.created_at)}</Td><Td>{formatINR(o.total)}</Td><Td><StatusBadge status={o.payment_status} /></Td><Td><StatusBadge status={o.fulfillment_status} /></Td></tr>)}
        </Table>
      </Card>
      <Card title="Support cases">
        {c.tickets.length === 0 ? <p className="text-sm text-charcoal-500">None</p> : c.tickets.map((t) => <p key={t.id} className="flex justify-between text-sm"><span>{t.subject}</span><StatusBadge status={t.status} /></p>)}
      </Card>
      <Dialog open={restrictOpen} onClose={() => setRestrictOpen(false)} title={c.restricted ? 'Lift restriction' : 'Restrict account'}
        footer={<><Button variant="ghost" onClick={() => setRestrictOpen(false)}>Close</Button><Button variant={c.restricted ? 'primary' : 'danger'} loading={restrict.isPending} disabled={reason.length < 3} onClick={() => restrict.mutate()}>Confirm</Button></>}>
        <Field label="Documented reason (required, audit-logged)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {!c.restricted && <p className="mt-3 text-xs text-charcoal-500">The customer will be signed out and blocked from shopping until the restriction is lifted.</p>}
      </Dialog>
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Process deletion?" danger confirmLabel="Anonymise account" loading={del.isPending} onConfirm={() => del.mutate()}
        message="Personal data (name, email, phone, addresses) is erased; order records are kept in anonymised form for tax compliance. This cannot be undone." />
    </AdminPage>
  )
}
