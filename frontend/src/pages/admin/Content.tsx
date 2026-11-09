import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tabs } from '@/components/admin/kit'
import { Alert, Badge, Button, Card, Checkbox, Dialog, Field, Input, PageLoader, Select, Table, Td, Textarea, useToast } from '@/components/ui'
import { Markdown } from '@/components/ui/Markdown'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import { formatDate, humanize } from '@/utils/format'

interface Block { id: number; placement: string; title: string; subtitle: string; body: string; image_url: string | null; link_url: string | null; link_label: string | null; position: number; is_visible: boolean; starts_at: string | null; ends_at: string | null; data: Record<string, unknown> }
interface Page { id: number; slug: string; title: string; body: string; seo_title: string | null; seo_description: string | null; is_published: boolean; updated_at: string }
interface Tpl { key: string; subject: string; body: string; is_enabled: boolean; customised: boolean }
const PLACEMENTS = ['hero', 'banner', 'campaign', 'story', 'craft', 'packaging', 'faq', 'footer_link', 'promo_strip']

export default function Content() {
  const [tab, setTab] = useState<'home' | 'blocks' | 'pages' | 'emails'>('home')
  return (
    <AdminPage title="Website content">
      <Tabs tabs={[{ id: 'home', label: 'Homepage layout' }, { id: 'blocks', label: 'Banners, sections & FAQs' }, { id: 'pages', label: 'Pages & policies' }, { id: 'emails', label: 'Email templates' }]} value={tab} onChange={setTab} />
      {tab === 'home' && <HomeLayout />}{tab === 'blocks' && <Blocks />}{tab === 'pages' && <Pages />}{tab === 'emails' && <Emails />}
    </AdminPage>
  )
}

function HomeLayout() {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => adminApi.get<Record<string, { value: Record<string, unknown> }>>('/admin/settings') })
  const [order, setOrder] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  useEffect(() => { if (data) { setOrder(data.content.value.home_sections as string[]); setHidden(data.content.value.hidden_home_sections as string[]) } }, [data])
  const m = useMutation({ mutationFn: () => adminApi.patch('/admin/settings/content', { home_sections: order, hidden_home_sections: hidden }), onSuccess: () => { toast('Homepage layout saved'); qc.invalidateQueries({ queryKey: ['admin', 'settings'] }) }, onError: (e) => toast(errorMessage(e), 'bad') })
  if (isLoading) return <PageLoader />
  const move = (i: number, d: number) => { const n = [...order]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setOrder(n) }
  return (
    <Card title="Section order & visibility" actions={<Button size="sm" loading={m.isPending} onClick={() => m.mutate()}>Save layout</Button>}>
      <ul className="divide-y divide-line">
        {order.map((s, i) => (
          <li key={s} className="flex items-center justify-between py-2.5 text-sm">
            <span className={hidden.includes(s) ? 'text-charcoal-400 line-through' : ''}>{humanize(s)}</span>
            <span className="flex items-center gap-3">
              <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button aria-label={hidden.includes(s) ? 'Show section' : 'Hide section'} onClick={() => setHidden(hidden.includes(s) ? hidden.filter((x) => x !== s) : [...hidden, s])}>{hidden.includes(s) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-charcoal-500">Section content (hero, campaign, story…) is edited under “Banners, sections & FAQs”. Product rows use the Featured / New / Bestseller flags on each product.</p>
    </Card>
  )
}

function Blocks() {
  const qc = useQueryClient()
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'blocks'], queryFn: () => adminApi.get<Block[]>('/admin/content/blocks') })
  const [edit, setEdit] = useState<Block | 'new' | null>(null)
  const del = useMutation({ mutationFn: (id: number) => adminApi.del(`/admin/content/blocks/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'blocks'] }); toast('Removed') } })
  if (isLoading) return <PageLoader />
  const rows = (data ?? []).filter((b) => !filter || b.placement === filter)
  return (
    <div className="space-y-4">
      <div className="flex justify-between"><Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" aria-label="Placement"><option value="">All placements</option>{PLACEMENTS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select>
        <Button size="sm" onClick={() => setEdit('new')}>New block</Button></div>
      <Table head={['Placement', 'Title', 'Position', 'Visible', 'Schedule', '']} empty={!rows.length}>
        {rows.map((b) => <tr key={b.id}><Td><Badge>{humanize(b.placement)}</Badge></Td><Td>{b.title}</Td><Td>{b.position}</Td><Td>{b.is_visible ? 'Yes' : 'No'}</Td>
          <Td className="text-xs">{b.starts_at || b.ends_at ? `${formatDate(b.starts_at)} → ${formatDate(b.ends_at)}` : 'Always'}</Td>
          <Td><div className="flex gap-3"><button className="text-xs underline" onClick={() => setEdit(b)}>Edit</button><button className="text-xs text-red-800 underline" onClick={() => del.mutate(b.id)}>Delete</button></div></Td></tr>)}
      </Table>
      {edit && <BlockDialog b={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'blocks'] }); setEdit(null) }} />}
    </div>
  )
}

function BlockDialog({ b, onClose, onSaved }: { b: Block | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ placement: b?.placement ?? 'banner', title: b?.title ?? '', subtitle: b?.subtitle ?? '', body: b?.body ?? '', image_url: b?.image_url ?? '', link_url: b?.link_url ?? '', link_label: b?.link_label ?? '', position: b?.position ?? 0, is_visible: b?.is_visible ?? true, starts_at: b?.starts_at?.slice(0, 16) ?? '', ends_at: b?.ends_at?.slice(0, 16) ?? '', data: JSON.stringify(b?.data ?? {}) })
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  const upload = useMutation({ mutationFn: (f: File) => { const d = new FormData(); d.set('file', f); return adminApi.upload<{ url: string }>('/admin/uploads/image', d) }, onSuccess: (r) => set('image_url', r.url), onError: (e) => setErr(errorMessage(e)) })
  const m = useMutation({
    mutationFn: () => {
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(v.data || '{}') } catch { throw new Error('Extra data must be valid JSON') }
      const body = { ...v, data, image_url: v.image_url || null, link_url: v.link_url || null, link_label: v.link_label || null, starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null, ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null }
      return b ? adminApi.put(`/admin/content/blocks/${b.id}`, body) : adminApi.post('/admin/content/blocks', body)
    }, onSuccess: onSaved, onError: (e) => setErr(e instanceof Error && !('status' in e) ? e.message : errorMessage(e)),
  })
  return (
    <Dialog open wide onClose={onClose} title={b ? 'Edit block' : 'New block'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="bad">{err}</Alert>}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Placement"><Select value={v.placement} onChange={(e) => set('placement', e.target.value)}>{PLACEMENTS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
          <Field label="Position"><Input type="number" value={v.position} onChange={(e) => set('position', Number(e.target.value))} /></Field>
          <div className="flex items-end pb-2"><Checkbox label="Visible" checked={v.is_visible} onChange={(e) => set('is_visible', e.target.checked)} /></div>
        </div>
        <Field label={v.placement === 'faq' ? 'Question' : 'Heading'}><Input value={v.title} onChange={(e) => set('title', e.target.value)} /></Field>
        {v.placement !== 'faq' && <Field label="Subheading"><Input value={v.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></Field>}
        <Field label={v.placement === 'faq' ? 'Answer' : 'Body'}><Textarea rows={4} value={v.body} onChange={(e) => set('body', e.target.value)} /></Field>
        <Field label="Image"><div className="flex gap-2"><Input value={v.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="URL" />
          <label className="inline-flex cursor-pointer items-center border border-line px-3 text-xs">Upload<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /></label></div></Field>
        <div className="grid gap-4 md:grid-cols-2"><Field label="Link" hint="/path or https://…"><Input value={v.link_url} onChange={(e) => set('link_url', e.target.value)} /></Field><Field label="Link label"><Input value={v.link_label} onChange={(e) => set('link_label', e.target.value)} /></Field></div>
        <div className="grid gap-4 md:grid-cols-2"><Field label="Show from"><Input type="datetime-local" value={v.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></Field><Field label="Show until"><Input type="datetime-local" value={v.ends_at} onChange={(e) => set('ends_at', e.target.value)} /></Field></div>
        <Field label="Extra data (JSON)" hint='e.g. {"group": "Delivery"} for FAQs or {"icon": "gem"} for craft items'><Input value={v.data} onChange={(e) => set('data', e.target.value)} /></Field>
      </div>
    </Dialog>
  )
}

function Pages() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'pages'], queryFn: () => adminApi.get<Page[]>('/admin/content/pages') })
  const [edit, setEdit] = useState<Partial<Page> | null>(null)
  const m = useMutation({ mutationFn: () => adminApi.put('/admin/content/pages', { slug: edit!.slug, title: edit!.title, body: edit!.body ?? '', seo_title: edit!.seo_title || null, seo_description: edit!.seo_description || null, is_published: edit!.is_published ?? true }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'pages'] }); setEdit(null); toast('Page saved') }, onError: (e) => toast(errorMessage(e), 'bad') })
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="sm" onClick={() => setEdit({ slug: '', title: '', body: '', is_published: true })}>New page</Button></div>
      <Table head={['Page', 'URL', 'Published', 'Updated', '']}>
        {data?.map((p) => <tr key={p.id}><Td>{p.title}</Td><Td className="text-xs">/{p.slug}</Td><Td>{p.is_published ? 'Yes' : 'No'}</Td><Td className="text-xs">{formatDate(p.updated_at)}</Td><Td><button className="text-xs underline" onClick={() => setEdit(p)}>Edit</button></Td></tr>)}
      </Table>
      <p className="text-xs text-charcoal-500">Storefront routes exist for about, shipping-policy, returns-policy, privacy-policy, terms and cookie-policy. Formatting: “## Heading”, “- list item”, **bold**, *italic*, [link](/path).</p>
      {edit && (
        <Dialog open wide onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.title}` : 'New page'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2"><Field label="Title"><Input value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
              <Field label="Slug"><Input value={edit.slug ?? ''} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></Field></div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Content"><Textarea rows={16} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} className="font-mono text-xs" /></Field>
              <div><p className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-charcoal-600">Preview</p><div className="max-h-[380px] overflow-auto border border-line bg-white p-4"><Markdown source={edit.body ?? ''} /></div></div>
            </div>
            <div className="grid gap-4 md:grid-cols-2"><Field label="SEO title"><Input value={edit.seo_title ?? ''} onChange={(e) => setEdit({ ...edit, seo_title: e.target.value })} /></Field><Field label="SEO description"><Input value={edit.seo_description ?? ''} onChange={(e) => setEdit({ ...edit, seo_description: e.target.value })} /></Field></div>
            <Checkbox label="Published" checked={edit.is_published ?? true} onChange={(e) => setEdit({ ...edit, is_published: e.target.checked })} />
          </div>
        </Dialog>
      )}
    </div>
  )
}

function Emails() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'emails'], queryFn: () => adminApi.get<Tpl[]>('/admin/content/email-templates') })
  const [edit, setEdit] = useState<Tpl | null>(null)
  const m = useMutation({ mutationFn: () => adminApi.put(`/admin/content/email-templates/${edit!.key}`, { subject: edit!.subject, body: edit!.body, is_enabled: edit!.is_enabled }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'emails'] }); setEdit(null); toast('Template saved') }, onError: (e) => toast(errorMessage(e), 'bad') })
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      <Table head={['Template', 'Subject', 'Enabled', '']}>
        {data?.map((t) => <tr key={t.key}><Td>{humanize(t.key)}{t.customised && <Badge tone="gold" className="ml-2">Customised</Badge>}</Td><Td className="text-xs">{t.subject}</Td><Td>{t.is_enabled ? 'Yes' : 'No'}</Td><Td><button className="text-xs underline" onClick={() => setEdit(t)}>Edit</button></Td></tr>)}
      </Table>
      <p className="text-xs text-charcoal-500">Placeholders like {'{name}'}, {'{order_number}'}, {'{link}'}, {'{brand}'} are substituted. Templates cannot run code. Sender name and which notifications are sent are set in Business settings › Notifications.</p>
      {edit && (
        <Dialog open wide onClose={() => setEdit(null)} title={humanize(edit.key)} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Subject"><Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Body"><Textarea rows={10} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <Checkbox label="Enabled" checked={edit.is_enabled} onChange={(e) => setEdit({ ...edit, is_enabled: e.target.checked })} />
          </div>
        </Dialog>
      )}
    </div>
  )
}
