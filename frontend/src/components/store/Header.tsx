import { Heart, MapPin, Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/CustomerAuth'
import { useCart } from '@/features/cart/CartContext'
import { useCategories, useSettings } from '@/features/catalog/hooks'
import { cx } from '@/utils/format'

export function AnnouncementBar() {
  const { data } = useSettings()
  const a = data?.store.announcement
  if (!a?.enabled || !a.text) return null
  return (
    <div className="bg-champagne-500 px-4 py-2 text-center text-xs font-semibold tracking-[0.04em] text-white">
      {a.link ? <Link to={a.link} className="hover:underline">{a.text}</Link> : a.text}
    </div>
  )
}

export function TestModeBanner() {
  const { data } = useSettings()
  if (!data?.environment.payments_test_mode) return null
  return (
    <div className="bg-champagne-50 px-4 py-1.5 text-center text-[11px] text-champagne-600">
      Test mode — payments are simulated and no real money is charged.
    </div>
  )
}

export function Logo({ className }: { className?: string }) {
  const { data } = useSettings()
  const name = data?.store.brand_name ?? import.meta.env.VITE_APP_NAME ?? 'Glass Luxury Store'
  if (data?.store.logo_url) return <img src={data.store.logo_url} alt={name} className={cx('h-8 w-auto', className)} />
  return <span className={cx('font-display text-[24px] font-semibold tracking-[0.02em] text-champagne-600 md:text-[28px]', className)}>{name}</span>
}

const NAV = [
  { to: '/new-arrivals', label: 'New in' },
  { to: '/bestsellers', label: 'Bestsellers' },
  { to: '/collections', label: 'Collections' },
  { to: '/gifts', label: 'Gifts' },
]

function PincodeBar() {
  const { postal, country, setDestination } = useCart()
  const [editing, setEditing] = useState(false)
  const [pin, setPin] = useState(postal)
  const save = (e: FormEvent) => { e.preventDefault(); if (/^\d{6}$/.test(pin)) { setDestination('IN', pin); setEditing(false) } }
  return (
    <div className="flex items-center gap-1.5">
      <MapPin className="h-3.5 w-3.5 text-champagne-500" aria-hidden />
      {editing ? (
        <form onSubmit={save} className="flex items-center gap-1">
          <input autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit PIN"
            aria-label="Delivery pincode" className="h-6 w-24 rounded border border-line bg-white px-2 text-xs focus:border-champagne focus:outline-none" />
          <button className="rounded bg-champagne-500 px-2 py-0.5 text-[11px] font-semibold text-white">Apply</button>
        </form>
      ) : (
        <button onClick={() => setEditing(true)} className="hover:text-champagne-600">
          Delivering to <span className="font-semibold text-charcoal">{country === 'IN' && postal ? postal : country !== 'IN' ? country : 'Add pincode'}</span>
        </button>
      )}
    </div>
  )
}

export function Header() {
  const { user } = useAuth()
  const { count, setDrawerOpen } = useCart()
  const { data: cats } = useCategories()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [mega, setMega] = useState<number | null>(null)
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => { setOpen(false); setMega(null) }, [loc.pathname, loc.search])
  const top = (cats ?? []).filter((c) => !c.parent_id)
  const submit = (e: FormEvent) => { e.preventDefault(); if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`) }
  const searchBox = (
    <form onSubmit={submit} role="search" className="relative w-full">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for vases, tumblers, wine glasses…" aria-label="Search products"
        className="h-11 w-full rounded-full border border-line bg-ivory-200 pl-5 pr-12 text-sm placeholder:text-charcoal-400 focus:border-champagne focus:bg-white focus:outline-none" />
      <button aria-label="Search" className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-champagne-500 text-white hover:bg-champagne-600"><Search className="h-4 w-4" /></button>
    </form>
  )
  const icon = 'flex flex-col items-center gap-0.5 px-2 text-[11px] text-charcoal-600 hover:text-champagne-600'

  return (
    <header className="sticky top-0 z-40 bg-white shadow-[0_1px_0_#E6E8E4]">
      <div className="hidden border-b border-line bg-ivory-100 text-xs text-charcoal-600 md:block">
        <div className="container-luxe flex h-9 items-center justify-between">
          <PincodeBar />
          <p>Secure online payment · Shock-proof packaging for every glass piece</p>
          <div className="flex gap-4"><Link to="/track" className="hover:text-champagne-600">Track order</Link><Link to="/contact" className="hover:text-champagne-600">Help</Link></div>
        </div>
      </div>
      <div className="container-luxe flex h-[72px] items-center gap-4 md:gap-8">
        <button className="-ml-2 p-2 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
        <Link to="/" aria-label="Home" className="shrink-0"><Logo /></Link>
        <div className="hidden flex-1 md:block md:max-w-xl md:mx-auto">{searchBox}</div>
        <div className="ml-auto flex items-center md:ml-0">
          <Link to={user ? '/account' : '/login'} className={icon} aria-label={user ? 'My account' : 'Sign in'}><User className="h-5 w-5" /><span className="hidden md:block">{user ? 'Account' : 'Sign in'}</span></Link>
          <Link to="/account/wishlist" className={icon} aria-label="Wishlist"><Heart className="h-5 w-5" /><span className="hidden md:block">Wishlist</span></Link>
          <button className={cx(icon, 'relative')} aria-label={`Cart, ${count} items`} onClick={() => setDrawerOpen(true)}>
            <ShoppingBag className="h-5 w-5" /><span className="hidden md:block">Cart</span>
            {count > 0 && <span className="absolute -top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blush-500 px-1 text-[10px] font-bold text-white">{count}</span>}
          </button>
        </div>
      </div>
      <div className="container-luxe pb-3 md:hidden">{searchBox}</div>
      <nav className="relative hidden border-t border-line lg:block" aria-label="Primary" onMouseLeave={() => setMega(null)}>
        <ul className="container-luxe flex h-12 items-center justify-center gap-6 whitespace-nowrap text-[14px] font-semibold xl:gap-8">
          <li><NavLink to="/sale" className="text-blush-500 hover:underline">Sale</NavLink></li>
          {top.slice(0, 6).map((c) => (
            <li key={c.id} onMouseEnter={() => setMega(c.id)} className="flex h-full items-center">
              <NavLink to={`/categories/${c.slug}`} className={({ isActive }) => cx('flex h-full items-center border-b-2 hover:text-champagne-600', isActive || mega === c.id ? 'border-champagne-500 text-champagne-600' : 'border-transparent')}>{c.name.split(' & ')[0]}</NavLink>
            </li>
          ))}
          {NAV.map((n) => <li key={n.to} onMouseEnter={() => setMega(null)}><NavLink to={n.to} className={({ isActive }) => cx('hover:text-champagne-600', isActive && 'text-champagne-600')}>{n.label}</NavLink></li>)}
        </ul>
        {mega !== null && (() => {
          const c = top.find((x) => x.id === mega)
          if (!c) return null
          const kids = c.children ?? []
          return (
            <div className="absolute inset-x-0 top-full border-t border-line bg-white shadow-soft animate-fade-up">
              <div className="container-luxe grid grid-cols-[1fr_260px] gap-10 py-8">
                <div>
                  <p className="mb-4 text-xs font-bold uppercase tracking-[0.1em] text-champagne-600">{c.name}</p>
                  <ul className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
                    {kids.map((k) => <li key={k.id}><Link to={`/categories/${k.slug}`} className="hover:text-champagne-600">{k.name}</Link></li>)}
                    <li><Link to={`/categories/${c.slug}`} className="font-semibold text-champagne-600 hover:underline">Shop all {c.name} →</Link></li>
                  </ul>
                  {c.description && <p className="mt-6 max-w-lg text-sm text-charcoal-500">{c.description}</p>}
                </div>
                <Link to={`/categories/${c.slug}`} className="block overflow-hidden rounded-lg bg-ivory-200">
                  {c.image_url && <img src={c.image_url} alt={c.name} className="aspect-square w-full object-cover" />}
                </Link>
              </div>
            </div>
          )
        })()}
      </nav>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-charcoal/40" onClick={() => setOpen(false)} aria-hidden />
          <nav className="absolute inset-y-0 left-0 w-[86%] max-w-sm overflow-y-auto bg-white p-6 animate-fade-up" aria-label="Mobile">
            <div className="mb-6 flex items-center justify-between"><Logo className="text-2xl" /><button aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
            <div className="mb-6 text-sm"><PincodeBar /></div>
            <ul className="divide-y divide-line border-y border-line text-sm font-semibold">
              <li><Link to="/sale" className="block py-3 text-blush-500">Sale</Link></li>
              {top.map((c) => <li key={c.id}><Link to={`/categories/${c.slug}`} className="block py-3">{c.name}</Link></li>)}
              {NAV.map((n) => <li key={n.to}><Link to={n.to} className="block py-3">{n.label}</Link></li>)}
              <li><Link to="/track" className="block py-3">Track order</Link></li>
            </ul>
          </nav>
        </div>
      )}
    </header>
  )
}
