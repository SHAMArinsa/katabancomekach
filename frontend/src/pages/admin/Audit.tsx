import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { FilterBar, Json } from '@/components/admin/kit'
import { Field, Input, PageLoader, Pagination, Table, Td } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi } from '@/services/api'
import type { Paged } from '@/types'
import { formatDate } from '@/utils/format'

interface Log { id: number; actor_email: string | null; action: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown; reason: string | null; ip_address: string | null; created_at: string }

export default function Audit() {
  const [f, setF] = useState({ action: '', actor: '', date_from: '', date_to: '' })
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'audit', f, page], queryFn: () => adminApi.get<Paged<Log>>('/admin/audit-logs', { ...f, page }), placeholderData: (p) => p })
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1) }
  return (
    <AdminPage title="Audit log" subtitle="Sensitive changes — settings, prices, refunds, permissions, restrictions — with who made them and when.">
      <FilterBar>
        <Field label="Action starts with"><Input value={f.action} onChange={(e) => set('action', e.target.value)} placeholder="settings., product., refund." /></Field>
        <Field label="Staff email"><Input value={f.actor} onChange={(e) => set('actor', e.target.value)} /></Field>
        <Field label="From"><Input type="date" value={f.date_from} onChange={(e) => set('date_from', e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={f.date_to} onChange={(e) => set('date_to', e.target.value)} /></Field>
      </FilterBar>
      {isLoading ? <PageLoader /> : (
        <>
          <Table head={['When', 'Who', 'Action', 'Entity', 'Reason', '']} empty={!data?.items.length}>
            {data?.items.map((l) => (
              <Fragment key={l.id}>
                <tr><Td className="text-xs">{formatDate(l.created_at, true)}</Td><Td>{l.actor_email ?? 'system'}</Td><Td><code className="text-xs">{l.action}</code></Td><Td className="text-xs">{l.entity_type} {l.entity_id}</Td><Td className="text-xs">{l.reason}</Td>
                  <Td>{(l.before || l.after) ? <button className="text-xs underline" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide' : 'Details'}</button> : null}</Td></tr>
                {open === l.id && <tr><Td colSpan={6}><div className="grid gap-3 md:grid-cols-2"><div><p className="mb-1 text-xs text-charcoal-500">Before</p><Json value={l.before} /></div><div><p className="mb-1 text-xs text-charcoal-500">After</p><Json value={l.after} /></div></div>{l.ip_address && <p className="mt-2 text-xs text-charcoal-500">IP {l.ip_address}</p>}</Td></tr>}
              </Fragment>
            ))}
          </Table>
          {data && <Pagination page={page} pages={data.pages} onPage={setPage} />}
        </>
      )}
    </AdminPage>
  )
}
