import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Gift, Globe2, Package, ShieldCheck, Truck } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { QtyStepper } from '@/components/store/CartDrawer'
import { GlassImage, ProductGrid, WishlistButton } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { Badge, Button, Checkbox, Empty, PageLoader, Price, SectionHeading, useToast } from '@/components/ui'
import { useCart } from '@/features/cart/CartContext'
import { useSettings } from '@/features/catalog/hooks'
import { api, errorMessage } from '@/services/api'
import type { ProductDetail } from '@/types'
import { cx, formatINR } from '@/utils/format'

const FRAGILITY: Record<string, string> = {
  standard: 'Sturdy glass — packed with protective inserts.',
  fragile: 'Fragile — double-boxed with moulded inserts.',
  highly_fragile: 'Highly fragile — packed by hand with extra protection; some international destinations may be restricted.',
}

export default function ProductPage() {
  const { slug } = useParams()
  const { data: p, isLoading, error } = useQuery({ queryKey: ['product', slug], queryFn: () => api.get<ProductDetail>(`/public/products/${slug}`) })
  const { data: settings } = useSettings()
  const { add, setDrawerOpen } = useCart()
  const toast = useToast()
  const nav = useNavigate()
  const [variantId, setVariantId] = useState<number | null>(null)
  const [qty, setQty] = useState(1)
  const [gift, setGift] = useState(false)
  const [img, setImg] = useState(0)
  const [busy, setBusy] = useState<'add' | 'buy' | null>(null)

  useEffect(() => { setImg(0); setQty(1); setGift(false); setVariantId(null) }, [slug])
  if (isLoading) return <PageLoader />
  if (error || !p) return <div className="container-luxe py-24"><Empty title="This piece is not available">It may have sold out or been retired. <Link to="/shop" className="underline">Explore the collection</Link>.</Empty></div>

  const variant = p.variants.find((v) => v.id === (variantId ?? p.default_variant_id)) ?? p.variants[0]
  const max = Math.max(0, Math.min(variant?.available_quantity ?? 0, 99))
  const soldOut = !variant || max <= 0
  const images = p.images.length ? p.images : [{ id: 0, url: '', alt: p.name, media_type: 'image', position: 0 }]

  const addToBag = async (buyNow: boolean) => {
    if (!variant) return
    setBusy(buyNow ? 'buy' : 'add')
    try {
      await add(variant.id, qty, gift)
      if (buyNow) nav('/checkout')
      else { setDrawerOpen(true); toast(`${p.name} added to your bag`) }
    } catch (e) {
      toast(e instanceof Error && !(e as { status?: number }).status ? e.message : errorMessage(e), 'bad')
    } finally { setBusy(null) }
  }

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: variant?.sku ?? p.sku,
    description: p.seo_description || p.short_description, image: p.images.map((i) => new URL(i.url, window.location.origin).toString()),
    category: p.category?.name, brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    offers: { '@type': 'Offer', priceCurrency: 'INR', price: variant?.price ?? p.price, url: window.location.href,
      availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' },
    ...(p.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating.average, reviewCount: p.rating.count } } : {}),
  }

  const specs: [string, string | null | undefined][] = [
    ['Glass', p.glass_type], ['Material', p.material], ['Colour', p.color], ['Finish', p.finish],
    ['Dimensions', p.dimensions], ['Capacity', p.capacity], ['Weight', p.weight_grams ? `${p.weight_grams} g` : null],
    ...p.attributes.filter((a) => a.name !== 'Glass type').map((a) => [a.name, a.value] as [string, string]),
  ]

  return (
    <div className="container-luxe py-10 md:py-14">
      <Seo title={p.seo_title} description={p.seo_description} image={p.images[0]?.url} type="product" jsonLd={jsonLd} />
      <nav className="mb-8 text-[11px] uppercase tracking-luxe text-charcoal-500" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-charcoal">Home</Link>
        {p.breadcrumbs?.map((b) => <span key={b.slug}><span className="mx-2">/</span><Link to={`/categories/${b.slug}`} className="hover:text-charcoal">{b.name}</Link></span>)}
        <span className="mx-2">/</span><span className="text-charcoal">{p.name}</span>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        <div className="grid gap-3 md:grid-cols-[80px_1fr]">
          <div className="order-2 flex gap-3 md:order-1 md:flex-col">
            {images.map((im, i) => (
              <button key={im.id} onClick={() => setImg(i)} aria-label={`Show image ${i + 1}`} aria-current={i === img}
                className={cx('w-20 shrink-0 border transition', i === img ? 'border-charcoal' : 'border-transparent opacity-70 hover:opacity-100')}>
                <GlassImage src={im.url} alt="" className="aspect-[4/5] w-full object-cover" />
              </button>
            ))}
          </div>
          <div className="relative order-1 aspect-[4/5] overflow-hidden bg-ivory-200 md:order-2">
            {images[img].media_type === 'video'
              ? <video src={images[img].url} controls className="h-full w-full object-cover" />
              : <GlassImage src={images[img].url} alt={images[img].alt} eager className="h-full w-full object-cover" />}
            <WishlistButton productId={p.id} className="absolute right-4 top-4" />
          </div>
        </div>

        <div className="lg:sticky lg:top-28 lg:self-start">
          {p.category && <Link to={`/categories/${p.category.slug}`} className="eyebrow">{p.category.name}</Link>}
          <h1 className="mt-3 font-display text-4xl leading-tight md:text-5xl">{p.name}</h1>
          {p.rating && <p className="mt-2 text-sm text-charcoal-600"><span className="text-champagne">{'★'.repeat(Math.round(p.rating.average))}</span> {p.rating.average} · {p.rating.count} verified review{p.rating.count > 1 ? 's' : ''}</p>}
          <div className="mt-5 flex items-center gap-3">
            <Price value={variant?.price ?? p.price} compareAt={settings?.pricing.show_compare_at_price === false ? null : (variant?.compare_at_price ?? p.compare_at_price)} size="lg" />
            {p.on_sale && <Badge tone="gold">Sale</Badge>}
          </div>
          <p className="mt-1 text-xs text-charcoal-500">{settings?.pricing.prices_include_tax ? 'Inclusive of GST for delivery within India.' : 'Taxes calculated at checkout.'}</p>
          <p className="mt-6 text-[15px] leading-relaxed text-charcoal-700">{p.short_description}</p>

          {p.variants.length > 1 && (
            <fieldset className="mt-7">
              <legend className="mb-3 text-[11px] uppercase tracking-luxe text-charcoal-500">Option</legend>
              <div className="flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <button key={v.id} onClick={() => { setVariantId(v.id); setQty(1) }} disabled={!v.available} aria-pressed={v.id === variant?.id}
                    className={cx('border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:line-through disabled:opacity-40',
                      v.id === variant?.id ? 'border-charcoal bg-charcoal text-ivory' : 'border-line hover:border-charcoal')}>{v.name}</button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="mt-7 space-y-4">
            <p className={cx('text-sm', soldOut ? 'text-red-700' : max <= 5 ? 'text-champagne-600' : 'text-emerald-800')}>
              {soldOut ? 'Currently sold out' : max <= 5 ? `Only ${max} left` : 'In stock — ready to dispatch'}
            </p>
            {p.gift_wrap_available && !soldOut && (
              <Checkbox checked={gift} onChange={(e) => setGift(e.target.checked)}
                label={<span className="flex items-center gap-2"><Gift className="h-4 w-4 text-champagne" /> Add gift packaging (+{formatINR(p.gift_wrap_price)} per piece)</span>} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <QtyStepper value={qty} max={Math.max(1, max)} onChange={setQty} disabled={soldOut} />
              <Button className="min-w-[180px] flex-1" disabled={soldOut} loading={busy === 'add'} onClick={() => addToBag(false)}>Add to bag</Button>
            </div>
            <Button variant="secondary" block disabled={soldOut} loading={busy === 'buy'} onClick={() => addToBag(true)}>Buy now</Button>
          </div>

          <ul className="mt-8 space-y-3 border-t border-line pt-6 text-sm text-charcoal-700">
            <li className="flex gap-3"><Truck className="h-4 w-4 shrink-0 text-champagne" />
              <span>Complimentary delivery in India from {formatINR(settings?.shipping.domestic_free_threshold)}; below that the courier collects shipping from the recipient. Paid online — no cash on delivery.</span></li>
            <li className="flex gap-3"><Globe2 className="h-4 w-4 shrink-0 text-champagne" />
              <span>{p.ships_internationally ? `Ships internationally — complimentary from ${formatINR(settings?.shipping.international_free_threshold)}. Import duties may apply.` : 'Ships within India only.'}</span></li>
            <li className="flex gap-3"><Package className="h-4 w-4 shrink-0 text-champagne" /><span>{FRAGILITY[p.fragility]}</span></li>
            <li className="flex gap-3"><ShieldCheck className="h-4 w-4 shrink-0 text-champagne" /><span>Report transit damage within {settings?.account.damage_claim_window_hours ?? 48} hours for a replacement or refund.</span></li>
          </ul>

          <div className="mt-8 divide-y divide-line border-y border-line">
            <details open className="py-5">
              <summary className="cursor-pointer list-none text-[11px] uppercase tracking-luxe">Description</summary>
              <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-charcoal-700">{p.description.split('\n\n').map((para, i) => <p key={i}>{para}</p>)}</div>
            </details>
            <details className="py-5">
              <summary className="cursor-pointer list-none text-[11px] uppercase tracking-luxe">Specifications</summary>
              <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-2 text-sm">
                {specs.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className="text-charcoal-500">{k}</dt><dd>{v}</dd></Fragment>)}
                <dt className="text-charcoal-500">SKU</dt><dd>{variant?.sku ?? p.sku}</dd>
              </dl>
            </details>
            <details className="py-5">
              <summary className="cursor-pointer list-none text-[11px] uppercase tracking-luxe">Care</summary>
              <p className="mt-4 flex gap-3 text-sm leading-relaxed text-charcoal-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-champagne" />{p.care_instructions || 'Hand wash with care.'}</p>
            </details>
          </div>
        </div>
      </div>

      {p.reviews && p.reviews.length > 0 && (
        <section className="mt-24">
          <SectionHeading eyebrow="Verified buyers" title="Reviews" />
          <div className="grid gap-6 md:grid-cols-2">
            {p.reviews.map((r, i) => (
              <div key={i} className="border border-line bg-white/60 p-6">
                <p className="text-champagne" aria-label={`${r.rating} of 5`}>{'★'.repeat(r.rating)}<span className="text-ivory-300">{'★'.repeat(5 - r.rating)}</span></p>
                {r.title && <p className="mt-3 font-display text-xl">{r.title}</p>}
                <p className="mt-2 text-sm text-charcoal-700">{r.body}</p>
                <p className="mt-4 text-[11px] uppercase tracking-luxe text-charcoal-500">{r.display_name}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {p.related && p.related.length > 0 && (
        <section className="mt-24">
          <SectionHeading eyebrow="You may also like" title="Related pieces" />
          <ProductGrid products={p.related} />
        </section>
      )}
    </div>
  )
}
