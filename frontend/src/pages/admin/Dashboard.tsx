import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CheckCircle2, Circle, PackagePlus, ClipboardList, Settings2, Store } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StatCard } from '@/components/admin/kit'
import { Alert, Card, PageLoader, Select, StatusBadge, Table, Td } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi } from '@/services/api'
import { formatDate, formatINR, humanize } from '@/utils/format'

interface Dash {
  period_days: number
  products: Record<string, number>
  orders: Record<string, number>
  sales: Record<string, string>
  shipping_fee_collection: Record<string, number>
  daily: { date: string; sales: string; orders: number }[]
  checklist?: { key: string; label: string; done: boolean; link: string }[]
  low_stock_items?: { id: number; name: string; available: number; threshold: number }[]
  recent_orders: { order_number: string; email: string; total: string; payment_status: string; fulfillment_status: string; shipping_fee_status: string; is_test: boolean; destination_country: string; created_at: string }[]
}

export default function Dashboard() {
  const [days, setDays] = useState(30)
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'dashboard', days], queryFn: () => adminApi.get<Dash>('/admin/dashboard', { days }) })
  if (isLoading || !data) return <PageLoader />
  const max = Math.max(1, ...data.daily.map((d) => Number(d.sales)))
  return (
    <AdminPage title="Dashboard" actions={
      <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 w-40" aria-label="Period">
        <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
      </Select>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { to: '/admin/products/new', label: 'Add a product', icon: PackagePlus },
          { to: '/admin/orders', label: 'Manage orders', icon: ClipboardList },
          { to: '/admin/settings', label: 'Store settings', icon: Settings2 },
          { to: '/', label: 'View storefront', icon: Store },
        ].map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} target={to === '/' ? '_blank' : undefined} className="flex items-center gap-3 border border-ivory-300 bg-white px-4 py-3 text-sm transition hover:border-champagne hover:shadow-sm">
            <Icon className="h-4 w-4 text-champagne-500" aria-hidden />{label}
          </Link>
        ))}
      </div>
      {data.checklist && data.checklist.some((c) => !c.done) && (
        <Card title={`Launch checklist · ${data.checklist.filter((c) => c.done).length}/${data.checklist.length} done`}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.checklist.map((c) => (
              <li key={c.key}>
                <Link to={c.link} className="flex items-center gap-2 text-sm hover:underline">
                  {c.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Done" /> : <Circle className="h-4 w-4 text-charcoal-400" aria-label="To do" />}
                  <span className={c.done ? 'text-charcoal-500 line-through' : ''}>{c.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.orders.needs_attention > 0 && <Alert tone="warn" title={`${data.orders.needs_attention} order(s) need attention`}><Link to="/admin/orders?attention=1" className="underline">Review now</Link></Alert>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Gross sales" value={formatINR(data.sales.gross)} hint={`Net ${formatINR(data.sales.net)} after ${formatINR(data.sales.refunds)} refunds`} />
        <StatCard label="Domestic / International" value={<span className="text-2xl">{formatINR(data.sales.domestic)} / {formatINR(data.sales.international)}</span>} />
        <StatCard label="Orders to fulfil" value={data.orders.to_fulfil} hint={`${data.orders.pending_payment} awaiting payment`} tone={data.orders.to_fulfil ? 'warn' : undefined} />
        <StatCard label="Stock alerts" value={`${data.products.out_of_stock} / ${data.products.low_stock}`} hint="Out of stock / low stock" tone={data.products.out_of_stock ? 'bad' : undefined} />
      </div>
      {Number(data.sales.test_mode_gross) > 0 && <p className="text-xs text-champagne-600">Test-mode orders ({formatINR(data.sales.test_mode_gross)}) are excluded from sales figures.</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sales by day" className="lg:col-span-2">
          {data.daily.length === 0 ? <p className="text-sm text-charcoal-500">No paid orders in this period.</p> : (
            <div className="flex h-48 items-end gap-1" role="img" aria-label="Daily sales chart">
              {data.daily.map((d) => (
                <div key={d.date} className="group relative max-w-[48px] flex-1">
                  <div className="w-full bg-champagne-300 transition group-hover:bg-champagne" style={{ height: `${(Number(d.sales) / max) * 180}px` }} />
                  <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap bg-charcoal px-2 py-1 text-[10px] text-ivory group-hover:block">{d.date}: {formatINR(d.sales)} · {d.orders}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Orders">
          <dl className="space-y-2 text-sm">
            {['total', 'paid', 'shipped', 'delivered', 'cancelled'].map((k) => <div key={k} className="flex justify-between"><dt className="text-charcoal-600">{humanize(k)}</dt><dd>{data.orders[k]}</dd></div>)}
          </dl>
          <p className="mb-2 mt-5 text-[11px] uppercase tracking-[0.14em] text-charcoal-500">Shipping fee collection</p>
          <dl className="space-y-2 text-sm">
            {Object.entries(data.shipping_fee_collection).map(([k, v]) => <div key={k} className="flex justify-between"><dt><StatusBadge status={k} /></dt><dd>{v}</dd></div>)}
          </dl>
        </Card>
      </div>
      {!!data.low_stock_items?.length && (
        <Card title="Running low" actions={<Link to="/admin/inventory" className="text-xs underline">Inventory</Link>}>
          <ul className="divide-y divide-ivory-300 text-sm">
            {data.low_stock_items.map((i) => (
              <li key={i.id} className="flex justify-between py-2"><Link to={`/admin/products/${i.id}`} className="hover:underline">{i.name}</Link>
                <span className={i.available <= 0 ? 'text-red-700' : 'text-champagne-600'}>{i.available <= 0 ? 'Sold out' : `${i.available} left`}</span></li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-4">
        {['total', 'published', 'draft', 'archived'].map((k) => <StatCard key={k} label={`Products · ${k}`} value={data.products[k]} />)}
      </div>
      <Card title="Recent orders" actions={<Link to="/admin/orders" className="text-xs underline">All orders</Link>}>
        <Table head={['Order', 'Date', 'Customer', 'Total', 'Payment', 'Fulfilment', 'Shipping fee']} empty={!data.recent_orders.length}>
          {data.recent_orders.map((o) => (
            <tr key={o.order_number}>
              <Td><Link to={`/admin/orders/${o.order_number}`} className="font-medium underline-offset-4 hover:underline">{o.order_number}</Link>{o.is_test && <span className="ml-1 text-[10px] text-champagne-600">TEST</span>}</Td>
              <Td>{formatDate(o.created_at)}</Td><Td>{o.email}</Td><Td>{formatINR(o.total)}</Td>
              <Td><StatusBadge status={o.payment_status} /></Td><Td><StatusBadge status={o.fulfillment_status} /></Td><Td><StatusBadge status={o.shipping_fee_status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  )
}
