import { useMutation, useQuery } from '@tanstack/react-query'
import { Download, Plus, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FilterBar } from '@/components/admin/kit'
import { GlassImage } from '@/components/store/ProductCard'
import { Alert, Button, ButtonLink, Checkbox, Dialog, Field, Input, PageLoader, Pagination, Select, StatusBadge, Table, Td, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { Category, Paged, ProductCard } from '@/types'
import { formatDate, formatINR } from '@/utils/format'

type Row = ProductCard & { status: string; available: number; on_hand: number; low_stock_threshold: number; updated_at: string }

export default function Products() {
  const [sp, setSp] = useSearchParams()
  const { can } = useAdmin()
  const toast = useToast()
  const [importOpen, setImportOpen] = useState(false)
  const params = { q: sp.get('q') || undefined, status: sp.get('status') || undefined, category_id: sp.get('category_id') || undefined, stock: sp.get('stock') || undefined, page: Number(sp.get('page') || 1) }
  const { data, isLoading, refetch } = useQuery({ queryKey: ['admin', 'products', params], queryFn: () => adminApi.get<Paged<Row>>('/admin/products', params), placeholderData: (p) => p })
  const cats = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => adminApi.get<Category[]>('/admin/categories') })
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setSp(n) }
  const exp = (format: string) => adminApi.download('/admin/products-export', { format }, `products.${format}`).catch((e) => toast(errorMessage(e), 'bad'))
  return (
    <AdminPage title="Products" actions={<>
      <Button size="sm" variant="ghost" onClick={() => exp('csv')}><Download className="h-4 w-4" /> CSV</Button>
      <Button size="sm" variant="ghost" onClick={() => exp('xlsx')}><Download className="h-4 w-4" /> Excel</Button>
      {can('products.write') && <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import</Button>}
      {can('products.write') && <ButtonLink to="/admin/products/new" size="sm"><Plus className="h-4 w-4" /> New product</ButtonLink>}
    </>}>
      <FilterBar>
        <Field label="Search"><Input defaultValue={params.q} placeholder="Name or SKU" onKeyDown={(e) => e.key === 'Enter' && set('q', (e.target as HTMLInputElement).value)} className="w-56" /></Field>
        <Field label="Status"><Select value={params.status ?? ''} onChange={(e) => set('status', e.target.value)} className="w-36"><option value="">All</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option></Select></Field>
        <Field label="Category"><Select value={params.category_id ?? ''} onChange={(e) => set('category_id', e.target.value)} className="w-56"><option value="">All</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</Select></Field>
        <Field label="Stock"><Select value={params.stock ?? ''} onChange={(e) => set('stock', e.target.value)} className="w-36"><option value="">All</option><option value="low">Low stock</option><option value="out">Out of stock</option></Select></Field>
      </FilterBar>
      {isLoading ? <PageLoader /> : (
        <>
          <Table head={['', 'Product', 'SKU', 'Category', 'Price', 'Available', 'Status', 'Updated']} empty={!data?.items.length}>
            {data?.items.map((p) => (
              <tr key={p.id}>
                <Td><GlassImage src={p.image?.url} alt="" className="h-12 w-10 object-cover" /></Td>
                <Td><Link to={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link>{p.is_featured && <span className="ml-1 text-[10px] text-champagne-600">FEATURED</span>}</Td>
                <Td className="text-xs">{p.sku}</Td><Td>{p.category?.name ?? '—'}</Td>
                <Td>{formatINR(p.price)}{p.compare_at_price && <s className="ml-1 text-xs text-charcoal-400">{formatINR(p.compare_at_price)}</s>}</Td>
                <Td><span className={p.available <= 0 ? 'text-red-800' : p.available <= p.low_stock_threshold ? 'text-amber-700' : ''}>{p.available}</span> <span className="text-xs text-charcoal-400">/ {p.on_hand}</span></Td>
                <Td><StatusBadge status={p.status} /></Td><Td className="text-xs">{formatDate(p.updated_at)}</Td>
              </tr>
            ))}
          </Table>
          {data && <Pagination page={params.page} pages={data.pages} onPage={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n) }} />}
        </>
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={() => refetch()} />}
    </AdminPage>
  )
}

interface ImportResult { dry_run: boolean; valid: boolean; errors: { row: number; sku: string; error: string }[]; would_create?: number; would_update?: number; created?: number; updated?: number; rows: number }

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [dry, setDry] = useState(true)
  const m = useMutation({
    mutationFn: () => { const f = new FormData(); f.set('file', file!); f.set('dry_run', String(dry)); return adminApi.upload<ImportResult>('/admin/products-import', f) },
    onSuccess: (r) => { if (!r.dry_run && r.valid) onDone() },
  })
  const r = m.data
  return (
    <Dialog open wide onClose={onClose} title="Import products" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!file} loading={m.isPending} onClick={() => m.mutate()}>{dry ? 'Validate' : 'Import'}</Button></>}>
      <div className="space-y-4 text-sm">
        <p>Upload a CSV or Excel file. Rows are matched by <strong>sku</strong> (existing products are updated). Required columns: sku, name, price. Download an export for the full column list.</p>
        <Input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-2" />
        <Checkbox checked={dry} onChange={(e) => setDry(e.target.checked)} label="Validate only (dry run — nothing is saved)" />
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        {r && (r.valid
          ? <Alert tone="good">{r.dry_run ? `Valid: ${r.would_create} to create, ${r.would_update} to update. Untick “validate only” to import.` : `Imported: ${r.created} created, ${r.updated} updated.`}</Alert>
          : <Alert tone="bad" title={`${r.errors.length} row(s) have problems — nothing was saved`}><ul className="max-h-48 list-disc overflow-auto pl-4">{r.errors.map((e) => <li key={e.row}>Row {e.row} ({e.sku}): {e.error}</li>)}</ul></Alert>)}
      </div>
    </Dialog>
  )
}
