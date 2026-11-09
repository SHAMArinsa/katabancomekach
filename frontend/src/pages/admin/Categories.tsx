import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { Tabs } from '@/components/admin/kit'
import { Alert, Button, Checkbox, ConfirmDialog, Dialog, Field, Input, PageLoader, Select, StatusBadge, Table, Td, Textarea, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import type { Category } from '@/types'
import { formatDate } from '@/utils/format'

interface Col { id: number; name: string; slug: string; kind: string; description: string; image_url: string | null; is_visible: boolean; position: number; starts_at: string | null; ends_at: string | null; product_count: number }

export default function Categories() {
  const [tab, setTab] = useState<'categories' | 'collections'>('categories')
  return (
    <AdminPage title="Categories & collections">
      <Tabs tabs={[{ id: 'categories', label: 'Categories' }, { id: 'collections', label: 'Collections' }]} value={tab} onChange={setTab} />
      {tab === 'categories' ? <CategoryList /> : <CollectionList />}
    </AdminPage>
  )
}

function CategoryList() {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAdmin()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => adminApi.get<Category[]>('/admin/categories') })
  const [edit, setEdit] = useState<Category | 'new' | null>(null)
  const [del, setDel] = useState<Category | null>(null)
  const [reassign, setReassign] = useState<Category | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin', 'categories'] }); qc.invalidateQueries({ queryKey: ['categories'] }) }
  const remove = useMutation({ mutationFn: (id: number) => adminApi.del(`/admin/categories/${id}`), onSuccess: () => { refresh(); setDel(null); toast('Category deleted') }, onError: (e) => { toast(errorMessage(e), 'bad'); setDel(null) } })
  const reorder = useMutation({ mutationFn: (ids: number[]) => adminApi.post('/admin/categories/reorder', { ids }), onSuccess: refresh })
  if (isLoading || !data) return <PageLoader />
  const roots = data.filter((c) => !c.parent_id).sort((a, b) => a.position - b.position)
  const kids = (id: number) => data.filter((c) => c.parent_id === id).sort((a, b) => a.position - b.position)
  const move = (list: Category[], i: number, d: number) => { const ids = list.map((c) => c.id); const [m] = ids.splice(i, 1); ids.splice(i + d, 0, m); reorder.mutate(ids) }
  const row = (c: Category, list: Category[], i: number, depth: number) => (
    <tr key={c.id}>
      <Td><span style={{ paddingLeft: depth * 20 }}>{depth > 0 && '└ '}{c.name}</span></Td><Td className="text-xs">{c.slug}</Td><Td>{c.product_count}</Td><Td><StatusBadge status={c.status} /></Td>
      <Td>{can('categories.write') && <div className="flex items-center gap-3">
        <button aria-label="Move up" disabled={i === 0} onClick={() => move(list, i, -1)} className="disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
        <button aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(list, i, 1)} className="disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
        <button className="text-xs underline" onClick={() => setEdit(c)}>Edit</button>
        {!!c.product_count && <button className="text-xs underline" onClick={() => setReassign(c)}>Move products</button>}
        <button className="text-xs text-red-800 underline" onClick={() => setDel(c)}>Delete</button>
      </div>}</Td>
    </tr>
  )
  return (
    <div className="space-y-4">
      {can('categories.write') && <div className="flex justify-end"><Button size="sm" onClick={() => setEdit('new')}>New category</Button></div>}
      <Table head={['Name', 'Slug', 'Products', 'Status', '']}>
        {roots.flatMap((c, i) => [row(c, roots, i, 0), ...kids(c.id).map((k, j, arr) => row(k, arr, j, 1))])}
      </Table>
      {edit && <CategoryDialog cat={edit === 'new' ? null : edit} all={data} onClose={() => setEdit(null)} onSaved={() => { refresh(); setEdit(null) }} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name}?`} danger confirmLabel="Delete" loading={remove.isPending} onConfirm={() => del && remove.mutate(del.id)}
        message="Categories with products or subcategories cannot be deleted — archive or hide them instead, or move their products first." />
      {reassign && <ReassignDialog cat={reassign} all={data} onClose={() => setReassign(null)} onDone={() => { refresh(); setReassign(null) }} />}
    </div>
  )
}

function CategoryDialog({ cat, all, onClose, onSaved }: { cat: Category | null; all: Category[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: cat?.name ?? '', slug: cat?.slug ?? '', parent_id: cat?.parent_id ?? '', description: cat?.description ?? '', image_url: cat?.image_url ?? '', status: cat?.status ?? 'published', seo_title: cat?.seo_title ?? '', seo_description: cat?.seo_description ?? '' })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }))
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, parent_id: v.parent_id ? Number(v.parent_id) : null, slug: v.slug || undefined, image_url: v.image_url || null, seo_title: v.seo_title || null, seo_description: v.seo_description || null }
      return cat ? adminApi.patch(`/admin/categories/${cat.id}`, body) : adminApi.post('/admin/categories', body)
    },
    onSuccess: onSaved, onError: (e) => setErr(errorMessage(e)),
  })
  const upload = useMutation({
    mutationFn: (file: File) => { const f = new FormData(); f.set('file', file); f.set('purpose', 'category_image'); return adminApi.upload<{ url: string }>('/admin/uploads/image', f) },
    onSuccess: (r) => set('image_url', r.url), onError: (e) => setErr(errorMessage(e)),
  })
  return (
    <Dialog open wide onClose={onClose} title={cat ? 'Edit category' : 'New category'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()} disabled={!v.name}>Save</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="bad">{err}</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name"><Input value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Slug" hint="Auto-generated if blank"><Input value={v.slug} onChange={(e) => set('slug', e.target.value)} /></Field>
          <Field label="Parent"><Select value={String(v.parent_id)} onChange={(e) => set('parent_id', e.target.value)}><option value="">— Top level —</option>{all.filter((c) => c.id !== cat?.id && !c.parent_id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Visibility"><Select value={v.status} onChange={(e) => set('status', e.target.value)}><option value="published">Published</option><option value="hidden">Hidden</option><option value="archived">Archived</option></Select></Field>
        </div>
        <Field label="Description"><Textarea rows={3} value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Image URL" hint="Upload or paste a URL"><div className="flex gap-2"><Input value={v.image_url} onChange={(e) => set('image_url', e.target.value)} />
          <label className="inline-flex cursor-pointer items-center border border-line px-3 text-xs">Upload<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label></div></Field>
        <div className="grid gap-4 md:grid-cols-2"><Field label="SEO title"><Input value={v.seo_title} onChange={(e) => set('seo_title', e.target.value)} /></Field><Field label="SEO description"><Input value={v.seo_description} onChange={(e) => set('seo_description', e.target.value)} /></Field></div>
      </div>
    </Dialog>
  )
}

function ReassignDialog({ cat, all, onClose, onDone }: { cat: Category; all: Category[]; onClose: () => void; onDone: () => void }) {
  const [target, setTarget] = useState('')
  const toast = useToast()
  const m = useMutation({ mutationFn: () => adminApi.post<{ moved: number }>(`/admin/categories/${cat.id}/reassign?target_id=${target}`), onSuccess: (r) => { toast(`${r.moved} products moved`); onDone() }, onError: (e) => toast(errorMessage(e), 'bad') })
  return (
    <Dialog open onClose={onClose} title={`Move products from ${cat.name}`} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!target} loading={m.isPending} onClick={() => m.mutate()}>Move {cat.product_count} products</Button></>}>
      <Field label="Destination category"><Select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose…</option>{all.filter((c) => c.id !== cat.id).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</Select></Field>
    </Dialog>
  )
}

function CollectionList() {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAdmin()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'collections'], queryFn: () => adminApi.get<Col[]>('/admin/collections') })
  const [edit, setEdit] = useState<Col | 'new' | null>(null)
  const remove = useMutation({ mutationFn: (id: number) => adminApi.del(`/admin/collections/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'collections'] }), onError: (e) => toast(errorMessage(e), 'bad') })
  if (isLoading || !data) return <PageLoader />
  return (
    <div className="space-y-4">
      {can('categories.write') && <div className="flex justify-end"><Button size="sm" onClick={() => setEdit('new')}>New collection</Button></div>}
      <Table head={['Name', 'Kind', 'Products', 'Visible', 'Campaign window', '']}>
        {data.map((c) => (
          <tr key={c.id}><Td>{c.name}</Td><Td>{c.kind}</Td><Td>{c.product_count}</Td><Td>{c.is_visible ? 'Yes' : 'No'}</Td>
            <Td className="text-xs">{c.starts_at || c.ends_at ? `${formatDate(c.starts_at)} → ${formatDate(c.ends_at)}` : 'Always'}</Td>
            <Td>{can('categories.write') && <div className="flex gap-3"><button className="text-xs underline" onClick={() => setEdit(c)}>Edit</button><button className="text-xs text-red-800 underline" onClick={() => remove.mutate(c.id)}>Delete</button></div>}</Td></tr>
        ))}
      </Table>
      <p className="text-xs text-charcoal-500">Assign products to collections from each product’s edit page.</p>
      {edit && <CollectionDialog col={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'collections'] }); setEdit(null) }} />}
    </div>
  )
}

function CollectionDialog({ col, onClose, onSaved }: { col: Col | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: col?.name ?? '', slug: col?.slug ?? '', kind: col?.kind ?? 'featured', description: col?.description ?? '', image_url: col?.image_url ?? '', is_visible: col?.is_visible ?? true, position: col?.position ?? 0, starts_at: col?.starts_at?.slice(0, 16) ?? '', ends_at: col?.ends_at?.slice(0, 16) ?? '' })
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, slug: v.slug || undefined, image_url: v.image_url || null, starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null, ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null }
      return col ? adminApi.put(`/admin/collections/${col.id}`, body) : adminApi.post('/admin/collections', body)
    }, onSuccess: onSaved, onError: (e) => setErr(errorMessage(e)),
  })
  return (
    <Dialog open wide onClose={onClose} title={col ? 'Edit collection' : 'New collection'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()} disabled={!v.name}>Save</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="bad">{err}</Alert>}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Slug"><Input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} /></Field>
          <Field label="Kind"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>{['featured', 'gift', 'seasonal', 'designer', 'premium'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
        </div>
        <Field label="Description"><Textarea rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Image URL"><Input value={v.image_url} onChange={(e) => setV({ ...v, image_url: e.target.value })} /></Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Starts"><Input type="datetime-local" value={v.starts_at} onChange={(e) => setV({ ...v, starts_at: e.target.value })} /></Field>
          <Field label="Ends"><Input type="datetime-local" value={v.ends_at} onChange={(e) => setV({ ...v, ends_at: e.target.value })} /></Field>
          <Field label="Position"><Input type="number" value={v.position} onChange={(e) => setV({ ...v, position: Number(e.target.value) })} /></Field>
        </div>
        <Checkbox label="Visible" checked={v.is_visible} onChange={(e) => setV({ ...v, is_visible: e.target.checked })} />
      </div>
    </Dialog>
  )
}
