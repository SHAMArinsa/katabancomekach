import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SchemaForm, Tabs } from '@/components/admin/kit'
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageLoader, Table, Td, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, ApiError, errorMessage } from '@/services/api'
import { formatDate, humanize } from '@/utils/format'

type Section = 'store' | 'catalog' | 'pricing' | 'shipping' | 'payment' | 'account' | 'content' | 'notifications' | 'privacy'
const SECTIONS: { id: Section | 'currencies'; label: string }[] = [
  { id: 'store', label: 'Store & brand' }, { id: 'catalog', label: 'Catalogue' }, { id: 'pricing', label: 'Pricing & tax' }, { id: 'shipping', label: 'Shipping' },
  { id: 'payment', label: 'Payments' }, { id: 'account', label: 'Customers & accounts' }, { id: 'content', label: 'SEO & newsletter' }, { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy & cookies' }, { id: 'currencies', label: 'Currencies & tax rules' },
]
const HELP: Partial<Record<Section, string>> = {
  shipping: 'Thresholds are compared with the eligible merchandise subtotal in INR. International thresholds are shown to customers in their chosen currency using the exchange rates below.',
  payment: 'Provider credentials live in server environment variables, never here. Live mode can only be enabled when the deployment sets PAYMENT_LIVE_ALLOWED=true.',
  pricing: 'Changing prices or tax never alters existing orders — every order keeps a snapshot.',
}

type AllSettings = Record<Section, { value: Record<string, unknown>; version: number; updated_at: string | null }> & { _server: Record<string, unknown> }

export default function Settings() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('section') as Section | 'currencies') || 'store'
  const { can } = useAdmin()
  const toast = useToast()
  const qc = useQueryClient()
  const all = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => adminApi.get<AllSettings>('/admin/settings') })
  const schema = useQuery({ queryKey: ['admin', 'settings-schema'], queryFn: () => adminApi.get<Record<string, object>>('/admin/settings/schema'), staleTime: Infinity })
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string[] | null>(null)
  useEffect(() => { if (all.data && tab !== 'currencies') { setDraft(all.data[tab].value); setErr(null) } }, [all.data, tab])
  const save = useMutation({
    mutationFn: () => adminApi.patch(`/admin/settings/${tab}`, { ...draft, _reason: reason || undefined }),
    onSuccess: () => { toast('Settings saved'); setReason(''); qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); qc.invalidateQueries({ queryKey: ['public-settings'] }) },
    onError: (e) => setErr(e instanceof ApiError && e.detailList.length ? [e.message, ...e.detailList] : [errorMessage(e)]),
  })
  if (all.isLoading || schema.isLoading || !all.data || !schema.data) return <PageLoader />
  const server = all.data._server
  const editable = can('settings.write') && (tab !== 'payment' || can('settings.payments'))
  return (
    <AdminPage title="Business settings" subtitle="Changes apply immediately, are validated by the server and recorded in the audit log.">
      <Tabs tabs={SECTIONS} value={tab} onChange={(t) => setSp({ section: t })} />
      {tab === 'currencies' ? <Currencies /> : (
        <Card title={SECTIONS.find((s) => s.id === tab)?.label} actions={all.data[tab].updated_at && <span className="text-xs text-charcoal-500">v{all.data[tab].version} · {formatDate(all.data[tab].updated_at, true)}</span>}>
          <div className="space-y-6">
            {HELP[tab] && <Alert tone="info">{HELP[tab]}</Alert>}
            {tab === 'payment' && (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone={server.razorpay_configured ? 'good' : 'warn'}>Razorpay keys {server.razorpay_configured ? 'configured' : 'not configured'}</Badge>
                <Badge tone={server.razorpay_webhook_configured ? 'good' : 'warn'}>Webhook secret {server.razorpay_webhook_configured ? 'set' : 'missing'}</Badge>
                <Badge tone={server.payment_live_allowed ? 'good' : 'neutral'}>Live mode {server.payment_live_allowed ? 'allowed' : 'locked by deployment'}</Badge>
                <Badge>Cash on delivery: never available</Badge>
              </div>
            )}
            {tab === 'notifications' && <div className="text-xs"><Badge tone={server.smtp_configured ? 'good' : 'warn'}>Email: {String(server.email_provider)}{server.smtp_configured ? '' : ' (emails are logged to the server console)'}</Badge></div>}
            {err && <Alert tone="bad"><ul className="list-disc pl-4">{err.map((e) => <li key={e}>{e}</li>)}</ul></Alert>}
            <fieldset disabled={!editable}><SchemaForm schema={schema.data[tab] as never} value={draft} onChange={setDraft} prefix={`${tab}-`} /></fieldset>
            {editable ? (
              <div className="flex flex-wrap items-end gap-3 border-t border-line pt-5">
                <Field label="Reason for change (optional, audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-80" /></Field>
                <Button loading={save.isPending} onClick={() => save.mutate()}>Save {humanize(tab)} settings</Button>
                <Button variant="ghost" onClick={() => setDraft(all.data[tab].value)}>Discard changes</Button>
              </div>
            ) : <p className="text-xs text-charcoal-500">You can view but not change these settings.</p>}
          </div>
        </Card>
      )}
    </AdminPage>
  )
}

interface Cur { code: string; name: string; symbol: string; decimals: number; is_enabled: boolean; is_base: boolean; rate: string | null; rate_source: string | null; rate_updated_at: string | null }
interface TaxRule { id: number; tax_class: string; country_code: string; rate_percent: string; label: string; is_active: boolean }

function Currencies() {
  const qc = useQueryClient()
  const toast = useToast()
  const { can } = useAdmin()
  const cur = useQuery({ queryKey: ['admin', 'currencies'], queryFn: () => adminApi.get<Cur[]>('/admin/currencies') })
  const tax = useQuery({ queryKey: ['admin', 'tax'], queryFn: () => adminApi.get<TaxRule[]>('/admin/tax-rules') })
  const [rates, setRates] = useState<Record<string, string>>({})
  const [newCur, setNewCur] = useState({ code: '', name: '', symbol: '' })
  const [taxEdit, setTaxEdit] = useState({ tax_class: 'standard', country_code: 'IN', rate_percent: '18', label: 'GST', is_active: true })
  const done = (msg: string) => { toast(msg); qc.invalidateQueries({ queryKey: ['admin', 'currencies'] }); qc.invalidateQueries({ queryKey: ['admin', 'tax'] }) }
  const fail = (e: unknown) => toast(errorMessage(e), 'bad')
  const rate = useMutation({ mutationFn: (code: string) => adminApi.post('/admin/exchange-rates', { quote_currency: code, rate: rates[code], source: 'manual' }), onSuccess: () => done('Rate updated'), onError: fail })
  const toggle = useMutation({ mutationFn: (c: Cur) => adminApi.put('/admin/currencies', { code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals, is_enabled: !c.is_enabled }), onSuccess: () => done('Currency updated'), onError: fail })
  const add = useMutation({ mutationFn: () => adminApi.put('/admin/currencies', { ...newCur, decimals: 2, is_enabled: true }), onSuccess: () => { setNewCur({ code: '', name: '', symbol: '' }); done('Currency added') }, onError: fail })
  const saveTax = useMutation({ mutationFn: () => adminApi.put('/admin/tax-rules', taxEdit), onSuccess: () => done('Tax rule saved'), onError: fail })
  if (cur.isLoading || tax.isLoading) return <PageLoader />
  const w = can('settings.write')
  return (
    <div className="space-y-6">
      <Card title="Display currencies & exchange rates">
        <Alert tone="info" className="mb-4">Rates are 1 INR = X units. They are used only for display; customers are always charged in INR. Update them regularly from a trusted source — the seeded rates are indicative.</Alert>
        <Table head={['Currency', 'Rate (1 INR =)', 'Source', 'Updated', 'Enabled', '']}>
          {cur.data?.map((c) => (
            <tr key={c.code}><Td>{c.code} <span className="text-xs text-charcoal-500">{c.name}</span>{c.is_base && <Badge tone="gold" className="ml-2">Base</Badge>}</Td>
              <Td>{c.is_base ? '1' : w ? <Input className="h-8 w-32" defaultValue={c.rate ?? ''} onChange={(e) => setRates({ ...rates, [c.code]: e.target.value })} aria-label={`${c.code} rate`} /> : c.rate}</Td>
              <Td className="text-xs">{c.rate_source}</Td><Td className="text-xs">{formatDate(c.rate_updated_at, true)}</Td>
              <Td>{c.is_base ? 'Yes' : <Checkbox label="" checked={c.is_enabled} disabled={!w} onChange={() => toggle.mutate(c)} />}</Td>
              <Td>{!c.is_base && w && <Button size="sm" variant="ghost" disabled={!rates[c.code]} onClick={() => rate.mutate(c.code)}>Save rate</Button>}</Td></tr>
          ))}
        </Table>
        {w && <div className="mt-4 flex flex-wrap items-end gap-2"><Field label="Code"><Input className="w-24" maxLength={3} value={newCur.code} onChange={(e) => setNewCur({ ...newCur, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name"><Input value={newCur.name} onChange={(e) => setNewCur({ ...newCur, name: e.target.value })} /></Field><Field label="Symbol"><Input className="w-24" value={newCur.symbol} onChange={(e) => setNewCur({ ...newCur, symbol: e.target.value })} /></Field>
          <Button size="sm" variant="secondary" disabled={newCur.code.length !== 3 || !newCur.name || !newCur.symbol} onClick={() => add.mutate()}>Add currency</Button></div>}
      </Card>
      <Card title="Tax rules">
        <p className="mb-4 text-sm text-charcoal-600">Country “*” applies to all international destinations (e.g. zero-rated exports). Confirm rates with your tax adviser.</p>
        <Table head={['Tax class', 'Country', 'Rate', 'Label', 'Active']}>
          {tax.data?.map((t) => <tr key={t.id}><Td>{t.tax_class}</Td><Td>{t.country_code}</Td><Td>{Number(t.rate_percent)}%</Td><Td>{t.label}</Td><Td>{t.is_active ? 'Yes' : 'No'}</Td></tr>)}
        </Table>
        {w && <div className="mt-4 flex flex-wrap items-end gap-2">
          <Field label="Class"><Input className="w-32" value={taxEdit.tax_class} onChange={(e) => setTaxEdit({ ...taxEdit, tax_class: e.target.value })} /></Field>
          <Field label="Country"><Input className="w-20" maxLength={2} value={taxEdit.country_code} onChange={(e) => setTaxEdit({ ...taxEdit, country_code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Rate %"><Input className="w-24" value={taxEdit.rate_percent} onChange={(e) => setTaxEdit({ ...taxEdit, rate_percent: e.target.value })} /></Field>
          <Field label="Label"><Input className="w-32" value={taxEdit.label} onChange={(e) => setTaxEdit({ ...taxEdit, label: e.target.value })} /></Field>
          <div className="pb-2"><Checkbox label="Active" checked={taxEdit.is_active} onChange={(e) => setTaxEdit({ ...taxEdit, is_active: e.target.checked })} /></div>
          <Button size="sm" variant="secondary" onClick={() => saveTax.mutate()}>Save rule</Button></div>}
      </Card>
    </div>
  )
}
