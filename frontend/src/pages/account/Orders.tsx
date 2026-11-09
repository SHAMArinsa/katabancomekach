import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GlassImage } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { ButtonLink, Empty, PageLoader, Pagination, StatusBadge } from '@/components/ui'
import { api } from '@/services/api'
import type { Order, Paged } from '@/types'
import { formatDate, formatINR } from '@/utils/format'

export default function Orders() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({ queryKey: ['account', 'orders', page], queryFn: () => api.get<Paged<Order>>('/customer/orders', { page }) })
  if (isLoading) return <PageLoader />
  return (
    <div>
      <Seo title="My orders" noindex />
      <h2 className="mb-6 font-display text-3xl">Orders</h2>
      {!data?.items.length ? <Empty title="No orders yet" action={<ButtonLink to="/shop">Start shopping</ButtonLink>} /> : (
        <ul className="space-y-4">
          {data.items.map((o) => (
            <li key={o.order_number}>
              <Link to={`/account/orders/${o.order_number}`} className="flex flex-col gap-4 border border-line bg-white/60 p-5 transition hover:border-charcoal-400 md:flex-row md:items-center">
                <div className="flex -space-x-3">
                  {o.items.slice(0, 3).map((i) => <GlassImage key={i.id} src={i.image_url} alt={i.product_name} className="h-16 w-14 border-2 border-ivory object-cover" />)}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{o.order_number}{o.is_test && <span className="ml-2 text-xs text-champagne-600">test</span>}</p>
                  <p className="text-sm text-charcoal-500">{formatDate(o.created_at)} · {o.items.reduce((n, i) => n + i.quantity, 0)} item(s) · {formatINR(o.total)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge status={o.payment_status} />
                  <StatusBadge status={o.fulfillment_status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={page} pages={data.pages} onPage={setPage} />}
    </div>
  )
}
