import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Heart, ShoppingBag } from 'lucide-react'
import { useCart } from '@/features/cart/CartContext'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useToast } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { api, errorMessage } from '@/services/api'
import type { ProductCard as P } from '@/types'
import { cx, formatINR } from '@/utils/format'

export function GlassImage({ src, alt, className, eager }: { src?: string | null; alt: string; className?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={cx('flex items-center justify-center bg-gradient-to-b from-ivory-100 to-ivory-300', className)} role="img" aria-label={alt}>
        <svg viewBox="0 0 64 80" className="h-1/3 w-1/3 text-champagne-300" aria-hidden><path d="M24 6h16l-2 12c9 6 12 15 12 26 0 14-8 22-18 22S14 58 14 44c0-11 3-20 12-26z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </div>
    )
  }
  return <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} className={className} />
}

export function useWishlist() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['account', 'wishlist'],
    enabled: !!user,
    queryFn: () => api.get<P[]>('/customer/wishlist'),
  })
}

export function WishlistButton({ productId, className }: { productId: number; className?: string }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const { data } = useWishlist()
  const saved = !!data?.some((p) => p.id === productId)
  const m = useMutation({
    mutationFn: () => saved ? api.del(`/customer/wishlist/${productId}`) : api.post(`/customer/wishlist/${productId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['account', 'wishlist'] }); toast(saved ? 'Removed from wishlist' : 'Saved to wishlist') },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
  return (
    <button type="button" aria-pressed={saved} aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!user) { nav('/login?next=' + encodeURIComponent(location.pathname)); return } m.mutate() }}
      className={cx('flex h-9 w-9 items-center justify-center rounded-full bg-ivory/90 text-charcoal transition hover:bg-white', className)}>
      <Heart className={cx('h-4 w-4', saved && 'fill-champagne text-champagne')} />
    </button>
  )
}

function AddToCart({ product }: { product: P }) {
  const { add, setDrawerOpen } = useCart()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const sold = product.stock_state === 'out_of_stock'
  const onClick = async () => {
    if (product.has_variants || !product.default_variant_id) { nav(`/products/${product.slug}`); return }
    setBusy(true)
    try { await add(product.default_variant_id, 1); setDrawerOpen(true) } catch (err) { toast(errorMessage(err), 'bad') } finally { setBusy(false) }
  }
  return (
    <button type="button" onClick={onClick} disabled={busy || sold}
      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-champagne-500 text-[12px] font-bold uppercase tracking-[0.08em] text-champagne-600 transition hover:bg-champagne-500 hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:bg-ivory-200 disabled:text-charcoal-400">
      {sold ? 'Sold out' : busy ? 'Adding…' : product.has_variants ? 'Choose options' : <><ShoppingBag className="h-4 w-4" aria-hidden />Add to cart</>}
    </button>
  )
}

function percentOff(p: P) {
  const c = Number(p.compare_at_price), v = Number(p.price)
  return c > v ? Math.round(((c - v) / c) * 100) : 0
}

export function ProductCard({ product, eager }: { product: P; eager?: boolean }) {
  const off = percentOff(product)
  return (
    <article className="group relative flex flex-col rounded-lg bg-white p-2 transition hover:shadow-soft">
      <Link to={`/products/${product.slug}`} className="block">
        <div className="relative aspect-square overflow-hidden rounded-md bg-ivory-200">
          <GlassImage src={product.image?.url} alt={product.image?.alt ?? product.name} eager={eager}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
          {product.hover_image && (
            <GlassImage src={product.hover_image.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          )}
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {off > 0 && <span className="rounded bg-blush-500 px-2 py-0.5 text-[11px] font-bold text-white">-{off}%</span>}
            {product.badge && <span className="rounded bg-white/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-champagne-600">{product.badge}</span>}
            {!product.badge && product.is_new_arrival && <span className="rounded bg-champagne-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">New</span>}
          </div>
          {product.stock_state === 'low_stock' && <span className="absolute inset-x-0 bottom-0 bg-white/90 py-1 text-center text-[11px] font-semibold text-blush-500">Only a few left</span>}
        </div>
        <div className="mt-3 px-1">
          <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-charcoal group-hover:text-champagne-600">{product.name}</h3>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-base font-bold">{formatINR(product.price)}</span>
            {off > 0 && <><s className="text-charcoal-400">{formatINR(product.compare_at_price!)}</s><span className="text-xs font-bold text-blush-500">({off}% Off)</span></>}
          </p>
        </div>
      </Link>
      <div className="mt-auto px-1"><AddToCart product={product} /></div>
      <WishlistButton productId={product.id} className="absolute right-4 top-4 shadow-sm" />
    </article>
  )
}

export function ProductGrid({ products, columns = 4 }: { products: P[]; columns?: 3 | 4 }) {
  return (
    <div className={cx('grid grid-cols-2 gap-3 md:gap-5', columns === 4 ? 'lg:grid-cols-4' : 'md:grid-cols-3 xl:grid-cols-4')}>
      {products.map((p, i) => <ProductCard key={p.id} product={p} eager={i < 4} />)}
    </div>
  )
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:gap-x-8 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i}><div className="aspect-square animate-pulse rounded-md bg-ivory-200" /><div className="mt-4 h-4 w-2/3 animate-pulse bg-ivory-200" /><div className="mt-2 h-3 w-1/3 animate-pulse bg-ivory-200" /></div>
      ))}
    </div>
  )
}
