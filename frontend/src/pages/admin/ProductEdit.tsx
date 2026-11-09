import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, RefreshCw, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { GlassImage } from '@/components/store/ProductCard'
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, Dialog, Field, Input, PageLoader, Select, StatusBadge, Table, Td, Textarea, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { Category, ProductDetail, Variant } from '@/types'
import { formatINR } from '@/utils/format'

type AdminProduct = ProductDetail & {
  status: string; category_id: number | null; base_price: string; raw_compare_at_price: string | null; sale_price: string | null
  sale_starts_at: string | null; sale_ends_at: string | null; sale_active: boolean; tax_class: string; hs_code: string | null
  low_stock_threshold: number; package_weight_grams: number | null; package_length_cm: string | null; package_width_cm: string | null
  package_height_cm: string | null; blocked_countries: string[]; search_keywords: string; raw_seo_title: string | null
  raw_seo_description: string | null; collection_ids: number[]; on_hand: number; reserved: number
}
type Form = Record<string, string | boolean | number | null | string[] | number[] | { name: string; value: string }[]>

const TEXT = (k: string, label: string, extra: Partial<{ type: string; hint: string; required: boolean }> = {}) => ({ k, label, ...extra })

function toForm(p?: AdminProduct): Form {
  if (!p) return { name: '', sku: '', price: '', status: 'draft', fragility: 'fragile', tax_class: 'standard', country_of_origin: 'IN', gift_wrap_available: true, gift_wrap_price: '150', ships_internationally: true, low_stock_threshold: 5, initial_stock: 0, attributes: [], collection_ids: [], blocked_countries: [] }
  const local = (iso: string | null) => (iso ? iso.slice(0, 16) : '')
  return {
    name: p.name, slug: p.slug, sku: p.sku, short_description: p.short_description, description: p.description,
    category_id: p.category_id ?? '', brand: p.brand ?? '', glass_type: p.glass_type ?? '', material: p.material ?? '', color: p.color ?? '',
    finish: p.finish ?? '', dimensions: p.dimensions ?? '', capacity: p.capacity ?? '', weight_grams: p.weight_grams ?? '',
    package_weight_grams: p.package_weight_grams ?? '', package_length_cm: p.package_length_cm ?? '', package_width_cm: p.package_width_cm ?? '',
    package_height_cm: p.package_height_cm ?? '', fragility: p.fragility, care_instructions: p.care_instructions, price: p.base_price,
    compare_at_price: p.raw_compare_at_price ?? '', sale_price: p.sale_price ?? '', sale_starts_at: local(p.sale_starts_at), sale_ends_at: local(p.sale_ends_at),
    tax_class: p.tax_class, hs_code: p.hs_code ?? '', country_of_origin: p.country_of_origin, low_stock_threshold: p.low_stock_threshold,
    gift_wrap_available: p.gift_wrap_available, gift_wrap_price: p.gift_wrap_price, ships_internationally: p.ships_internationally,
    blocked_countries: p.blocked_countries, search_keywords: p.search_keywords, seo_title: p.raw_seo_title ?? '', seo_description: p.raw_seo_description ?? '',
    is_featured: p.is_featured, is_bestseller: p.is_bestseller, is_new_arrival: p.is_new_arrival, badge: p.badge ?? '',
    collection_ids: p.collection_ids, attributes: p.attributes,
  }
}

function toPayload(f: Form, creating: boolean) {
  const out: Record<string, unknown> = {}
  const nullable = ['compare_at_price', 'sale_price', 'sale_starts_at', 'sale_ends_at', 'weight_grams', 'package_weight_grams', 'package_length_cm', 'package_width_cm', 'package_height_cm', 'hs_code', 'brand', 'glass_type', 'material', 'color', 'finish', 'dimensions', 'capacity', 'seo_title', 'seo_description', 'badge', 'category_id']
  for (const [k, v] of Object.entries(f)) {
    if (!creating && k === 'initial_stock') continue
    if (creating && k === 'slug' && !v) continue
    if (v === '' && nullable.includes(k)) out[k] = null
    else if (['sale_starts_at', 'sale_ends_at'].includes(k) && v) out[k] = new Date(String(v)).toISOString()
    else if (['category_id', 'weight_grams', 'package_weight_grams', 'low_stock_threshold', 'initial_stock'].includes(k) && v !== '' && v !== null) out[k] = Number(v)
    else out[k] = v
  }
  return out
}

export default function ProductEdit() {
  const { id } = useParams()
  const creating = !id
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAdmin()
  const key = ['admin', 'product', id]
  const { data: p, isLoading } = useQuery({ queryKey: key, enabled: !creating, queryFn: () => adminApi.get<AdminProduct>(`/admin/products/${id}`) })
  const cats = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => adminApi.get<Category[]>('/admin/categories') })
  const cols = useQuery({ queryKey: ['admin', 'collections'], queryFn: () => adminApi.get<{ id: number; name: string }[]>('/admin/collections') })
  const [f, setF] = useState<Form>(toForm())
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [variantDialog, setVariantDialog] = useState<Variant | 'new' | null>(null)
  useEffect(() => { if (p) setF(toForm(p)) }, [p])
  const set = (k: string, v: Form[string]) => setF((x) => ({ ...x, [k]: v }))
  const done = (d: AdminProduct) => { qc.setQueryData(['admin', 'product', String(d.id)], d); qc.invalidateQueries({ queryKey: ['admin', 'products'] }) }

  const save = useMutation({
    mutationFn: () => creating ? adminApi.post<AdminProduct>('/admin/products', toPayload(f, true)) : adminApi.patch<AdminProduct>(`/admin/products/${id}`, toPayload(f, false)),
    onSuccess: (d) => { done(d); setErr(null); toast('Product saved'); if (creating) nav(`/admin/products/${d.id}`, { replace: true }) },
    onError: (e) => setErr(errorMessage(e)),
  })
  const status = useMutation({
    mutationFn: (s: string) => adminApi.post<AdminProduct>(`/admin/products/${id}/status`, { status: s }),
    onSuccess: (d) => { done(d); toast(`Product ${d.status}`) }, onError: (e) => setErr(errorMessage(e)),
  })
  const del = useMutation({
    mutationFn: () => adminApi.del<{ result: string; message: string | null }>(`/admin/products/${id}`),
    onSuccess: (r) => { toast(r.message ?? 'Product deleted'); qc.invalidateQueries({ queryKey: ['admin', 'products'] }); nav('/admin/products') },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
  const media = useMutation({
    mutationFn: (fn: () => Promise<AdminProduct>) => fn(),
    onSuccess: (d) => done(d), onError: (e) => toast(errorMessage(e), 'bad'),
  })

  if (!creating && (isLoading || !p)) return <PageLoader />
  const ed = can('products.write')
  const txt = (def: ReturnType<typeof TEXT>) => (
    <Field key={def.k} label={def.label} htmlFor={`pf-${def.k}`} hint={def.hint} required={def.required}>
      <Input id={`pf-${def.k}`} type={def.type ?? 'text'} value={String(f[def.k] ?? '')} onChange={(e) => set(def.k, e.target.value)} disabled={!ed} />
    </Field>
  )
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  const upload = (file: File) => { const fd = new FormData(); fd.set('file', file); fd.set('alt_text', String(f.name)); media.mutate(() => adminApi.upload<AdminProduct>(`/admin/products/${id}/images`, fd)) }
  const imgs = p?.images ?? []
  const move = (i: number, d: number) => { const ids = imgs.map((x) => x.id); const [m] = ids.splice(i, 1); ids.splice(i + d, 0, m); media.mutate(() => adminApi.post<AdminProduct>(`/admin/products/${id}/images/reorder`, { ids })) }

  return (
    <AdminPage title={creating ? 'New product' : String(p!.name)}
      subtitle={!creating && <span className="flex items-center gap-2"><StatusBadge status={p!.status} /> {p!.sale_active && <Badge tone="gold">Sale active</Badge>} On hand {p!.on_hand} · reserved {p!.reserved}</span>}
      actions={!creating && <>
        <a href={`/products/${p!.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 px-3 text-xs uppercase tracking-[0.14em] hover:underline"><ExternalLink className="h-3.5 w-3.5" /> {p!.status === 'published' ? 'View' : 'Preview below'}</a>
        {can('products.publish') && p!.status !== 'published' && <Button size="sm" onClick={() => status.mutate('published')} loading={status.isPending}>Publish</Button>}
        {can('products.publish') && p!.status === 'published' && <Button size="sm" variant="secondary" onClick={() => status.mutate('draft')}>Unpublish</Button>}
        {can('products.publish') && p!.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => status.mutate('archived')}>Archive</Button>}
        {can('products.publish') && <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>}
      </>}>
      {err && <Alert tone="bad">{err}</Alert>}
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card title="Basics">
            <div className="grid gap-4 md:grid-cols-2">
              {txt(TEXT('name', 'Name', { required: true }))}
              {txt(TEXT('sku', 'SKU', { required: true }))}
              {!creating && txt(TEXT('slug', 'URL slug', { hint: 'Lowercase letters, numbers and hyphens' }))}
              <Field label="Category" htmlFor="pf-cat"><Select id="pf-cat" value={String(f.category_id ?? '')} onChange={(e) => set('category_id', e.target.value)} disabled={!ed}>
                <option value="">— Choose —</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}{c.status !== 'published' ? ` (${c.status})` : ''}</option>)}</Select></Field>
              {txt(TEXT('brand', 'Brand / maker'))}
            </div>
            <div className="mt-4 space-y-4">
              <Field label="Short description" htmlFor="pf-sd"><Textarea id="pf-sd" rows={2} value={String(f.short_description ?? '')} onChange={(e) => set('short_description', e.target.value)} disabled={!ed} /></Field>
              <Field label="Description" htmlFor="pf-d" hint="Separate paragraphs with a blank line."><Textarea id="pf-d" rows={7} value={String(f.description ?? '')} onChange={(e) => set('description', e.target.value)} disabled={!ed} /></Field>
            </div>
          </Card>
          <Card title="Pricing">
            <div className="grid gap-4 md:grid-cols-3">
              {txt(TEXT('price', 'Price (₹, incl. tax)', { required: true }))}
              {txt(TEXT('compare_at_price', 'Compare-at price'))}
              {txt(TEXT('sale_price', 'Sale price'))}
              {txt(TEXT('sale_starts_at', 'Sale starts', { type: 'datetime-local' }))}
              {txt(TEXT('sale_ends_at', 'Sale ends', { type: 'datetime-local' }))}
              <Field label="Tax class" htmlFor="pf-tax"><Select id="pf-tax" value={String(f.tax_class)} onChange={(e) => set('tax_class', e.target.value)} disabled={!ed}><option value="standard">Standard</option><option value="reduced">Reduced</option></Select></Field>
            </div>
            <p className="mt-3 text-xs text-charcoal-500">Changing prices never alters existing orders — each order stores a snapshot.</p>
          </Card>
          <Card title="Glass details">
            <div className="grid gap-4 md:grid-cols-3">
              {txt(TEXT('glass_type', 'Glass type'))}{txt(TEXT('material', 'Material'))}{txt(TEXT('color', 'Colour'))}
              {txt(TEXT('finish', 'Finish'))}{txt(TEXT('dimensions', 'Dimensions'))}{txt(TEXT('capacity', 'Capacity'))}
              {txt(TEXT('weight_grams', 'Product weight (g)', { type: 'number' }))}
            </div>
            <div className="mt-4"><Field label="Care instructions" htmlFor="pf-care"><Textarea id="pf-care" rows={3} value={String(f.care_instructions ?? '')} onChange={(e) => set('care_instructions', e.target.value)} disabled={!ed} /></Field></div>
            <div className="mt-4">
              <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-charcoal-600">Attributes</p>
              {(f.attributes as { name: string; value: string }[]).map((a, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <Input value={a.name} placeholder="Name" aria-label="Attribute name" onChange={(e) => set('attributes', (f.attributes as { name: string; value: string }[]).map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <Input value={a.value} placeholder="Value" aria-label="Attribute value" onChange={(e) => set('attributes', (f.attributes as { name: string; value: string }[]).map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                  <Button type="button" variant="ghost" size="sm" aria-label="Remove attribute" onClick={() => set('attributes', (f.attributes as { name: string; value: string }[]).filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {ed && <Button type="button" size="sm" variant="ghost" onClick={() => set('attributes', [...(f.attributes as { name: string; value: string }[]), { name: '', value: '' }])}>+ Add attribute</Button>}
            </div>
          </Card>
          <Card title="Shipping & packaging">
            <div className="grid gap-4 md:grid-cols-4">
              {txt(TEXT('package_weight_grams', 'Package weight (g)', { type: 'number' }))}{txt(TEXT('package_length_cm', 'Length (cm)'))}
              {txt(TEXT('package_width_cm', 'Width (cm)'))}{txt(TEXT('package_height_cm', 'Height (cm)'))}
              <Field label="Fragility" htmlFor="pf-frag"><Select id="pf-frag" value={String(f.fragility)} onChange={(e) => set('fragility', e.target.value)} disabled={!ed}><option value="standard">Standard</option><option value="fragile">Fragile</option><option value="highly_fragile">Highly fragile</option></Select></Field>
              {txt(TEXT('hs_code', 'HS code'))}{txt(TEXT('country_of_origin', 'Country of origin'))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Checkbox label="Ships internationally" checked={!!f.ships_internationally} onChange={(e) => set('ships_internationally', e.target.checked)} disabled={!ed} />
              <Field label="Blocked destinations" hint="Comma-separated country codes, e.g. AU, NZ"><Input value={(f.blocked_countries as string[]).join(', ')} onChange={(e) => set('blocked_countries', e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))} disabled={!ed} /></Field>
              <Checkbox label="Gift packaging available" checked={!!f.gift_wrap_available} onChange={(e) => set('gift_wrap_available', e.target.checked)} disabled={!ed} />
              {txt(TEXT('gift_wrap_price', 'Gift packaging price (₹)'))}
            </div>
          </Card>
          <Card title="Search & SEO">
            <div className="grid gap-4">
              {txt(TEXT('search_keywords', 'Search keywords'))}{txt(TEXT('seo_title', 'SEO title'))}
              <Field label="SEO description" htmlFor="pf-seo"><Textarea id="pf-seo" rows={2} value={String(f.seo_description ?? '')} onChange={(e) => set('seo_description', e.target.value)} disabled={!ed} /></Field>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Merchandising">
            <div className="space-y-3">
              <Checkbox label="Featured" checked={!!f.is_featured} onChange={(e) => set('is_featured', e.target.checked)} disabled={!ed} />
              <Checkbox label="Bestseller" checked={!!f.is_bestseller} onChange={(e) => set('is_bestseller', e.target.checked)} disabled={!ed} />
              <Checkbox label="New arrival" checked={!!f.is_new_arrival} onChange={(e) => set('is_new_arrival', e.target.checked)} disabled={!ed} />
              {txt(TEXT('badge', 'Badge text'))}
              <p className="pt-2 text-[11px] uppercase tracking-[0.14em] text-charcoal-600">Collections</p>
              {cols.data?.map((c) => (
                <Checkbox key={c.id} label={c.name} checked={(f.collection_ids as number[]).includes(c.id)} disabled={!ed}
                  onChange={(e) => set('collection_ids', e.target.checked ? [...(f.collection_ids as number[]), c.id] : (f.collection_ids as number[]).filter((x) => x !== c.id))} />
              ))}
            </div>
          </Card>
          <Card title="Inventory">
            <div className="space-y-4">
              {creating && txt(TEXT('initial_stock', 'Initial stock', { type: 'number' }))}
              {txt(TEXT('low_stock_threshold', 'Low-stock alert at', { type: 'number' }))}
              {!creating && <p className="text-sm text-charcoal-600">Adjust stock per variant below or in <Link to="/admin/inventory" className="underline">Inventory</Link>.</p>}
            </div>
          </Card>
          {ed && <Button type="submit" block loading={save.isPending}>{creating ? 'Create product' : 'Save changes'}</Button>}
          {creating && <p className="text-xs text-charcoal-500">Products are created as drafts. Add images, then publish.</p>}
        </div>
      </form>

      {!creating && p && (
        <>
          <Card title="Media" actions={ed && <label className="inline-flex cursor-pointer items-center gap-1 text-xs uppercase tracking-[0.14em] hover:underline"><ImagePlus className="h-4 w-4" /> Upload
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = '' }} /></label>}>
            {media.isPending && <p className="mb-3 text-xs text-charcoal-500">Working…</p>}
            {imgs.length === 0 ? <p className="text-sm text-charcoal-500">No images yet. JPEG, PNG or WebP up to 5 MB; metadata is stripped on upload.</p> : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
                {imgs.map((im, i) => (
                  <div key={im.id} className="space-y-2">
                    <GlassImage src={im.url} alt={im.alt} className="aspect-[4/5] w-full border border-line object-cover" />
                    <Input defaultValue={im.alt} aria-label="Alt text" className="h-8 text-xs" disabled={!ed}
                      onBlur={(e) => e.target.value !== im.alt && media.mutate(() => adminApi.patch<AdminProduct>(`/admin/products/${id}/images/${im.id}`, { alt_text: e.target.value }))} />
                    {ed && <div className="flex justify-between">
                      <button aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                      <button aria-label="Move later" disabled={i === imgs.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                      <label className="cursor-pointer" aria-label="Replace image"><RefreshCw className="h-4 w-4" />
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.set('file', file); media.mutate(() => adminApi.upload<AdminProduct>(`/admin/products/${id}/images/${im.id}/replace`, fd)) }} /></label>
                      <button aria-label="Remove image" onClick={() => media.mutate(() => adminApi.del<AdminProduct>(`/admin/products/${id}/images/${im.id}`))}><Trash2 className="h-4 w-4 text-red-800" /></button>
                    </div>}
                    {i === 0 && <p className="text-[10px] uppercase tracking-[0.14em] text-champagne-600">Primary</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Variants & stock" actions={ed && <Button size="sm" variant="ghost" onClick={() => setVariantDialog('new')}>+ Add variant</Button>}>
            <Table head={['Variant', 'SKU', 'Options', 'Price', 'On hand', 'Reserved', 'Active', '']}>
              {p.variants.map((v) => (
                <tr key={v.id}>
                  <Td>{v.name}{v.is_default && <Badge tone="gold" className="ml-2">Default</Badge>}</Td><Td className="text-xs">{v.sku}</Td>
                  <Td className="text-xs">{Object.entries(v.options).map(([k, val]) => `${k}: ${val}`).join(', ') || '—'}</Td>
                  <Td>{formatINR(v.price)}{v.price_override && <span className="ml-1 text-[10px] text-charcoal-500">override</span>}</Td>
                  <Td>{v.on_hand}</Td><Td>{v.reserved}</Td><Td>{v.is_active ? 'Yes' : 'No'}</Td>
                  <Td>{ed && <button className="text-xs underline" onClick={() => setVariantDialog(v)}>Edit</button>}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          {p.status !== 'published' && (
            <Card title="Preview (as customers will see it)">
              <div className="grid gap-6 md:grid-cols-[200px_1fr]">
                <GlassImage src={p.images[0]?.url} alt={p.name} className="aspect-[4/5] w-full object-cover" />
                <div><p className="text-[10px] uppercase tracking-luxe text-charcoal-500">{p.category?.name}</p><p className="font-display text-3xl">{p.name}</p>
                  <p className="mt-2">{formatINR(p.price)} {p.compare_at_price && <s className="text-sm text-charcoal-400">{formatINR(p.compare_at_price)}</s>}</p>
                  <p className="mt-3 text-sm text-charcoal-600">{p.short_description}</p></div>
              </div>
            </Card>
          )}
        </>
      )}
      {variantDialog && p && <VariantDialog productId={p.id} variant={variantDialog === 'new' ? null : variantDialog} onClose={() => setVariantDialog(null)} onSaved={(d) => { done(d); setVariantDialog(null) }} />}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete product?" danger confirmLabel="Delete" loading={del.isPending} onConfirm={() => del.mutate()}
        message="Products with order history are archived and hidden instead of erased, so past orders stay intact." />
    </AdminPage>
  )
}

function VariantDialog({ productId, variant, onClose, onSaved }: { productId: number; variant: Variant | null; onClose: () => void; onSaved: (p: AdminProduct) => void }) {
  const toast = useToast()
  const [name, setName] = useState(variant?.name ?? '')
  const [sku, setSku] = useState(variant?.sku ?? '')
  const [opts, setOpts] = useState(Object.entries(variant?.options ?? {}).map(([k, v]) => `${k}=${v}`).join(', '))
  const [price, setPrice] = useState(variant?.price_override ?? '')
  const [active, setActive] = useState(variant?.is_active ?? true)
  const [stock, setStock] = useState('0')
  const [isDefault, setIsDefault] = useState(false)
  const m = useMutation({
    mutationFn: () => {
      const options = Object.fromEntries(opts.split(',').map((x) => x.split('=').map((s) => s.trim())).filter((x) => x.length === 2 && x[0]))
      return variant
        ? adminApi.patch<AdminProduct>(`/admin/products/${productId}/variants/${variant.id}`, { name, sku, options, is_active: active, ...(price ? { price_override: price } : { clear_price_override: true }), ...(isDefault ? { is_default: true } : {}) })
        : adminApi.post<AdminProduct>(`/admin/products/${productId}/variants`, { name, sku, options, is_active: active, price_override: price || null, initial_stock: Number(stock) })
    },
    onSuccess: onSaved, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  const remove = useMutation({ mutationFn: () => adminApi.del<AdminProduct>(`/admin/products/${productId}/variants/${variant!.id}`), onSuccess: onSaved, onError: (e) => toast(errorMessage(e), 'bad') })
  return (
    <Dialog open onClose={onClose} title={variant ? 'Edit variant' : 'Add variant'} footer={<>
      {variant && !variant.is_default && <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>Remove</Button>}
      <Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!name || !sku}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2"><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="SKU"><Input value={sku} onChange={(e) => setSku(e.target.value)} /></Field></div>
        <Field label="Options" hint="e.g. Colour=Smoke, Size=Large"><Input value={opts} onChange={(e) => setOpts(e.target.value)} /></Field>
        <Field label="Price override (₹)" hint="Leave blank to use the product price"><Input value={String(price ?? '')} onChange={(e) => setPrice(e.target.value)} /></Field>
        {!variant && <Field label="Initial stock"><Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></Field>}
        <Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {variant && !variant.is_default && <Checkbox label="Make default" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />}
      </div>
    </Dialog>
  )
}

