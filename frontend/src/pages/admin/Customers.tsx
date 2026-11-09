import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FilterBar } from '@/components/admin/kit'
import { Badge, Checkbox, Field, Input, PageLoader, Pagination, Table, Td } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi } from '@/services/api'
import type { Paged } from '@/types'
import { formatDate } from '@/utils/format'

interface C { id: number; email: string; full_name: string; phone: string | null; email_verified: boolean; created_at: string; restricted: boolean; deletion_requested_at: string | null; deleted: boolean; order_count: number; last_login_at: string | null }

export default function Customers() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [deletion, setDeletion] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'customers', q, page, deletion], queryFn: () => adminApi.get<Paged<C>>('/admin/customers', { q: q || undefined, page, deletion_requested: deletion }), placeholderData: (p) => p })
  return (
    <AdminPage title="Customers">
      <FilterBar>
        <Field label="Search"><Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Name, email or phone" className="w-72" /></Field>
        <div className="pb-2"><Checkbox label="Deletion requested" checked={deletion} onChange={(e) => setDeletion(e.target.checked)} /></div>
      </FilterBar>
      {isLoading ? <PageLoader /> : (
        <>
          <Table head={['Customer', 'Email', 'Orders', 'Joined', 'Last sign-in', 'Flags']} empty={!data?.items.length}>
            {data?.items.map((c) => (
              <tr key={c.id}><Td><Link to={`/admin/customers/${c.id}`} className="font-medium hover:underline">{c.full_name}</Link></Td><Td>{c.email}</Td><Td>{c.order_count}</Td>
                <Td className="text-xs">{formatDate(c.created_at)}</Td><Td className="text-xs">{formatDate(c.last_login_at)}</Td>
                <Td className="space-x-1">{!c.email_verified && <Badge tone="warn">Unverified</Badge>}{c.restricted && <Badge tone="bad">Restricted</Badge>}{c.deletion_requested_at && !c.deleted && <Badge tone="info">Deletion requested</Badge>}{c.deleted && <Badge>Deleted</Badge>}</Td></tr>
            ))}
          </Table>
          {data && <Pagination page={page} pages={data.pages} onPage={setPage} />}
        </>
      )}
    </AdminPage>
  )
}
