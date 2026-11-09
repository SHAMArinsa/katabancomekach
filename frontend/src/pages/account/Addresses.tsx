import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { AddressForm } from '@/components/store/AddressForm'
import { Seo } from '@/components/store/Seo'
import { Badge, Button, ConfirmDialog, Dialog, Empty, PageLoader, useToast } from '@/components/ui'
import type { AddressValues } from '@/schemas/forms'
import { api, errorMessage } from '@/services/api'
import type { Address } from '@/types'
import { COUNTRY_NAMES } from '@/utils/format'

export default function Addresses() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['account', 'addresses'], queryFn: () => api.get<Address[]>('/customer/addresses') })
  const [editing, setEditing] = useState<Address | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Address | null>(null)
  const done = () => qc.invalidateQueries({ queryKey: ['account', 'addresses'] })
  const save = useMutation({
    mutationFn: (v: AddressValues) => editing && editing !== 'new' ? api.put(`/customer/addresses/${editing.id}`, v) : api.post('/customer/addresses', v),
    onSuccess: () => { done(); setEditing(null); toast('Address saved') },
    onError: (e) => toast(errorMessage(e), 'bad'),
  })
  const del = useMutation({ mutationFn: (id: number) => api.del(`/customer/addresses/${id}`), onSuccess: () => { done(); setDeleting(null) } })
  if (isLoading) return <PageLoader />
  return (
    <div>
      <Seo title="Addresses" noindex />
      <div className="mb-6 flex items-center justify-between"><h2 className="font-display text-3xl">Addresses</h2><Button size="sm" onClick={() => setEditing('new')}>Add address</Button></div>
      {!data?.length ? <Empty title="No saved addresses" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((a) => (
            <div key={a.id} className="border border-line bg-white/60 p-5 text-sm">
              <div className="mb-2 flex items-center gap-2"><p className="font-medium">{a.label}</p>{a.is_default && <Badge tone="gold">Default</Badge>}</div>
              <p>{a.full_name}</p><p className="text-charcoal-600">{a.line1}{a.line2 && `, ${a.line2}`}</p>
              <p className="text-charcoal-600">{a.city}{a.state && `, ${a.state}`} {a.postal_code} · {COUNTRY_NAMES[a.country_code] ?? a.country_code}</p>
              <p className="text-charcoal-600">{a.phone}</p>
              <div className="mt-4 flex gap-4 text-xs uppercase tracking-[0.14em]">
                <button onClick={() => setEditing(a)} className="underline">Edit</button>
                <button onClick={() => setDeleting(a)} className="text-red-800 underline">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <Dialog open wide onClose={() => setEditing(null)} title={editing === 'new' ? 'Add address' : 'Edit address'}>
          <AddressForm initial={editing === 'new' ? undefined : { ...editing, line2: editing.line2 ?? '', state: editing.state ?? '' } as Partial<AddressValues>}
            busy={save.isPending} onSubmit={(v) => save.mutate(v)} />
        </Dialog>
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete address?" danger confirmLabel="Delete"
        message="This address will be removed from your account." loading={del.isPending} onConfirm={() => deleting?.id && del.mutate(deleting.id)} />
    </div>
  )
}
