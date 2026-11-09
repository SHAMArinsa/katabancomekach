import { Suspense } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { CartDrawer } from '@/components/store/CartDrawer'
import { CookieBanner } from '@/components/store/CookieBanner'
import { Footer } from '@/components/store/Footer'
import { AnnouncementBar, Header, Logo, TestModeBanner } from '@/components/store/Header'
import { PageLoader } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { useSettings } from '@/features/catalog/hooks'
import { cx } from '@/utils/format'

export function StoreLayout() {
  const { data } = useSettings()
  if (data?.store.maintenance_mode) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
        <Logo />
        <p className="max-w-md font-display text-2xl">{data.store.maintenance_message}</p>
      </div>
    )
  }
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:bg-ivory focus:px-4 focus:py-2">Skip to content</a>
      <AnnouncementBar />
      <TestModeBanner />
      <Header />
      <main id="main" className="flex-1">
        <Suspense fallback={<PageLoader />}><Outlet /></Suspense>
      </main>
      <Footer />
      <CartDrawer />
      <CookieBanner />
    </div>
  )
}

export function RequireCustomer() {
  const { user, ready } = useAuth()
  const loc = useLocation()
  if (!ready) return <PageLoader />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return <Outlet />
}

const ACCOUNT_NAV = [
  ['/account', 'Overview'], ['/account/orders', 'Orders'], ['/account/returns', 'Returns & claims'],
  ['/account/wishlist', 'Wishlist'], ['/account/addresses', 'Addresses'], ['/account/profile', 'Profile'],
  ['/account/support', 'Support'],
]

export function AccountLayout() {
  const { user, logout } = useAuth()
  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12 md:px-10 md:py-16">
      <p className="text-[11px] uppercase tracking-luxe text-champagne-500">My account</p>
      <h1 className="mb-10 mt-2 font-display text-4xl md:text-5xl">Hello, {user?.full_name.split(' ')[0]}</h1>
      <div className="grid gap-10 md:grid-cols-[200px_1fr]">
        <nav aria-label="Account" className="flex gap-4 overflow-x-auto border-b border-line pb-3 md:flex-col md:gap-3 md:border-b-0 md:border-r md:pb-0 md:pr-6">
          {ACCOUNT_NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/account'}
              className={({ isActive }) => cx('whitespace-nowrap text-sm hover:text-champagne-500', isActive ? 'text-charcoal font-medium' : 'text-charcoal-500')}>{label}</NavLink>
          ))}
          <button onClick={() => logout()} className="whitespace-nowrap text-left text-sm text-charcoal-500 hover:text-charcoal">Sign out</button>
        </nav>
        <div className="min-w-0"><Suspense fallback={<PageLoader />}><Outlet /></Suspense></div>
      </div>
    </div>
  )
}
