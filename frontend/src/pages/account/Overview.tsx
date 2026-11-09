import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Alert, Card, StatusBadge } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { api } from '@/services/api'
import type { Order, Paged } from '@/types'
import { formatDate, formatINR } from '@/utils/format'

export default function Overview() {
  const { user } = useAuth()
  const { data } = useQuery({ queryKey: ['account', 'orders', 1], queryFn: () => api.get<Paged<Order>>('/customer/orders', { page: 1 }) })
  const recent = data?.items.slice(0, 3) ?? []
  return (
    <div className="space-y-8">
      <Seo title="My account" noindex />
      {user && !user.email_verified && <Alert tone="warn" title="Verify your email">Please confirm your email address to place orders. <Link to="/verify-email" className="underline">Resend link</Link></Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        {[['/account/orders', 'Orders', `${data?.total ?? 0} placed`], ['/account/wishlist', 'Wishlist', 'Saved pieces'], ['/account/support', 'Support', 'Get help']].map(([to, t, s]) => (
          <Link key={to} to={to} className="border border-line bg-white/60 p-5 transition hover:border-charcoal-400">
            <p className="font-display text-2xl">{t}</p><p className="mt-1 text-sm text-charcoal-500">{s}</p>
          </Link>
        ))}
      </div>
      <Card title="Recent orders" actions={<Link to="/account/orders" className="text-xs underline">All orders</Link>}>
        {recent.length === 0 ? <p className="text-sm text-charcoal-500">You have not placed an order yet.</p> : (
          <ul className="divide-y divide-line">
            {recent.map((o) => (
              <li key={o.order_number} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <Link to={`/account/orders/${o.order_number}`} className="font-medium underline-offset-4 hover:underline">{o.order_number}</Link>
                <span className="text-charcoal-500">{formatDate(o.created_at)}</span>
                <span>{formatINR(o.total)}</span>
                <StatusBadge status={o.fulfillment_status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
