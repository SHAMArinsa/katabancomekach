import { useQuery } from '@tanstack/react-query'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ProductGrid, ProductGridSkeleton } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { Button, Checkbox, Empty, Input, Pagination, Select } from '@/components/ui'
import { useCategories } from '@/features/catalog/hooks'
import { api } from '@/services/api'
import type { Category, Paged, ProductCard } from '@/types'

type Mode = 'all' | 'category' | 'search' | 'new' | 'bestsellers' | 'featured' | 'sale' | 'gifts' | 'collection'

const TITLES: Record<Mode, [string, string]> = {
  all: ['Shop all', 'Every piece in the house.'],
  category: ['', ''],
  search: ['Search', ''],
  new: ['New arrivals', 'The latest pieces to arrive in the studio.'],
  bestsellers: ['Bestsellers', 'The pieces our customers return to.'],
  featured: ['Featured', 'Selected by the studio.'],
  sale: ['Sale', 'Selected pieces at a gentler price.'],
  gifts: ['Gifts', 'Considered gifts, wrapped by hand.'],
  collection: ['', ''],
}

type ListResponse = Paged<ProductCard> & { facets: { glass_types: string[]; colors: string[] } }

export default function Listing({ mode }: { mode: Mode }) {
  const { slug } = useParams()
  const [sp, setSp] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { data: cats } = useCategories()
  const page = Number(sp.get('page') || 1)
  const sort = sp.get('sort') || (mode === 'new' ? 'newest' : 'featured')
  const q = sp.get('q') || ''

  const query = useMemo(() => ({
    q: mode === 'search' ? q : undefined,
    category: mode === 'category' ? slug : (sp.get('category') || undefined),
    collection: mode === 'collection' ? slug : undefined,
    collection_kind: mode === 'gifts' ? 'gift' : undefined,
    new: mode === 'new' || undefined,
    bestseller: mode === 'bestsellers' || undefined,
    featured: mode === 'featured' || undefined,
    on_sale: mode === 'sale' || sp.get('on_sale') === '1' || undefined,
    in_stock: sp.get('in_stock') === '1' || undefined,
    glass_type: sp.get('glass_type') || undefined,
    color: sp.get('color') || undefined,
    min_price: sp.get('min') || undefined,
    max_price: sp.get('max') || undefined,
    sort, page, page_size: 24,
  }), [mode, slug, sp, q, sort, page])

  const { data, isLoading, error } = useQuery({
    queryKey: ['products', query],
    queryFn: () => api.get<ListResponse>('/public/products', query),
    placeholderData: (p) => p,
  })
  const catQ = useQuery({
    queryKey: ['category', slug], enabled: mode === 'category' && !!slug,
    queryFn: () => api.get<Category>(`/public/categories/${slug}`),
  })
  const colQ = useQuery({
    queryKey: ['collection', slug], enabled: mode === 'collection' && !!slug,
    queryFn: () => api.get<{ name: string; description: string }>(`/public/collections/${slug}`),
  })

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v); else n.delete(k)
    if (k !== 'page') n.delete('page')
    setSp(n)
  }

  let [title, subtitle] = TITLES[mode]
  if (mode === 'category') { title = catQ.data?.name ?? ''; subtitle = catQ.data?.description ?? '' }
  if (mode === 'collection') { title = colQ.data?.name ?? ''; subtitle = colQ.data?.description ?? '' }
  if (mode === 'search') { title = q ? `Results for “${q}”` : 'Search'; subtitle = data ? `${data.total} piece${data.total === 1 ? '' : 's'}` : '' }

  const notFound = (mode === 'category' && catQ.isError) || (mode === 'collection' && colQ.isError)
  const activeFilters = ['glass_type', 'color', 'min', 'max', 'in_stock', 'on_sale'].filter((k) => sp.get(k))

  const Group = ({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) => (
    <details open={open} className="group border-b border-line py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-bold uppercase tracking-[0.06em]">
        {title}<ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
  const checks = (key: string, values: string[]) => (
    <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
      {values.map((v) => (
        <li key={v}><Checkbox label={v} checked={sp.get(key) === v} onChange={(e) => set(key, e.target.checked ? v : null)} /></li>
      ))}
    </ul>
  )
  const filters = (
    <div>
      <div className="flex items-center justify-between pb-2">
        <p className="text-base font-bold">Filters</p>
        {activeFilters.length > 0 && <button className="text-xs font-semibold text-champagne-600 hover:underline" onClick={() => setSp(new URLSearchParams(mode === 'search' ? { q } : {}))}>Clear all</button>}
      </div>
      {mode !== 'category' && cats && (
        <Group title="Category">
          <ul className="space-y-2 text-sm">{cats.map((c) => <li key={c.id}><Link to={`/categories/${c.slug}`} className="hover:text-champagne-600">{c.name}</Link></li>)}</ul>
        </Group>
      )}
      {!!data?.facets.glass_types.length && <Group title="Type">{checks('glass_type', data.facets.glass_types)}</Group>}
      {!!data?.facets.colors.length && <Group title="Colour">{checks('color', data.facets.colors)}</Group>}
      <Group title="Price">
        <div className="flex items-center gap-2">
          <Input inputMode="numeric" placeholder="₹ Min" defaultValue={sp.get('min') ?? ''} aria-label="Minimum price" onBlur={(e) => set('min', e.target.value.replace(/\D/g, '') || null)} />
          <span>–</span>
          <Input inputMode="numeric" placeholder="₹ Max" defaultValue={sp.get('max') ?? ''} aria-label="Maximum price" onBlur={(e) => set('max', e.target.value.replace(/\D/g, '') || null)} />
        </div>
      </Group>
      <Group title="Availability">
        <div className="space-y-2 text-sm">
          <Checkbox label="In stock only" checked={sp.get('in_stock') === '1'} onChange={(e) => set('in_stock', e.target.checked ? '1' : null)} />
          {mode !== 'sale' && <Checkbox label="On sale" checked={sp.get('on_sale') === '1'} onChange={(e) => set('on_sale', e.target.checked ? '1' : null)} />}
        </div>
      </Group>
    </div>
  )
  const pills = mode === 'category' ? (catQ.data?.children ?? []) : (cats ?? [])

  if (notFound) return <div className="container-luxe py-24"><Empty title="Not found">This page is no longer available.</Empty></div>

  return (
    <div className="container-luxe py-6 md:py-8">
      <Seo title={title || 'Shop'} description={subtitle || undefined} noindex={mode === 'search'} />
      <nav className="mb-4 text-xs text-charcoal-500" aria-label="Breadcrumb">
        <Link to="/" className="hover:text-champagne-600">Home</Link> <span className="mx-1.5">›</span>
        {catQ.data?.parent && <><Link to={`/categories/${catQ.data.parent.slug}`} className="hover:text-champagne-600">{catQ.data.parent.name}</Link><span className="mx-1.5">›</span></>}
        <span className="text-charcoal">{title || '…'}</span>
      </nav>
      <header className="mb-5">
        <h1 className="font-display text-3xl font-semibold md:text-4xl">{title || ' '}</h1>
        {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-charcoal-600">{subtitle}</p>}
      </header>
      {pills.length > 0 && (
        <div className="-mx-5 mb-6 flex gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:px-0">
          {pills.map((c) => (
            <Link key={c.id} to={`/categories/${c.slug}`} className="flex shrink-0 flex-col items-center gap-2 text-center">
              <span className="h-20 w-20 overflow-hidden rounded-full border-2 border-champagne-100 bg-ivory-200 transition hover:border-champagne-400 md:h-24 md:w-24">
                {c.image_url && <img src={c.image_url} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="w-24 text-xs font-semibold uppercase leading-4 tracking-[0.04em]">{c.name}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[250px_1fr]">
        <aside className="hidden self-start lg:sticky lg:top-44 lg:block" aria-label="Filters">{filters}</aside>
        <div>
          <div className="mb-5 flex items-center justify-between gap-4 rounded-lg bg-ivory-200 px-4 py-2.5">
            <button className="flex items-center gap-2 text-sm font-semibold lg:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" /> Filters {activeFilters.length > 0 && `(${activeFilters.length})`}
            </button>
            <p className="hidden text-sm lg:block"><b>{data?.total ?? '…'}</b> results found</p>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
              Sort by
              <Select value={sort} onChange={(e) => set('sort', e.target.value)} className="h-9 w-36 bg-white font-normal md:w-48">
                <option value="featured">Relevance</option><option value="newest">What’s new</option>
                <option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name A–Z</option>
              </Select>
            </label>
          </div>
          {activeFilters.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              {activeFilters.map((k) => (
                <button key={k} onClick={() => set(k, null)} className="flex items-center gap-1 rounded-full bg-champagne-50 px-3 py-1 text-xs font-semibold text-champagne-600">
                  {k.replace('_', ' ')}: {sp.get(k)} <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
          {error ? <Empty title="Something went wrong">Please refresh the page.</Empty>
            : isLoading ? <ProductGridSkeleton />
              : data && data.items.length === 0 ? (
                <Empty title="No products found" action={<Button variant="secondary" onClick={() => setSp(new URLSearchParams(mode === 'search' ? { q } : {}))}>Clear filters</Button>}>
                  {mode === 'search' ? 'Try a different word — “vase”, “amber” or “tumbler”.' : 'No products match these filters.'}
                </Empty>
              ) : data && <ProductGrid products={data.items} columns={3} />}
          {data && <Pagination page={page} pages={data.pages} onPage={(p) => { set('page', String(p)); window.scrollTo({ top: 0 }) }} />}
        </div>
      </div>
      {filtersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-charcoal/40" onClick={() => setFiltersOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[86%] max-w-sm overflow-y-auto bg-white p-6">
            <div className="mb-2 flex justify-end"><button onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X className="h-5 w-5" /></button></div>
            {filters}
            <Button block className="mt-8" onClick={() => setFiltersOpen(false)}>Show results</Button>
          </div>
        </div>
      )}
    </div>
  )
}
