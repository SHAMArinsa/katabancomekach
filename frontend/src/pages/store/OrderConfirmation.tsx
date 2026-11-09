import { useQuery } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Alert, ButtonLink, PageLoader, StatusBadge } from '@/components/ui'
import { api } from '@/services/api'
import type { Order } from '@/types'
import { formatINR } from '@/utils/format'

export default function OrderConfirmation() {
  const { orderNumber } = useParams()
  const { data: o, isLoading } = useQuery({
    queryKey: ['account', 'order', orderNumber],
    queryFn: () => api.get<Order>(`/customer/orders/${orderNumber}`),
    // Webhooks may land a moment after the redirect: poll briefly until payment is confirmed.
    refetchInterval: (q) => (q.state.data && ['pending', 'authorized'].includes(q.state.data.payment_status) ? 2500 : false),
  })
  if (isLoading || !o) return <PageLoader />
  const paid = o.payment_status === 'paid'
  return (
    <div className="mx-auto max-w-2xl px-5 py-16 text-center md:py-24">
      <Seo title="Order confirmed" noindex />
      <CheckCircle2 className="mx-auto h-10 w-10 text-champagne" strokeWidth={1.2} />
      <h1 className="mt-6 font-display text-5xl">{paid ? 'Thank you' : 'Confirming your payment…'}</h1>
      <p className="mt-4 text-charcoal-600">Order <strong className="font-medium">{o.order_number}</strong> {paid ? 'is confirmed. A confirmation email is on its way.' : 'is awaiting confirmation from the payment provider.'}</p>
      {o.is_test && <p className="mt-2 text-xs text-champagne-600">Test order — no real payment was taken.</p>}
      <div className="mt-10 space-y-3 border border-line bg-white/70 p-6 text-left text-sm">
        <div className="flex justify-between"><span>Paid online</span><span>{formatINR(o.total)}</span></div>
        <div className="flex justify-between"><span>Payment</span><StatusBadge status={o.payment_status} /></div>
        <div className="flex justify-between"><span>Delivery</span><span>{o.free_delivery ? 'Complimentary' : 'Shipping collected from the recipient at delivery'}</span></div>
        {o.customs_disclosure && <Alert tone="info" className="mt-3">{o.customs_disclosure}</Alert>}
      </div>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <ButtonLink to={`/account/orders/${o.order_number}`}>View order</ButtonLink>
        <ButtonLink to="/shop" variant="secondary">Continue shopping</ButtonLink>
      </div>
    </div>
  )
}
