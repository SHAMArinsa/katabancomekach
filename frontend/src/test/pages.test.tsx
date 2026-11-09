import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AdminLayout } from '@/layouts/AdminLayout'
import { RequireCustomer } from '@/layouts/StoreLayout'
import Settings from '@/pages/admin/Settings'
import Products from '@/pages/admin/Products'
import CartPage from '@/pages/store/CartPage'
import Listing from '@/pages/store/Listing'
import PaymentPage from '@/pages/store/PaymentPage'
import ProductPage from '@/pages/store/ProductPage'
import { mockFetch, quote, renderApp, settings } from './utils'

const card = { id: 3, name: 'Amber Vase', slug: 'amber-vase', sku: 'AV', short_description: '', price: '1500.00', compare_at_price: '1800.00', on_sale: true, image: null, hover_image: null,
  category: { name: 'Vases', slug: 'vases' }, badge: 'New', is_new_arrival: true, is_bestseller: false, is_featured: false, stock_state: 'in_stock', default_variant_id: 7, has_variants: false }

beforeEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

const common = [
  { path: '/api/v1/public/settings', body: settings },
  { path: '/api/v1/public/categories', body: [] },
  { path: '/api/v1/public/destinations', body: [{ country_code: 'IN', country_name: 'India', enabled: true, postal_code_regex: null, reason: null }] },
  { path: '/api/v1/public/currencies', body: [{ code: 'INR', symbol: '₹', name: 'Rupee', decimals: 2, rate: '1', as_of: null }] },
]

describe('catalog', () => {
  it('lists products and sends search and filters to the API', async () => {
    const { calls } = mockFetch([...common, { path: '/api/v1/public/products', body: { items: [card], total: 1, page: 1, pages: 1, facets: { glass_types: ['Crystal'], colors: ['Amber'] } } }])
    renderApp(<Listing mode="search" />, { route: '/search?q=amber&color=Amber' })
    expect(await screen.findByText('Amber Vase')).toBeInTheDocument()
    expect(screen.getByText('₹1,800')).toBeInTheDocument()
    const req = calls.find((c) => c.url.pathname === '/api/v1/public/products')!
    expect(req.url.searchParams.get('q')).toBe('amber')
    expect(req.url.searchParams.get('color')).toBe('Amber')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'price_desc')
    await waitFor(() => expect(calls.some((c) => c.url.searchParams.get('sort') === 'price_desc')).toBe(true))
  })

  it('shows product details, stock and fragile info with Add to bag', async () => {
    mockFetch([...common, { path: '/api/v1/public/products/amber-vase', body: { ...card, description: 'Lovely.', brand: null, glass_type: 'Crystal', material: 'Glass', color: 'Amber', finish: null,
      dimensions: 'H 20 cm', capacity: null, weight_grams: 300, fragility: 'fragile', care_instructions: 'Hand wash', gift_wrap_available: true, gift_wrap_price: '150.00', ships_internationally: true,
      images: [], variants: [{ id: 7, sku: 'AV', name: 'Default', options: {}, is_default: true, price: '1500.00', compare_at_price: '1800.00', available: true, available_quantity: 3 }],
      attributes: [], collections: [], seo_title: 'Amber Vase', seo_description: '', available_quantity: 3, country_of_origin: 'IN', related: [], reviews: [], rating: null } }])
    renderApp(<Routes><Route path="/products/:slug" element={<ProductPage />} /></Routes>, { route: '/products/amber-vase' })
    expect(await screen.findByRole('heading', { name: 'Amber Vase' })).toBeInTheDocument()
    expect(screen.getByText('Only 3 left')).toBeInTheDocument()
    expect(screen.getByText(/double-boxed/)).toBeInTheDocument()
    expect(screen.getByText(/no cash on delivery/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to bag' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Buy now' })).toBeEnabled()
  })
})

describe('cart', () => {
  it('renders a guest bag from the server quote and updates quantity', async () => {
    localStorage.setItem('gl_guest_bag_v1', JSON.stringify([{ variant_id: 7, quantity: 1, gift_wrap: false }]))
    const { calls } = mockFetch([...common, { method: 'POST', path: '/api/v1/shipping/quote', body: (_u: URL, init: RequestInit) => {
      const items = JSON.parse(String(init.body)).items
      return quote({ lines: [{ ...quote().lines[0], quantity: items[0]?.quantity ?? 1 }] })
    } }])
    renderApp(<CartPage />, { route: '/cart' })
    expect(await screen.findByText('Amber Vase')).toBeInTheDocument()
    expect(screen.getAllByText(/Cash on delivery not available/i).length).toBeGreaterThan(0)
    expect(screen.queryByText(/cash on delivery available/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }))
    await waitFor(() => {
      const last = calls.filter((c) => c.url.pathname === '/api/v1/shipping/quote').pop()!
      expect((last.body as { items: { quantity: number }[] }).items[0].quantity).toBe(2)
    })
  })
})

describe('payment', () => {
  const order = { order_number: 'GL1', total: '1500.00', free_delivery: false, payment_status: 'pending', fulfillment_status: 'unfulfilled' }
  function setup(outcome: 'captured' | 'failed') {
    localStorage.setItem('gl_session_customer', '1')
    return mockFetch([...common,
      { method: 'POST', path: '/api/v1/auth/refresh', body: { access_token: 't', user: { id: 1, email: 'a@b.co', full_name: 'A', email_verified: true } } },
      { path: '/api/v1/auth/me', body: { id: 1, email: 'a@b.co', full_name: 'A', email_verified: true } },
      { path: '/api/v1/customer/cart', body: quote() },
      { path: '/api/v1/customer/orders/GL1', body: order },
      { method: 'POST', path: '/api/v1/payments/create', body: { provider: 'mock', provider_order_id: 'mo1', amount_minor: 150000, currency: 'INR', order_number: 'GL1', is_test: true } },
      { method: 'POST', path: '/api/v1/payments/mock/complete', body: { provider_order_id: 'mo1', provider_payment_id: 'mp1', signature: 'sig', status: outcome } },
      { method: 'POST', path: '/api/v1/payments/verify', body: { ...order, payment_status: 'paid' } },
    ])
  }
  const tree = <Routes><Route path="/checkout/pay/:orderNumber" element={<PaymentPage />} /><Route path="/checkout/confirmation/:orderNumber" element={<p>CONFIRMED</p>} /></Routes>

  it('verifies a successful payment server-side before confirming', async () => {
    const { calls } = setup('captured')
    renderApp(tree, { route: '/checkout/pay/GL1' })
    await userEvent.click(await screen.findByRole('button', { name: /Pay ₹1,500/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Simulate successful payment' }))
    expect(await screen.findByText('CONFIRMED')).toBeInTheDocument()
    expect(calls.some((c) => c.url.pathname === '/api/v1/payments/verify' && (c.body as { signature: string }).signature === 'sig')).toBe(true)
  })

  it('shows the failure message and offers a retry', async () => {
    setup('failed')
    renderApp(tree, { route: '/checkout/pay/GL1' })
    await userEvent.click(await screen.findByRole('button', { name: /Pay ₹1,500/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Simulate failure' }))
    expect(await screen.findByText('Payment failed — try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})

describe('protected routes', () => {
  it('sends guests to the customer login', async () => {
    mockFetch(common)
    renderApp(<Routes><Route element={<RequireCustomer />}><Route path="/account" element={<p>SECRET</p>} /></Route></Routes>, { route: '/account' })
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument()
    expect(screen.queryByText('SECRET')).toBeNull()
  })
  it('sends signed-out staff to the admin login', async () => {
    mockFetch(common)
    renderApp(<Routes><Route path="/admin" element={<AdminLayout />}><Route index element={<p>ADMIN</p>} /></Route></Routes>, { route: '/admin', scope: 'admin' })
    expect(await screen.findByText('ADMIN LOGIN PAGE')).toBeInTheDocument()
  })
})

describe('admin', () => {
  const staff = (perms: string[]) => ({ id: 1, email: 'admin@x.y', full_name: 'Admin', is_active: true, mfa_enabled: false, roles: [{ id: 1, name: 'Super Admin' }], permissions: perms, last_login_at: null })
  const adminRoutes = (perms: string[]) => [...common,
    { method: 'POST', path: '/api/v1/auth/admin/refresh', body: { access_token: 'a', user: staff(perms) } },
    { path: '/api/v1/auth/admin/me', body: staff(perms) }]

  it('edits business settings and sends a validated PATCH', async () => {
    localStorage.setItem('gl_session_admin', '1')
    const section = (value: object) => ({ value, version: 1, updated_at: null })
    const { calls } = mockFetch([...adminRoutes(['settings.read', 'settings.write']),
      { path: '/api/v1/admin/settings', body: { store: section({ brand_name: 'X' }), catalog: section({}), pricing: section({}), shipping: section({ domestic_free_threshold: '2000', international_enabled: true }),
        payment: section({}), account: section({}), content: section({}), notifications: section({}), privacy: section({}), _server: {} } },
      { path: '/api/v1/admin/settings/schema', body: { shipping: { properties: { domestic_free_threshold: { anyOf: [{ type: 'number' }, { type: 'string' }], title: 'T' }, international_enabled: { type: 'boolean' } } } } },
      { method: 'PATCH', path: '/api/v1/admin/settings/shipping', body: {} },
    ])
    renderApp(<Routes><Route path="/admin" element={<AdminLayout />}><Route path="settings" element={<Settings />} /></Route></Routes>, { route: '/admin/settings?section=shipping', scope: 'admin' })
    const input = await screen.findByLabelText('Domestic free threshold')
    await userEvent.clear(input)
    await userEvent.type(input, '2500')
    await userEvent.click(screen.getByRole('button', { name: /save shipping settings/i }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ domestic_free_threshold: '2500', international_enabled: true }))
  })

  it('hides write actions from read-only roles', async () => {
    localStorage.setItem('gl_session_admin', '1')
    mockFetch([...adminRoutes(['products.read', 'dashboard.read']),
      { path: '/api/v1/admin/products', body: { items: [{ ...card, status: 'draft', available: 3, on_hand: 3, low_stock_threshold: 5, updated_at: new Date().toISOString() }], total: 1, page: 1, pages: 1 } },
      { path: '/api/v1/admin/categories', body: [] }])
    renderApp(<Routes><Route path="/admin" element={<AdminLayout />}><Route path="products" element={<Products />} /></Route></Routes>, { route: '/admin/products', scope: 'admin' })
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Amber Vase')).toBeInTheDocument()
    expect(screen.queryByText(/New product/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Import/ })).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'Admin' })
    expect(within(nav).queryByText('Business settings')).toBeNull()
    expect(within(nav).getByText('Products')).toBeInTheDocument()
  })
})
