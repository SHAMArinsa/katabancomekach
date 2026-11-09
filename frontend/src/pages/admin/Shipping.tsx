import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Tabs } from '@/components/admin/kit'
import { Alert, Badge, Button, Checkbox, Dialog, Field, Input, PageLoader, Select, Table, Td, Textarea, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import { formatINR } from '@/utils/format'

interface Provider { id: number; code: string; name: string; is_active: boolean; supports_domestic: boolean; supports_international: boolean; supports_recipient_paid_shipping: boolean; supports_fragile: boolean; supports_insurance: boolean; tracking_url_template: string | null; notes: string | null }
interface Rate { max_weight_grams: number; fee: string; fragile_surcharge: string }
interface Zone { id: number; name: string; is_domestic: boolean; country_codes: string[]; provider_id: number | null; provider_name: string | null; is_active: boolean; estimated_days_min: number; estimated_days_max: number; warnings: string[]; rates: Rate[] }
interface Dest { id: number; country_code: string; country_name: string; is_enabled: boolean; allows_fragile: boolean; currency_code: string; postal_code_regex: string | null; customs_note: string | null; restriction_reason: string | null }

export default function Shipping() {
  const [tab, setTab] = useState<'zones' | 'providers' | 'destinations'>('zones')
  return (
    <AdminPage title="Shipping" subtitle={<>Free-delivery thresholds, customs text and fragile rules are in <Link to="/admin/settings?section=shipping" className="underline">Business settings › Shipping</Link>.</>}>
      <Tabs tabs={[{ id: 'zones', label: 'Zones & rates' }, { id: 'providers', label: 'Couriers' }, { id: 'destinations', label: 'Destinations' }]} value={tab} onChange={setTab} />
      {tab === 'zones' && <Zones />}{tab === 'providers' && <Providers />}{tab === 'destinations' && <Destinations />}
    </AdminPage>
  )
}

function Providers() {
  const qc = useQueryClient()
  const { can } = useAdmin()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => adminApi.get<Provider[]>('/admin/shipping/providers') })
  const [edit, setEdit] = useState<Partial<Provider> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => { const { id, ...body } = edit!; return id ? adminApi.put(`/admin/shipping/providers/${id}`, body) : adminApi.post('/admin/shipping/providers', body) },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'providers'] }); qc.invalidateQueries({ queryKey: ['admin', 'zones'] }); setEdit(null) }, onError: (e) => setErr(errorMessage(e)),
  })
  if (isLoading) return <PageLoader />
  const flags: [keyof Provider, string][] = [['supports_domestic', 'Domestic'], ['supports_international', 'International'], ['supports_recipient_paid_shipping', 'Collects shipping from recipient on prepaid orders'], ['supports_fragile', 'Fragile items'], ['supports_insurance', 'Insurance'], ['is_active', 'Active']]
  return (
    <div className="space-y-4">
      <Alert tone="info">Couriers that cannot collect the shipping charge from the recipient on a prepaid parcel are blocked for below-threshold orders at checkout and at dispatch.</Alert>
      {can('shipping.write') && <div className="flex justify-end"><Button size="sm" onClick={() => { setErr(null); setEdit({ code: '', name: '', is_active: true, supports_domestic: true }) }}>Add courier</Button></div>}
      <Table head={['Courier', 'Adapter', 'Capabilities', 'Active', '']}>
        {data?.map((p) => <tr key={p.id}><Td>{p.name}</Td><Td className="text-xs">{p.code}</Td>
          <Td className="space-x-1">{p.supports_domestic && <Badge>Domestic</Badge>}{p.supports_international && <Badge>International</Badge>}
            {p.supports_recipient_paid_shipping ? <Badge tone="good">Recipient-paid ✓</Badge> : <Badge tone="warn">No recipient-paid</Badge>}{p.supports_fragile && <Badge>Fragile</Badge>}{p.supports_insurance && <Badge>Insurance</Badge>}</Td>
          <Td>{p.is_active ? 'Yes' : 'No'}</Td><Td>{can('shipping.write') && <button className="text-xs underline" onClick={() => { setErr(null); setEdit(p) }}>Edit</button>}</Td></tr>)}
      </Table>
      {edit && (
        <Dialog open wide onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'Add courier'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Adapter code" hint="mock = local simulator; manual = enter tracking numbers by hand"><Input value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">{flags.map(([k, l]) => <Checkbox key={k} label={l} checked={!!edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.checked })} />)}</div>
            <Field label="Tracking URL template" hint="Use {tracking_number} as a placeholder"><Input value={edit.tracking_url_template ?? ''} onChange={(e) => setEdit({ ...edit, tracking_url_template: e.target.value || null })} /></Field>
            <Field label="Notes"><Textarea rows={2} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function Zones() {
  const qc = useQueryClient()
  const { can } = useAdmin()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'zones'], queryFn: () => adminApi.get<Zone[]>('/admin/shipping/zones') })
  const providers = useQuery({ queryKey: ['admin', 'providers'], queryFn: () => adminApi.get<Provider[]>('/admin/shipping/providers') })
  const [edit, setEdit] = useState<Partial<Zone> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => {
      const body = { name: edit!.name, is_domestic: !!edit!.is_domestic, country_codes: edit!.country_codes ?? [], provider_id: edit!.provider_id || null, is_active: edit!.is_active ?? true,
        estimated_days_min: Number(edit!.estimated_days_min ?? 3), estimated_days_max: Number(edit!.estimated_days_max ?? 7), rates: (edit!.rates ?? []).map((r) => ({ ...r, max_weight_grams: Number(r.max_weight_grams) })) }
      return edit!.id ? adminApi.put(`/admin/shipping/zones/${edit!.id}`, body) : adminApi.post('/admin/shipping/zones', body)
    }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'zones'] }); setEdit(null); toast('Zone saved') }, onError: (e) => setErr(errorMessage(e)),
  })
  const del = useMutation({ mutationFn: (id: number) => adminApi.del(`/admin/shipping/zones/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'zones'] }) })
  if (isLoading) return <PageLoader />
  const setRate = (i: number, k: keyof Rate, v: string) => setEdit({ ...edit, rates: (edit!.rates ?? []).map((r, j) => j === i ? { ...r, [k]: v } : r) })
  return (
    <div className="space-y-4">
      <p className="text-sm text-charcoal-600">Rates are the indicative fee shown to customers below the free-delivery threshold — the courier collects the actual charge from the recipient.</p>
      {can('shipping.write') && <div className="flex justify-end"><Button size="sm" onClick={() => { setErr(null); setEdit({ name: '', country_codes: [], rates: [], is_active: true }) }}>Add zone</Button></div>}
      {data?.map((z) => (
        <div key={z.id} className="border border-line bg-white/80 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium">{z.name} {z.is_domestic && <Badge tone="gold">Domestic</Badge>} {!z.is_active && <Badge>Inactive</Badge>}</p>
              <p className="text-xs text-charcoal-500">{z.country_codes.join(', ')} · {z.provider_name ?? 'no courier'} · {z.estimated_days_min}–{z.estimated_days_max} days</p></div>
            {can('shipping.write') && <div className="flex gap-3"><button className="text-xs underline" onClick={() => { setErr(null); setEdit(z) }}>Edit</button><button className="text-xs text-red-800 underline" onClick={() => del.mutate(z.id)}>Delete</button></div>}
          </div>
          {z.warnings.map((w) => <Alert key={w} tone="warn" className="mt-3">{w}</Alert>)}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">{z.rates.map((r, i) => <span key={i} className="border border-line px-2 py-1">≤ {r.max_weight_grams} g: {formatINR(r.fee)} (+{formatINR(r.fragile_surcharge)} fragile)</span>)}</div>
        </div>
      ))}
      {edit && (
        <Dialog open wide onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : 'Add zone'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name"><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Courier"><Select value={edit.provider_id ?? ''} onChange={(e) => setEdit({ ...edit, provider_id: e.target.value ? Number(e.target.value) : null })}><option value="">None</option>{providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <Field label="Countries" hint="ISO codes, comma-separated. * = rest of world"><Input value={(edit.country_codes ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, country_codes: e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) })} /></Field>
              <div className="grid grid-cols-2 gap-3"><Field label="Days (min)"><Input type="number" value={edit.estimated_days_min ?? 3} onChange={(e) => setEdit({ ...edit, estimated_days_min: Number(e.target.value) })} /></Field><Field label="Days (max)"><Input type="number" value={edit.estimated_days_max ?? 7} onChange={(e) => setEdit({ ...edit, estimated_days_max: Number(e.target.value) })} /></Field></div>
            </div>
            <div className="flex gap-6"><Checkbox label="Domestic zone" checked={!!edit.is_domestic} onChange={(e) => setEdit({ ...edit, is_domestic: e.target.checked })} /><Checkbox label="Active" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /></div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-charcoal-600">Weight bands</p>
            {(edit.rates ?? []).map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <Input aria-label="Up to grams" placeholder="Up to (g)" value={r.max_weight_grams} onChange={(e) => setRate(i, 'max_weight_grams', e.target.value)} />
                <Input aria-label="Fee" placeholder="Fee ₹" value={r.fee} onChange={(e) => setRate(i, 'fee', e.target.value)} />
                <Input aria-label="Fragile surcharge" placeholder="Fragile +₹" value={r.fragile_surcharge} onChange={(e) => setRate(i, 'fragile_surcharge', e.target.value)} />
                <Button variant="ghost" size="sm" aria-label="Remove band" onClick={() => setEdit({ ...edit, rates: (edit.rates ?? []).filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setEdit({ ...edit, rates: [...(edit.rates ?? []), { max_weight_grams: 1000, fee: '0', fragile_surcharge: '0' }] })}>+ Add band</Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}

function Destinations() {
  const qc = useQueryClient()
  const { can } = useAdmin()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'destinations'], queryFn: () => adminApi.get<Dest[]>('/admin/shipping/destinations') })
  const [edit, setEdit] = useState<Partial<Dest> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: () => adminApi.put('/admin/shipping/destinations', { country_code: edit!.country_code, country_name: edit!.country_name, is_enabled: edit!.is_enabled ?? true, allows_fragile: edit!.allows_fragile ?? true, currency_code: edit!.currency_code ?? 'INR', postal_code_regex: edit!.postal_code_regex || null, customs_note: edit!.customs_note || null, restriction_reason: edit!.restriction_reason || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'destinations'] }); setEdit(null) }, onError: (e) => setErr(errorMessage(e)),
  })
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-4">
      {can('shipping.write') && <div className="flex justify-end"><Button size="sm" onClick={() => { setErr(null); setEdit({ is_enabled: true, allows_fragile: true }) }}>Add destination</Button></div>}
      <Table head={['Country', 'Code', 'Status', 'Fragile', 'Postal format', 'Customs note', '']}>
        {data?.map((d) => <tr key={d.id}><Td>{d.country_name}</Td><Td>{d.country_code}</Td><Td>{d.is_enabled ? <Badge tone="good">Ships</Badge> : <Badge tone="bad">Blocked</Badge>}</Td>
          <Td>{d.allows_fragile ? 'Yes' : 'No'}</Td><Td className="text-xs">{d.postal_code_regex}</Td><Td className="max-w-xs truncate text-xs">{d.customs_note}</Td>
          <Td>{can('shipping.write') && <button className="text-xs underline" onClick={() => { setErr(null); setEdit(d) }}>Edit</button>}</Td></tr>)}
      </Table>
      {edit && (
        <Dialog open wide onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.country_name}` : 'Add destination'} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Close</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
          <div className="space-y-4">
            {err && <Alert tone="bad">{err}</Alert>}
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Country code"><Input maxLength={2} value={edit.country_code ?? ''} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, country_code: e.target.value.toUpperCase() })} /></Field>
              <Field label="Country name"><Input value={edit.country_name ?? ''} onChange={(e) => setEdit({ ...edit, country_name: e.target.value })} /></Field>
              <Field label="Postal code pattern" hint="Regular expression, optional"><Input value={edit.postal_code_regex ?? ''} onChange={(e) => setEdit({ ...edit, postal_code_regex: e.target.value })} /></Field>
            </div>
            <div className="flex gap-6"><Checkbox label="Shipping enabled" checked={edit.is_enabled ?? true} onChange={(e) => setEdit({ ...edit, is_enabled: e.target.checked })} /><Checkbox label="Accepts fragile items" checked={edit.allows_fragile ?? true} onChange={(e) => setEdit({ ...edit, allows_fragile: e.target.checked })} /></div>
            <Field label="Customs / duties note (shown at checkout)"><Textarea rows={2} value={edit.customs_note ?? ''} onChange={(e) => setEdit({ ...edit, customs_note: e.target.value })} /></Field>
            <Field label="Message when blocked"><Input value={edit.restriction_reason ?? ''} onChange={(e) => setEdit({ ...edit, restriction_reason: e.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </div>
  )
}
