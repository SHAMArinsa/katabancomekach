import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Json, Tabs } from '@/components/admin/kit'
import { Badge, Dialog, PageLoader, Pagination, Select, StatusBadge, Table, Td } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi } from '@/services/api'
import type { Paged } from '@/types'
import { formatDate, formatINR } from '@/utils/format'

interface P { id: number; order_number: string; provider: string; provider_order_id: string; provider_payment_id: string | null; method: string; amount: string; currency: string; status: string; is_test: boolean; verified_at: string | null; failure_reason: string | null; created_at: string }
interface R { id: number; order_number: string; amount: string; reason: string; status: string; provider_refund_id: string | null; created_at: string }

export default function Payments() {
  const [tab, setTab] = useState<'payments' | 'refunds'>('payments')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [events, setEvents] = useState<number | null>(null)
  const pays = useQuery({ queryKey: ['admin', 'payments', status, page], enabled: tab === 'payments', queryFn: () => adminApi.get<Paged<P>>('/admin/payments', { status: status || undefined, page }) })
  const refs = useQuery({ queryKey: ['admin', 'refunds'], enabled: tab === 'refunds', queryFn: () => adminApi.get<R[]>('/admin/refunds') })
  const ev = useQuery({ queryKey: ['admin', 'payment-events', events], enabled: !!events, queryFn: () => adminApi.get<unknown[]>(`/admin/payments/${events}/events`) })
  return (
    <AdminPage title="Payments & refunds" subtitle="Verified payment records are read-only. Refunds are issued from the order page.">
      <Tabs tabs={[{ id: 'payments', label: 'Payments' }, { id: 'refunds', label: 'Refunds' }]} value={tab} onChange={setTab} />
      {tab === 'payments' ? (
        <>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="w-48" aria-label="Status">
            <option value="">All statuses</option>{['created', 'authorized', 'captured', 'failed'].map((s) => <option key={s}>{s}</option>)}
          </Select>
          {pays.isLoading ? <PageLoader /> : (
            <>
              <Table head={['Created', 'Order', 'Provider', 'Transaction', 'Method', 'Amount', 'Status', 'Verified', '']} empty={!pays.data?.items.length}>
                {pays.data?.items.map((p) => (
                  <tr key={p.id}><Td className="text-xs">{formatDate(p.created_at, true)}</Td><Td><Link to={`/admin/orders/${p.order_number}`} className="underline">{p.order_number}</Link></Td>
                    <Td>{p.provider}{p.is_test && <Badge tone="gold" className="ml-1">TEST</Badge>}</Td><Td className="text-xs">{p.provider_payment_id ?? p.provider_order_id}</Td><Td>{p.method}</Td>
                    <Td>{formatINR(p.amount)}</Td><Td><StatusBadge status={p.status} />{p.failure_reason && <p className="text-[11px] text-red-800">{p.failure_reason}</p>}</Td>
                    <Td className="text-xs">{formatDate(p.verified_at, true)}</Td><Td><button className="text-xs underline" onClick={() => setEvents(p.id)}>Events</button></Td></tr>
                ))}
              </Table>
              {pays.data && <Pagination page={page} pages={pays.data.pages} onPage={setPage} />}
            </>
          )}
        </>
      ) : refs.isLoading ? <PageLoader /> : (
        <Table head={['Date', 'Order', 'Amount', 'Reason', 'Status', 'Provider ref']} empty={!refs.data?.length}>
          {refs.data?.map((r) => <tr key={r.id}><Td className="text-xs">{formatDate(r.created_at, true)}</Td><Td><Link to={`/admin/orders/${r.order_number}`} className="underline">{r.order_number}</Link></Td><Td>{formatINR(r.amount)}</Td><Td>{r.reason}</Td><Td><StatusBadge status={r.status} /></Td><Td className="text-xs">{r.provider_refund_id}</Td></tr>)}
        </Table>
      )}
      <Dialog open={!!events} onClose={() => setEvents(null)} title="Payment events" wide>{ev.isLoading ? <PageLoader /> : <Json value={ev.data} />}</Dialog>
    </AdminPage>
  )
}
