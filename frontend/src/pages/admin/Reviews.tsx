import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Checkbox, Empty, PageLoader } from '@/components/ui'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi } from '@/services/api'
import { formatDate } from '@/utils/format'

interface R { id: number; product_name: string; rating: number; title: string; body: string; display_name: string; is_approved: boolean; created_at: string }

export default function Reviews() {
  const [pending, setPending] = useState(true)
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'reviews', pending], queryFn: () => adminApi.get<R[]>('/admin/reviews', { pending }) })
  const m = useMutation({ mutationFn: ({ id, approve }: { id: number; approve: boolean }) => adminApi.post(`/admin/reviews/${id}?approve=${approve}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reviews'] }) })
  return (
    <AdminPage title="Reviews" subtitle="Only verified purchasers can review. Nothing is published until approved — never add reviews on a customer's behalf.">
      <Checkbox label="Pending only" checked={pending} onChange={(e) => setPending(e.target.checked)} />
      {isLoading ? <PageLoader /> : !data?.length ? <Empty title="No reviews to moderate" /> : (
        <div className="space-y-3">
          {data.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 border border-line bg-white/80 p-4 md:flex-row md:items-start md:justify-between">
              <div className="text-sm"><p className="text-xs text-charcoal-500">{r.product_name} · {formatDate(r.created_at)} · {r.display_name}</p>
                <p className="text-champagne">{'★'.repeat(r.rating)}</p><p className="font-medium">{r.title}</p><p className="text-charcoal-700">{r.body}</p></div>
              {!r.is_approved && <div className="flex gap-2"><Button size="sm" onClick={() => m.mutate({ id: r.id, approve: true })}>Approve</Button><Button size="sm" variant="danger" onClick={() => m.mutate({ id: r.id, approve: false })}>Reject</Button></div>}
            </div>
          ))}
        </div>
      )}
    </AdminPage>
  )
}
