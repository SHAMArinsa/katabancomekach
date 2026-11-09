import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Providers } from '@/app/providers'
import { AdminAuthProvider } from '@/features/admin/AdminAuth'
import { CustomerAuthProvider } from '@/features/auth/CustomerAuth'
import { CartProvider } from '@/features/cart/CartContext'
import type { PublicSettings, Quote } from '@/types'

type Handler = (url: URL, init: RequestInit) => unknown | Promise<unknown>
export interface MockRoute { method?: string; path: string | RegExp; status?: number; body: unknown | Handler }

/** Route-based fetch mock. Every request is recorded in `calls` so tests can assert on them. */
export function mockFetch(routes: MockRoute[]) {
  const calls: { method: string; url: URL; body: unknown }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({ method, url, body })
    const r = routes.find((x) => (x.method ?? 'GET') === method && (typeof x.path === 'string' ? url.pathname === x.path : x.path.test(url.pathname)))
    if (!r) return new Response(JSON.stringify({ error: { code: 'not_found', message: `no mock for ${method} ${url.pathname}` } }), { status: 404 })
    const payload = typeof r.body === 'function' ? await (r.body as Handler)(url, init) : r.body
    return new Response(JSON.stringify(payload), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export function renderApp(ui: ReactNode, { route = '/', path = '*', scope = 'customer' }: { route?: string; path?: string; scope?: 'customer' | 'admin' } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (n: ReactNode) => scope === 'admin'
    ? <AdminAuthProvider>{n}</AdminAuthProvider>
    : <CustomerAuthProvider><CartProvider>{n}</CartProvider></CustomerAuthProvider>
  return render(
    <Providers client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={wrap(ui)} />
          <Route path="/login" element={<p>LOGIN PAGE</p>} />
          <Route path="/admin/login" element={<p>ADMIN LOGIN PAGE</p>} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

export const settings: PublicSettings = {
  store: { brand_name: 'Test Glass', tagline: 't', logo_url: '', favicon_url: '', business_description: 'd', contact_email: 'a@b.c', contact_phone: '1',
    business_address: 'addr', gstin: '', social: {}, store_status: 'open', maintenance_mode: false, maintenance_message: '', announcement: { enabled: true, text: 'Free delivery', link: '/' }, footer_text: 'f' },
  shipping: { domestic_country: 'IN', domestic_free_threshold: '2000.00', international_free_threshold: '10000.00', threshold_basis: 'after_discount', international_enabled: true,
    recipient_paid_note: 'Courier collects shipping from the recipient.', customs_disclosure: 'Duties may apply.', insurance_available: false, insurance_note: '' },
  pricing: { base_currency: 'INR', display_currencies: ['INR'], prices_include_tax: true, show_compare_at_price: true },
  payment: { methods: ['card', 'upi'], provider: 'mock', mode: 'test', cod_available: false, instructions: 'Pay securely online.', failure_message: 'Payment failed — try again.' },
  account: { registration_enabled: true, require_email_verification: true, password_min_length: 10, password_require_mixed: true, return_window_days: 7, damage_claim_window_hours: 48, support_email: 's@x.y', support_phone: '' },
  content: { seo_default_title: 'T', seo_default_description: 'D', newsletter_enabled: false, newsletter_heading: '', newsletter_text: '', home_sections: [], hidden_home_sections: [] },
  privacy: { cookie_banner_enabled: false, analytics_enabled: false, analytics_provider: 'none', analytics_site_id: '' },
  environment: { payments_test_mode: true, app_env: 'test' },
}

export function quote(over: Partial<Quote> & { free?: boolean } = {}): Quote {
  const free = over.free ?? false
  return {
    currency: 'INR', subtotal: free ? '2500.00' : '1500.00', discount: '0.00', gift_wrap: '0.00', tax: '228.81', prices_include_tax: true, total: free ? '2500.00' : '1500.00',
    lines: [{ variant_id: 7, product_id: 3, product_name: 'Amber Vase', product_slug: 'amber-vase', variant_name: '', sku: 'AV', image_url: null, unit_price: '1500.00', compare_at_price: null,
      on_sale: false, quantity: 1, gift_wrap: false, gift_wrap_amount: '0.00', line_subtotal: '1500.00', discount: '0.00', tax_rate: '18', tax_amount: '228.81', line_total: '1500.00',
      available: 5, fragility: 'fragile', issue: null, cart_item_id: 11 }],
    destination: { country: 'IN', is_international: false, supported: true, reasons: [] },
    shipping: { free_delivery: free, threshold: '2000.00', threshold_basis: 'after_discount', eligible_subtotal: free ? '2500.00' : '1500.00', amount_to_free_delivery: free ? '0.00' : '500.00',
      fee_payer: free ? 'store' : 'recipient', fee_collection_status: free ? 'not_applicable' : 'pending_collection', estimated_fee: free ? null : '150.00', fee_charged_online: '0.00',
      arrangement_supported: true, arrangement_note: null, note: free ? 'Complimentary delivery — no shipping charge is payable.' : 'Courier collects shipping from the recipient.',
      customs_disclosure: null, provider: 'Mock Courier', estimated_days: [3, 7], insurance_available: false, contains_fragile: true },
    coupon: null, payment: { methods: ['card'], cod_available: false, provider: 'mock', mode: 'test', instructions: '', amount_due_online: '1500.00' },
    display: { currency: 'INR', rate: '1', total: '1500.00', subtotal: '1500.00', threshold: '2000.00', note: null },
    blocking_issues: [], can_checkout: true, ...over,
  }
}
