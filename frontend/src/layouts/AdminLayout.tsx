import {
  BarChart3, Boxes, ClipboardList, CreditCard, FileText, FolderTree, LifeBuoy, LogOut, Menu, Package, Percent,
  ScrollText, Settings, ShieldCheck, Star, Truck, UserCog, Users, X,
} from 'lucide-react'
import { Suspense, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { PageLoader } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { useSettings } from '@/features/catalog/hooks'
import { cx } from '@/utils/format'

const NAV: { to: string; label: string; icon: typeof BarChart3; perm: string; group: string }[] = [
  { to: '/admin', group: 'Overview', label: 'Dashboard', icon: BarChart3, perm: 'dashboard.read' },
  { to: '/admin/orders', group: 'Sales', label: 'Orders', icon: ClipboardList, perm: 'orders.read' },
  { to: '/admin/payments', group: 'Sales', label: 'Payments & refunds', icon: CreditCard, perm: 'payments.read' },
  { to: '/admin/customers', group: 'Sales', label: 'Customers', icon: Users, perm: 'customers.read' },
  { to: '/admin/support', group: 'Sales', label: 'Returns, claims & support', icon: LifeBuoy, perm: 'support.manage' },
  { to: '/admin/products', group: 'Catalog', label: 'Products', icon: Package, perm: 'products.read' },
  { to: '/admin/categories', group: 'Catalog', label: 'Categories & collections', icon: FolderTree, perm: 'products.read' },
  { to: '/admin/inventory', group: 'Catalog', label: 'Inventory', icon: Boxes, perm: 'inventory.read' },
  { to: '/admin/reviews', group: 'Catalog', label: 'Reviews', icon: Star, perm: 'reviews.moderate' },
  { to: '/admin/coupons', group: 'Marketing', label: 'Coupons', icon: Percent, perm: 'coupons.write' },
  { to: '/admin/content', group: 'Marketing', label: 'Website content', icon: FileText, perm: 'content.write' },
  { to: '/admin/shipping', group: 'Setup', label: 'Shipping', icon: Truck, perm: 'settings.read' },
  { to: '/admin/settings', group: 'Setup', label: 'Business settings', icon: Settings, perm: 'settings.read' },
  { to: '/admin/staff', group: 'Setup', label: 'Staff & roles', icon: UserCog, perm: 'staff.manage' },
  { to: '/admin/audit', group: 'Setup', label: 'Audit log', icon: ScrollText, perm: 'audit.read' },
]

export function AdminLayout() {
  const { admin, ready, logout, can } = useAdmin()
  const { data } = useSettings()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  if (!ready) return <PageLoader />
  if (!admin) return <Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  const items = NAV.filter((n) => can(n.perm))
  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="Admin">
      <Link to="/admin" className="block px-6 pb-6 pt-7">
        <span className="font-display text-2xl text-ivory">{data?.store.brand_name ?? 'Store'}</span>
        <span className="mt-1 block text-[10px] uppercase tracking-luxe text-champagne-300">Admin</span>
      </Link>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map(({ to, label, icon: Icon, group }, i) => (
          <li key={to}>
            {(i === 0 || items[i - 1].group !== group) && <p className="px-3 pb-1.5 pt-4 text-[10px] uppercase tracking-[0.18em] text-charcoal-500">{group}</p>}
            <NavLink to={to} end={to === '/admin'} onClick={() => setOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-3 px-3 py-2 text-[13px] transition',
                isActive ? 'bg-charcoal-700 text-ivory' : 'text-charcoal-400 hover:bg-charcoal-700/60 hover:text-ivory')}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-charcoal-700 p-4 text-xs text-charcoal-400">
        <p className="truncate text-ivory-200">{admin.full_name}</p>
        <p className="truncate">{admin.roles.map((r) => r.name).join(', ')}</p>
        <div className="mt-3 flex items-center gap-4">
          <Link to="/admin/account" className="flex items-center gap-1 hover:text-ivory"><ShieldCheck className="h-3.5 w-3.5" /> Security</Link>
          <button onClick={() => logout()} className="flex items-center gap-1 hover:text-ivory"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </div>
    </nav>
  )
  return (
    <div className="min-h-screen bg-[#F6F3EC]">
      <Seo title="Admin" noindex />
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-charcoal lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-charcoal/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-charcoal">{sidebar}
            <button className="absolute right-3 top-3 text-ivory" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-[#F6F3EC]/95 px-5 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          {data?.environment.payments_test_mode && <span className="border border-champagne-200 bg-champagne-50 px-2 py-0.5 text-[11px] text-champagne-600">Payments in test mode</span>}
          <a href="/" target="_blank" rel="noreferrer" className="text-xs uppercase tracking-[0.16em] text-charcoal-600 hover:text-charcoal">View store ↗</a>
        </header>
        <main className="px-5 py-8 lg:px-8"><Suspense fallback={<PageLoader />}><Outlet /></Suspense></main>
      </div>
    </div>
  )
}

export function AdminPage({ title, actions, children, subtitle }: { title: string; actions?: React.ReactNode; children: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1300px] space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-[34px] leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-charcoal-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
