import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Card, Empty, PageLoader, StatusBadge } from '@/components/ui'
import { api } from '@/services/api'
import type { Claim, ReturnReq } from '@/types'
import { formatDate, humanize } from '@/utils/format'

export default function Returns() {
  const returns = useQuery({ queryKey: ['account', 'returns'], queryFn: () => api.get<ReturnReq[]>('/customer/returns') })
  const claims = useQuery({ queryKey: ['account', 'claims'], queryFn: () => api.get<Claim[]>('/customer/claims') })
  if (returns.isLoading || claims.isLoading) return <PageLoader />
  return (
    <div className="space-y-8">
      <Seo title="Returns & claims" noindex />
      <h2 className="font-display text-3xl">Returns & claims</h2>
      <p className="text-sm text-charcoal-600">Start a return or report damage from the relevant <Link to="/account/orders" className="underline">order page</Link>.</p>
      <Card title="Return & refund requests">
        {!returns.data?.length ? <Empty title="No returns" /> : (
          <ul className="divide-y divide-line text-sm">
            {returns.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>Return #{r.id} · <Link to={`/account/orders/${r.order_number}`} className="underline">{r.order_number}</Link></span>
                <span className="text-charcoal-500">{formatDate(r.created_at)}</span>
                <StatusBadge status={r.status} />
                {r.admin_note && <p className="w-full text-xs text-charcoal-500">{r.admin_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Damage & delivery claims">
        {!claims.data?.length ? <Empty title="No claims" /> : (
          <ul className="divide-y divide-line text-sm">
            {claims.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>{humanize(c.claim_type)} #{c.id} · <Link to={`/account/orders/${c.order_number}`} className="underline">{c.order_number}</Link></span>
                <span className="text-charcoal-500">{c.evidence_count} photo(s)</span>
                <StatusBadge status={c.status} />
                {c.resolution_note && <p className="w-full text-xs text-charcoal-500">{c.resolution_note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
