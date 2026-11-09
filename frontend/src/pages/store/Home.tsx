import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Gem, Package, RotateCcw, SearchCheck, ShieldCheck, Truck, Wind } from 'lucide-react'
import { formatINR } from '@/utils/format'
import { Link } from 'react-router-dom'
import { NewsletterForm } from '@/components/store/Footer'
import { GlassImage, ProductGrid, ProductGridSkeleton } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { ButtonLink, SectionHeading } from '@/components/ui'
import { useSettings } from '@/features/catalog/hooks'
import { api } from '@/services/api'
import type { HomeData } from '@/types'

const ICONS: Record<string, typeof Gem> = { wind: Wind, 'search-check': SearchCheck, gem: Gem, package: Package }

export default function Home() {
  const { data, isLoading } = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/public/home') })
  const { data: settings } = useSettings()
  const store = settings?.store
  const sections = data?.sections ?? ['hero', 'categories', 'new_arrivals', 'campaign', 'bestsellers', 'collections', 'story', 'craft', 'packaging', 'reviews', 'faq', 'newsletter']
  const b = data?.blocks ?? {}
  const hero = b.hero?.[0]

  const render: Record<string, () => JSX.Element | null> = {
    hero: () => (
      <section className="relative overflow-hidden bg-gradient-to-br from-champagne-50 via-white to-blush" key="hero">
        <div className="container-luxe grid items-center gap-10 py-14 md:grid-cols-12 md:py-24">
          <div className="md:col-span-5 animate-fade-up">
            <p className="eyebrow mb-5">{store?.tagline ?? 'Glass for the considered home'}</p>
            <h1 className="font-display text-[44px] font-semibold leading-[1.05] md:text-[64px]">{hero?.title ?? 'Glass, quietly considered'}</h1>
            <p className="mt-6 max-w-md text-[16px] leading-relaxed text-charcoal-600">{hero?.subtitle ?? store?.business_description}</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink to={hero?.link_url ?? '/shop'} size="lg">{hero?.link_label ?? 'Shop the collection'}</ButtonLink>
              <ButtonLink to="/new-arrivals" variant="secondary" size="lg">New arrivals</ButtonLink>
            </div>
          </div>
          <div className="md:col-span-7">
            <div className="aspect-[16/11] overflow-hidden rounded-2xl bg-ivory-200">
              <GlassImage src={hero?.image_url ?? '/images/hero/hero-main.svg'} alt={hero?.title ?? 'Glassware collection'} eager className="h-full w-full object-cover" />
            </div>
          </div>
        </div>
        <div className="border-y border-ivory-300 bg-ivory-100">
          <ul className="container-luxe grid grid-cols-2 gap-y-4 py-5 text-sm md:grid-cols-4">
            {[
              { icon: Truck, t: 'Free delivery', d: `On Indian orders over ${formatINR(settings?.shipping.domestic_free_threshold ?? '2000')}` },
              { icon: ShieldCheck, t: 'Secure payment', d: 'Encrypted online checkout' },
              { icon: Package, t: 'Packed with care', d: 'Shock-proof packaging for glass' },
              { icon: RotateCcw, t: 'Easy returns', d: `${settings?.account.return_window_days ?? 7}-day returns & breakage cover` },
            ].map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-champagne-500" aria-hidden />
                <div><p className="font-medium">{t}</p><p className="text-xs text-charcoal-500">{d}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    ),
    categories: () => data?.featured_categories.length ? (
      <section className="container-luxe py-16" key="categories">
        <SectionHeading eyebrow="Explore" title="Shop by category" action={<Link to="/shop" className="text-[11px] uppercase tracking-luxe hover:text-champagne-500">View all <ArrowRight className="inline h-3 w-3" /></Link>} />
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6 md:gap-6">
          {data.featured_categories.map((c) => (
            <Link key={c.id} to={`/categories/${c.slug}`} className="group">
              <div className="mx-auto aspect-square w-full max-w-[180px] overflow-hidden rounded-full border-4 border-champagne-50 bg-ivory-200">
                <GlassImage src={c.image_url} alt={c.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
              </div>
              <p className="mt-3 text-center text-sm font-bold uppercase tracking-[0.05em]">{c.name}</p>
            </Link>
          ))}
        </div>
      </section>
    ) : null,
    new_arrivals: () => (
      <section className="container-luxe py-16" key="new">
        <SectionHeading eyebrow="Just in" title="New arrivals" action={<Link to="/new-arrivals" className="text-[11px] uppercase tracking-luxe hover:text-champagne-500">Shop new <ArrowRight className="inline h-3 w-3" /></Link>} />
        {isLoading ? <ProductGridSkeleton count={4} /> : <ProductGrid products={(data?.new_arrivals ?? []).slice(0, 4)} />}
      </section>
    ),
    campaign: () => b.campaign?.length ? (
      <section className="py-10" key="campaign">
        {b.campaign.map((c) => (
          <div key={c.id} className="container-luxe">
            <div className="grid overflow-hidden bg-charcoal text-ivory md:grid-cols-2">
              <div className="aspect-[4/3] md:aspect-auto"><GlassImage src={c.image_url} alt={c.title} className="h-full w-full object-cover" /></div>
              <div className="flex flex-col justify-center gap-5 p-10 md:p-16">
                <p className="text-[11px] uppercase tracking-luxe text-champagne-300">Seasonal edit</p>
                <h2 className="font-display text-5xl leading-tight">{c.title}</h2>
                <p className="max-w-md text-charcoal-400">{c.subtitle}</p>
                {c.link_url && <div><ButtonLink to={c.link_url} variant="gold">{c.link_label ?? 'Discover'}</ButtonLink></div>}
              </div>
            </div>
          </div>
        ))}
      </section>
    ) : null,
    bestsellers: () => (
      <section className="container-luxe py-16" key="best">
        <SectionHeading eyebrow="Most loved" title="Bestsellers" action={<Link to="/bestsellers" className="text-[11px] uppercase tracking-luxe hover:text-champagne-500">Shop bestsellers <ArrowRight className="inline h-3 w-3" /></Link>} />
        {isLoading ? <ProductGridSkeleton count={4} /> : <ProductGrid products={(data?.bestsellers ?? []).slice(0, 4)} />}
      </section>
    ),
    collections: () => data?.collections.length ? (
      <section className="container-luxe py-16" key="collections">
        <SectionHeading eyebrow="Curated" title="Collections" />
        <div className="grid gap-6 md:grid-cols-3">
          {data.collections.slice(0, 3).map((c) => (
            <Link key={c.slug} to={`/collections/${c.slug}`} className="group">
              <div className="aspect-[4/3] overflow-hidden bg-ivory-200"><GlassImage src={c.image_url} alt={c.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" /></div>
              <p className="mt-4 text-[10px] uppercase tracking-luxe text-champagne-500">{c.kind}</p>
              <h3 className="font-display text-2xl">{c.name}</h3>
              <p className="mt-1 text-sm text-charcoal-500">{c.description}</p>
            </Link>
          ))}
        </div>
      </section>
    ) : null,
    story: () => b.story?.[0] ? (
      <section className="bg-ivory-200/60 py-20" key="story">
        <div className="container-luxe grid items-center gap-12 md:grid-cols-2">
          <div className="aspect-[4/3] overflow-hidden"><GlassImage src={b.story[0].image_url} alt={b.story[0].title} className="h-full w-full object-cover" /></div>
          <div className="max-w-lg">
            <p className="eyebrow mb-4">{b.story[0].subtitle || 'Our story'}</p>
            <h2 className="font-display text-5xl leading-tight">{b.story[0].title}</h2>
            <p className="mt-6 text-[16px] leading-relaxed text-charcoal-600">{b.story[0].body}</p>
            {b.story[0].link_url && <ButtonLink to={b.story[0].link_url} variant="link" className="mt-6">{b.story[0].link_label ?? 'Read more'}</ButtonLink>}
          </div>
        </div>
      </section>
    ) : null,
    craft: () => b.craft?.length ? (
      <section className="container-luxe py-20" key="craft">
        <SectionHeading eyebrow="Craftsmanship & quality" title="Made to be kept" align="center" />
        <div className="grid gap-10 md:grid-cols-3">
          {b.craft.map((c) => {
            const Icon = ICONS[String(c.data.icon)] ?? Gem
            return (
              <div key={c.id} className="text-center">
                <Icon className="mx-auto h-7 w-7 text-champagne" strokeWidth={1.2} aria-hidden />
                <h3 className="mt-5 font-display text-2xl">{c.title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-charcoal-600">{c.body}</p>
              </div>
            )
          })}
        </div>
      </section>
    ) : null,
    packaging: () => b.packaging?.[0] ? (
      <section className="container-luxe py-12" key="packaging">
        <div className="grid items-center gap-10 border border-line bg-white/60 p-8 md:grid-cols-[1fr_1.2fr] md:p-12">
          <div>
            <p className="eyebrow mb-3">{b.packaging[0].subtitle}</p>
            <h2 className="font-display text-4xl">{b.packaging[0].title}</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-charcoal-600">{b.packaging[0].body}</p>
            {b.packaging[0].link_url && <ButtonLink to={b.packaging[0].link_url} variant="link" className="mt-5">{b.packaging[0].link_label}</ButtonLink>}
          </div>
          <div className="aspect-[16/10] overflow-hidden"><GlassImage src={b.packaging[0].image_url} alt={b.packaging[0].title} className="h-full w-full object-cover" /></div>
        </div>
      </section>
    ) : null,
    reviews: () => data?.reviews.length ? (
      <section className="container-luxe py-16" key="reviews">
        <SectionHeading eyebrow="From our customers" title="Kind words" align="center" />
        <div className="grid gap-6 md:grid-cols-3">
          {data.reviews.slice(0, 3).map((r, i) => (
            <figure key={i} className="border border-line bg-white/60 p-8">
              <p className="text-champagne" aria-label={`${r.rating} out of 5 stars`}>{'★'.repeat(r.rating)}</p>
              <blockquote className="mt-4 font-display text-xl leading-snug">“{r.title || r.body}”</blockquote>
              {r.title && <p className="mt-3 text-sm text-charcoal-600">{r.body}</p>}
              <figcaption className="mt-5 text-[11px] uppercase tracking-luxe text-charcoal-500">{r.display_name} · Verified purchase</figcaption>
            </figure>
          ))}
        </div>
      </section>
    ) : null,
    faq: () => b.faq?.length ? (
      <section className="container-luxe py-16" key="faq">
        <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
          <div><p className="eyebrow mb-3">Good to know</p><h2 className="font-display text-4xl">Questions, answered</h2>
            <Link to="/faq" className="mt-4 inline-block text-[11px] uppercase tracking-luxe hover:text-champagne-500">All FAQs <ArrowRight className="inline h-3 w-3" /></Link></div>
          <div className="divide-y divide-line border-y border-line">
            {b.faq.slice(0, 4).map((f) => (
              <details key={f.id} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-display text-xl">{f.title}<span className="text-champagne transition group-open:rotate-45">+</span></summary>
                <p className="mt-3 text-[15px] leading-relaxed text-charcoal-600">{f.body}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    ) : null,
    newsletter: () => settings?.content.newsletter_enabled ? (
      <section className="container-luxe py-16" key="newsletter">
        <div className="mx-auto max-w-xl text-center">
          <p className="eyebrow mb-3">Newsletter</p>
          <h2 className="font-display text-4xl">{settings.content.newsletter_heading}</h2>
          <p className="mb-8 mt-3 text-charcoal-600">{settings.content.newsletter_text}</p>
          <NewsletterForm />
        </div>
      </section>
    ) : null,
  }

  const promo = b.banner?.[0]
  return (
    <>
      <Seo jsonLd={{ '@context': 'https://schema.org', '@type': 'Organization', name: store?.brand_name, url: window.location.origin,
        sameAs: Object.values(store?.social ?? {}).filter(Boolean) }} />
      {sections.map((s) => render[s]?.())}
      {promo && (
        <section className="container-luxe pb-4">
          <Link to={promo.link_url ?? '/shipping-policy'} className="flex flex-col items-center justify-between gap-3 border-y border-line py-6 text-center md:flex-row md:text-left">
            <span className="font-display text-2xl">{promo.title}</span>
            <span className="text-sm text-charcoal-600">{promo.subtitle}</span>
            <span className="text-[11px] uppercase tracking-luxe text-champagne-500">{promo.link_label} →</span>
          </Link>
        </section>
      )}
    </>
  )
}
