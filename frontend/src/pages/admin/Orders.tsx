import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { FilterBar } from '@/components/admin/kit'
import { Button, Field, Input, PageLoader, Pagination, Select, StatusBadge, Table, Td, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { Paged } from '@/types'
import { formatDate, formatINR, humanize } from '@/utils/format'

interface Row { order_number: string; email: string; created_at: string; total: string; items: number; destination_country: string; is_international: boolean
  payment_status: string; fulfillment_status: string; shipping_fee_status: string; free_delivery: boolean; requires_attention: boolean; is_test: boolean }

const PAY = ['pending', 'authorized', 'paid', 'failed', 'partially_refunded', 'refunded']
const FUL = ['unfulfilled', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'returned']
const FEE = ['not_applicable', 'pending_collection', 'collected', 'collection_failed', 'waived', 'disputed']

export default function Orders() {
  const [sp, setSp] = useSearchParams()
  const { can } = useAdmin()
  const toast = useToast()
  const filters = Object.fromEntries(['q', 'payment_status', 'fulfillment_status', 'shipping_fee_status', 'country', 'date_from', 'date_to'].map((k) => [k, sp.get(k) || undefined]))
  const page = Number(sp.get('page') || 1)
  const attention = sp.get('attention') === '1'
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'orders', filters, page, attention],
    queryFn: () => adminApi.get<Paged<Row>>('/admin/orders', { ...filters, attention, page }),
    placeholderData: (p) => p,
  })
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setSp(n) }
  const exportCsv = () => adminApi.download('/admin/orders-export', filters, 'orders.csv').catch((e) => toast(errorMessage(e), 'bad'))
  return (
    <AdminPage title="Orders" actions={can('orders.export') && <Button variant="secondary" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>}>
      <FilterBar>
        <Field label="Search"><Input placeholder="Order no. or email" defaultValue={filters.q} onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value)} className="w-56" /></Field>
        {([['payment_status', 'Payment', PAY], ['fulfillment_status', 'Fulfilment', FUL], ['shipping_fee_status', 'Shipping fee', FEE]] as const).map(([k, l, opts]) => (
          <Field key={k} label={l}><Select value={filters[k] ?? ''} onChange={(e) => set(k, e.target.value)} className="w-44"><option value="">All</option>{opts.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</Select></Field>
        ))}
        <Field label="Country"><Input value={filters.country ?? ''} maxLength={2} onChange={(e) => set('country', e.target.value.toUpperCase())} className="w-20" /></Field>
        <Field label="From"><Input type="date" value={filters.date_from ?? ''} onChange={(e) => set('date_from', e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={filters.date_to ?? ''} onChange={(e) => set('date_to', e.target.value)} /></Field>
        <label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" checked={attention} onChange={(e) => set('attention', e.target.checked ? '1' : '')} /> Needs attention</label>
      </FilterBar>
      {isLoading ? <PageLoader /> : (
        <>
          <Table head={['Order', 'Placed', 'Customer', 'Dest.', 'Items', 'Total', 'Payment', 'Fulfilment', 'Shipping fee']} empty={!data?.items.length}>
            {data?.items.map((o) => (
              <tr key={o.order_number} className={o.requires_attention ? 'bg-amber-50/60' : ''}>
                <Td><Link to={`/admin/orders/${o.order_number}`} className="font-medium hover:underline">{o.order_number}</Link>{o.is_test && <span className="ml-1 text-[10px] text-champagne-600">TEST</span>}{o.requires_attention && <span className="ml-1 text-[10px] text-amber-700">⚠</span>}</Td>
                <Td>{formatDate(o.created_at, true)}</Td><Td>{o.email}</Td><Td>{o.destination_country}</Td><Td>{o.items}</Td><Td>{formatINR(o.total)}</Td>
                <Td><StatusBadge status={o.payment_status} /></Td><Td><StatusBadge status={o.fulfillment_status} /></Td>
                <Td><StatusBadge status={o.shipping_fee_status} label={o.free_delivery ? 'Free' : undefined} /></Td>
              </tr>
            ))}
          </Table>
          {data && <Pagination page={page} pages={data.pages} onPage={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n) }} />}
        </>
      )}
    </AdminPage>
  )
}
