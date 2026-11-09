import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FilterBar, Tabs } from '@/components/admin/kit'
import { Alert, Button, Dialog, Field, Input, PageLoader, Select, StatusBadge, Table, Td, useToast } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'
import { formatDate, humanize } from '@/utils/format'

interface Row { variant_id: number; product_id: number; product_name: string; variant_name: string; sku: string; on_hand: number; reserved: number; available: number; low_stock_threshold: number; state: string; product_status: string; variant_active: boolean }
interface Move { id: number; sku: string; change: number; reason: string; note: string | null; order_number: string | null; on_hand_after: number; created_at: string }
interface Res { id: number; sku: string; order_number: string; quantity: number; expires_at: string; expired: boolean }

export default function Inventory() {
  const [tab, setTab] = useState<'stock' | 'movements' | 'reservations'>('stock')
  const [q, setQ] = useState('')
  const [state, setState] = useState('')
  const [adjust, setAdjust] = useState<Row | null>(null)
  const { can } = useAdmin()
  const toast = useToast()
  const qc = useQueryClient()
  const stock = useQuery({ queryKey: ['admin', 'inventory', q, state], enabled: tab === 'stock', queryFn: () => adminApi.get<Row[]>('/admin/inventory', { q: q || undefined, state: state || undefined }) })
  const moves = useQuery({ queryKey: ['admin', 'movements'], enabled: tab === 'movements', queryFn: () => adminApi.get<Move[]>('/admin/inventory/movements') })
  const res = useQuery({ queryKey: ['admin', 'reservations'], enabled: tab === 'reservations', queryFn: () => adminApi.get<Res[]>('/admin/inventory/reservations') })
  const sweep = useMutation({ mutationFn: () => adminApi.post<{ expired_orders: number }>('/admin/inventory/reservations/sweep'), onSuccess: (r) => { toast(`${r.expired_orders} expired order(s) released`); res.refetch() }, onError: (e) => toast(errorMessage(e), 'bad') })
  return (
    <AdminPage title="Inventory">
      <Tabs tabs={[{ id: 'stock', label: 'Stock levels' }, { id: 'movements', label: 'Movements' }, { id: 'reservations', label: 'Reservations' }]} value={tab} onChange={setTab} />
      {tab === 'stock' && (
        <>
          <FilterBar>
            <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product or SKU" /></Field>
            <Field label="Alert"><Select value={state} onChange={(e) => setState(e.target.value)} className="w-40"><option value="">All</option><option value="low">Low stock</option><option value="out">Out of stock</option></Select></Field>
          </FilterBar>
          {stock.isLoading ? <PageLoader /> : (
            <Table head={['Product', 'Variant', 'SKU', 'On hand', 'Reserved', 'Available', 'Alert', '']} empty={!stock.data?.length}>
              {stock.data?.map((r) => (
                <tr key={r.variant_id}>
                  <Td><Link to={`/admin/products/${r.product_id}`} className="hover:underline">{r.product_name}</Link></Td><Td>{r.variant_name}{!r.variant_active && ' (inactive)'}</Td><Td className="text-xs">{r.sku}</Td>
                  <Td>{r.on_hand}</Td><Td>{r.reserved}</Td><Td>{r.available}</Td><Td><StatusBadge status={r.state} label={r.state === 'ok' ? 'OK' : undefined} /></Td>
                  <Td>{can('inventory.write') && <button className="text-xs underline" onClick={() => setAdjust(r)}>Adjust</button>}</Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
      {tab === 'movements' && (moves.isLoading ? <PageLoader /> : (
        <Table head={['When', 'SKU', 'Change', 'Reason', 'Order', 'On hand after', 'Note']} empty={!moves.data?.length}>
          {moves.data?.map((m) => <tr key={m.id}><Td className="text-xs">{formatDate(m.created_at, true)}</Td><Td className="text-xs">{m.sku}</Td>
            <Td className={m.change < 0 ? 'text-red-800' : 'text-emerald-800'}>{m.change > 0 ? '+' : ''}{m.change}</Td><Td>{humanize(m.reason)}</Td>
            <Td>{m.order_number && <Link to={`/admin/orders/${m.order_number}`} className="underline">{m.order_number}</Link>}</Td><Td>{m.on_hand_after}</Td><Td className="text-xs">{m.note}</Td></tr>)}
        </Table>
      ))}
      {tab === 'reservations' && (
        <>
          <div className="flex items-center justify-between"><p className="text-sm text-charcoal-600">Stock held for unpaid orders. Expired holds are released automatically at checkout or by the scheduled job.</p>
            {can('inventory.write') && <Button size="sm" variant="secondary" loading={sweep.isPending} onClick={() => sweep.mutate()}>Release expired now</Button>}</div>
          {res.isLoading ? <PageLoader /> : (
            <Table head={['Order', 'SKU', 'Qty', 'Expires']} empty={!res.data?.length}>
              {res.data?.map((r) => <tr key={r.id}><Td><Link to={`/admin/orders/${r.order_number}`} className="underline">{r.order_number}</Link></Td><Td className="text-xs">{r.sku}</Td><Td>{r.quantity}</Td><Td className={r.expired ? 'text-red-800' : ''}>{formatDate(r.expires_at, true)}{r.expired && ' (expired)'}</Td></tr>)}
            </Table>
          )}
        </>
      )}
      {adjust && <AdjustDialog row={adjust} onClose={() => setAdjust(null)} onDone={() => { setAdjust(null); qc.invalidateQueries({ queryKey: ['admin', 'inventory'] }) }} />}
    </AdminPage>
  )
}

function AdjustDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'set' | 'delta'>('delta')
  const [val, setVal] = useState('')
  const [reason, setReason] = useState('restock')
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => adminApi.post('/admin/inventory/adjust', { variant_id: row.variant_id, ...(mode === 'set' ? { set_to: Number(val) } : { delta: Number(val) }), reason, note: note || undefined }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onClose={onClose} title={`Adjust stock · ${row.sku}`} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={m.isPending} disabled={val === '' || Number.isNaN(Number(val))} onClick={() => m.mutate()}>Save adjustment</Button></>}>
      <div className="space-y-4">
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        <p className="text-sm">On hand <strong>{row.on_hand}</strong> · reserved <strong>{row.reserved}</strong></p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value as 'set' | 'delta')}><option value="delta">Add / remove</option><option value="set">Set exact count</option></Select></Field>
          <Field label={mode === 'set' ? 'New on-hand quantity' : 'Change (+/−)'}><Input inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value)} /></Field>
          <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{['restock', 'adjustment', 'damage', 'correction', 'return'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  )
}
