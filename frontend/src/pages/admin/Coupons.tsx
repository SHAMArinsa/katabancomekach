import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Badge, Button, Checkbox, Dialog, Field, Input, PageLoader, Select, Table, Td, useToast } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import { formatDate, formatINR } from '@/utils/format'

interface C { id: number; code: string; description: string; discount_type: 'percent' | 'fixed'; value: string; min_order_amount: string; max_discount_amount: string | null; starts_at: string | null; ends_at: string | null; usage_limit: number | null; per_customer_limit: number | null; applies_to_sale_items: boolean; domestic_only: boolean; is_active: boolean; times_used: number }

export default function Coupons() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'coupons'], queryFn: () => adminApi.get<C[]>('/admin/coupons') })
  const [edit, setEdit] = useState<C | 'new' | null>(null)
  const del = useMutation({ mutationFn: (id: number) => adminApi.del<{ deactivated: boolean }>(`/admin/coupons/${id}`), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); toast(r.deactivated ? 'Coupon has been used, so it was deactivated' : 'Coupon deleted') } })
  if (isLoading) return <PageLoader />
  return (
    <AdminPage title="Coupons & promotions" actions={<Button size="sm" onClick={() => setEdit('new')}>New coupon</Button>}>
      <Table head={['Code', 'Discount', 'Min order', 'Window', 'Usage', 'Rules', 'Status', '']} empty={!data?.length}>
        {data?.map((c) => (
          <tr key={c.id}><Td className="font-medium">{c.code}<p className="text-xs font-normal text-charcoal-500">{c.description}</p></Td>
            <Td>{c.discount_type === 'percent' ? `${Number(c.value)}%` : formatINR(c.value)}{c.max_discount_amount && <span className="text-xs text-charcoal-500"> (max {formatINR(c.max_discount_amount)})</span>}</Td>
            <Td>{formatINR(c.min_order_amount)}</Td><Td className="text-xs">{c.starts_at || c.ends_at ? `${formatDate(c.starts_at)} → ${formatDate(c.ends_at)}` : 'Always'}</Td>
            <Td>{c.times_used}{c.usage_limit ? ` / ${c.usage_limit}` : ''}</Td>
            <Td className="space-x-1 text-xs">{c.applies_to_sale_items && <Badge>Stacks with sale</Badge>}{c.domestic_only && <Badge>India only</Badge>}{c.per_customer_limit && <Badge>{c.per_customer_limit}/customer</Badge>}</Td>
            <Td>{c.is_active ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>}</Td>
            <Td><div className="flex gap-3"><button className="text-xs underline" onClick={() => setEdit(c)}>Edit</button><button className="text-xs text-red-800 underline" onClick={() => del.mutate(c.id)}>Delete</button></div></Td></tr>
        ))}
      </Table>
      {edit && <CouponDialog c={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['admin', 'coupons'] }); setEdit(null) }} />}
    </AdminPage>
  )
}

function CouponDialog({ c, onClose, onSaved }: { c: C | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    code: c?.code ?? '', description: c?.description ?? '', discount_type: c?.discount_type ?? 'percent', value: c?.value ?? '', min_order_amount: c?.min_order_amount ?? '0',
    max_discount_amount: c?.max_discount_amount ?? '', starts_at: c?.starts_at?.slice(0, 16) ?? '', ends_at: c?.ends_at?.slice(0, 16) ?? '', usage_limit: c?.usage_limit ?? '',
    per_customer_limit: c?.per_customer_limit ?? 1, applies_to_sale_items: c?.applies_to_sale_items ?? false, domestic_only: c?.domestic_only ?? false, is_active: c?.is_active ?? true,
  })
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, max_discount_amount: v.max_discount_amount || null, usage_limit: String(v.usage_limit) === '' ? null : Number(v.usage_limit), per_customer_limit: String(v.per_customer_limit) === '' ? null : Number(v.per_customer_limit),
        starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null, ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null }
      return c ? adminApi.put(`/admin/coupons/${c.id}`, body) : adminApi.post('/admin/coupons', body)
    }, onSuccess: onSaved, onError: (e) => setErr(errorMessage(e)),
  })
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  return (
    <Dialog open wide onClose={onClose} title={c ? `Edit ${c.code}` : 'New coupon'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="bad">{err}</Alert>}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Code"><Input value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} /></Field>
          <Field label="Type"><Select value={v.discount_type} onChange={(e) => set('discount_type', e.target.value)}><option value="percent">Percentage</option><option value="fixed">Fixed amount (₹)</option></Select></Field>
          <Field label="Value"><Input value={String(v.value)} onChange={(e) => set('value', e.target.value)} /></Field>
          <Field label="Minimum order (₹)"><Input value={String(v.min_order_amount)} onChange={(e) => set('min_order_amount', e.target.value)} /></Field>
          <Field label="Maximum discount (₹)"><Input value={String(v.max_discount_amount)} onChange={(e) => set('max_discount_amount', e.target.value)} /></Field>
          <Field label="Description"><Input value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label="Starts"><Input type="datetime-local" value={v.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></Field>
          <Field label="Expires"><Input type="datetime-local" value={v.ends_at} onChange={(e) => set('ends_at', e.target.value)} /></Field>
          <Field label="Total usage limit"><Input value={String(v.usage_limit)} onChange={(e) => set('usage_limit', e.target.value)} placeholder="Unlimited" /></Field>
          <Field label="Per-customer limit"><Input value={String(v.per_customer_limit)} onChange={(e) => set('per_customer_limit', e.target.value)} placeholder="Unlimited" /></Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox label="Stacks with sale prices" checked={v.applies_to_sale_items} onChange={(e) => set('applies_to_sale_items', e.target.checked)} />
          <Checkbox label="Domestic orders only" checked={v.domestic_only} onChange={(e) => set('domestic_only', e.target.checked)} />
          <Checkbox label="Active" checked={v.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        </div>
        <p className="text-xs text-charcoal-500">One coupon per order. The store-wide maximum discount % (Business settings › Pricing) always applies.</p>
      </div>
    </Dialog>
  )
}
