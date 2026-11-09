import { useMutation, useQuery } from '@tanstack/react-query'
import { FlaskConical, Lock } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, PageLoader } from '@/components/ui'
import { useSettings } from '@/features/catalog/hooks'
import { api, errorMessage } from '@/services/api'
import type { Order } from '@/types'
import { formatINR } from '@/utils/format'

interface Checkout {
  provider: 'mock' | 'razorpay'
  provider_order_id: string
  amount_minor: number
  currency: string
  order_number: string
  is_test: boolean
  key_id?: string
  customer?: { name: string; email: string; contact: string }
}

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: unknown) => void) => void } }
}

function loadRazorpay(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load the payment window'))
    document.body.appendChild(s)
  })
}

export default function PaymentPage() {
  const { orderNumber } = useParams()
  const nav = useNavigate()
  const { data: settings } = useSettings()
  const order = useQuery({ queryKey: ['account', 'order', orderNumber], queryFn: () => api.get<Order>(`/customer/orders/${orderNumber}`) })
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const verify = useMutation({
    mutationFn: (p: { provider_order_id: string; provider_payment_id: string; signature: string }) => api.post<Order>('/payments/verify', p),
    onSuccess: (o) => {
      if (o.payment_status === 'paid' || o.payment_status === 'authorized') nav(`/checkout/confirmation/${o.order_number}`)
      else setFailed(settings?.payment.failure_message ?? 'Payment was not completed.')
    },
    onError: (e) => setFailed(errorMessage(e)),
  })

  const create = useMutation({
    mutationFn: () => api.post<Checkout>('/payments/create', { order_number: orderNumber }),
    onSuccess: async (c) => {
      setFailed(null)
      setCheckout(c)
      if (c.provider === 'razorpay') {
        try {
          await loadRazorpay()
          const rz = new window.Razorpay!({
            key: c.key_id, order_id: c.provider_order_id, amount: c.amount_minor, currency: c.currency,
            name: settings?.store.brand_name, description: `Order ${c.order_number}`,
            prefill: { name: c.customer?.name, email: c.customer?.email, contact: c.customer?.contact },
            theme: { color: '#23211E' },
            handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
              verify.mutate({ provider_order_id: r.razorpay_order_id, provider_payment_id: r.razorpay_payment_id, signature: r.razorpay_signature }),
            modal: { ondismiss: () => setFailed('Payment window closed. You can try again.') },
          })
          rz.on('payment.failed', () => setFailed(settings?.payment.failure_message ?? 'Payment failed.'))
          rz.open()
        } catch (e) { setFailed((e as Error).message) }
      }
    },
    onError: (e) => setFailed(errorMessage(e)),
  })

  const mock = useMutation({
    mutationFn: (outcome: 'success' | 'failure') =>
      api.post<{ provider_order_id: string; provider_payment_id: string; signature: string; status: string }>('/payments/mock/complete', { provider_order_id: checkout!.provider_order_id, outcome }),
    onSuccess: (r) => {
      if (r.status === 'captured') verify.mutate({ provider_order_id: r.provider_order_id, provider_payment_id: r.provider_payment_id, signature: r.signature })
      else { setFailed(settings?.payment.failure_message ?? 'Payment failed.'); setCheckout(null); order.refetch() }
    },
    onError: (e) => setFailed(errorMessage(e)),
  })

  if (order.isLoading) return <PageLoader />
  const o = order.data
  if (!o) return <div className="container-luxe py-24"><Alert tone="bad">Order not found.</Alert></div>
  if (o.payment_status === 'paid') return <Navigate to={`/checkout/confirmation/${o.order_number}`} replace />

  return (
    <div className="mx-auto max-w-xl px-5 py-16 md:py-24">
      <Seo title="Payment" noindex />
      <p className="eyebrow">Order {o.order_number}</p>
      <h1 className="mt-2 font-display text-5xl">Complete payment</h1>
      <div className="mt-8 space-y-2 border border-line bg-white/70 p-6 text-sm">
        <div className="flex justify-between text-base"><span>Amount to pay online</span><strong className="font-medium">{formatINR(o.total)}</strong></div>
        <p className="text-charcoal-600">{o.free_delivery ? 'Delivery is complimentary.' : 'Shipping will be collected by the courier from the recipient at delivery; it is not included here.'}</p>
        {o.fulfillment_status === 'cancelled' && <Alert tone="bad" className="mt-3">This order has expired or was cancelled. Please place a new order.</Alert>}
      </div>
      {failed && <Alert tone="bad" className="mt-6" title="Payment not completed">{failed}</Alert>}

      {o.fulfillment_status !== 'cancelled' && (
        checkout?.provider === 'mock' ? (
          <div className="mt-8 border border-dashed border-champagne-300 bg-champagne-50/60 p-6" data-testid="mock-gateway">
            <p className="flex items-center gap-2 text-sm font-medium text-champagne-600"><FlaskConical className="h-4 w-4" /> Test payment gateway</p>
            <p className="mt-2 text-sm text-charcoal-600">This is a simulated payment for development. No money moves and the order is marked as a test.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={() => mock.mutate('success')} loading={mock.isPending || verify.isPending}>Simulate successful payment</Button>
              <Button variant="danger" onClick={() => mock.mutate('failure')} disabled={mock.isPending}>Simulate failure</Button>
            </div>
          </div>
        ) : (
          <Button size="lg" block className="mt-8" loading={create.isPending || verify.isPending} onClick={() => create.mutate()}>
            <Lock className="h-4 w-4" /> {failed ? 'Try again' : `Pay ${formatINR(o.total)}`}
          </Button>
        )
      )}
      <p className="mt-6 text-center text-xs text-charcoal-500">Your order is reserved for a limited time while you pay. Cash on delivery is not available for products.</p>
    </div>
  )
}
