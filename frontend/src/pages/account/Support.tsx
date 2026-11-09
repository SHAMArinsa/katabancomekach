import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, Card, Empty, Field, Input, PageLoader, StatusBadge, Textarea, useToast } from '@/components/ui'
import { api, errorMessage } from '@/services/api'
import type { Ticket } from '@/types'
import { cx, formatDate } from '@/utils/format'

export default function Support() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['account', 'tickets'], queryFn: () => api.get<Ticket[]>('/customer/tickets') })
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [order, setOrder] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [reply, setReply] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['account', 'tickets'] })
  const create = useMutation({
    mutationFn: () => api.post('/customer/tickets', { subject, message, order_number: order || undefined }),
    onSuccess: () => { setSubject(''); setMessage(''); setOrder(''); refresh(); toast('Request sent') },
  })
  const send = useMutation({
    mutationFn: (id: number) => api.post(`/customer/tickets/${id}/messages`, { body: reply }),
    onSuccess: () => { setReply(''); refresh() }, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  if (isLoading) return <PageLoader />
  return (
    <div className="space-y-8">
      <Seo title="Support" noindex />
      <h2 className="font-display text-3xl">Customer support</h2>
      <Card title="New request">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); create.mutate() }} className="space-y-4">
          {create.isError && <Alert tone="bad">{errorMessage(create.error)}</Alert>}
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <Field label="Subject" htmlFor="s-sub"><Input id="s-sub" required minLength={3} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Order (optional)" htmlFor="s-ord"><Input id="s-ord" value={order} onChange={(e) => setOrder(e.target.value)} /></Field>
          </div>
          <Field label="Message" htmlFor="s-msg"><Textarea id="s-msg" required minLength={5} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          <Button type="submit" loading={create.isPending}>Send</Button>
        </form>
      </Card>
      {!data?.length ? <Empty title="No conversations yet" /> : (
        <ul className="space-y-3">
          {data.map((t) => (
            <li key={t.id} className="border border-line bg-white/60">
              <button className="flex w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setOpenId(openId === t.id ? null : t.id)} aria-expanded={openId === t.id}>
                <span><span className="font-medium">{t.subject}</span> <span className="text-xs text-charcoal-500">· {formatDate(t.updated_at)}</span></span>
                <StatusBadge status={t.status} />
              </button>
              {openId === t.id && (
                <div className="space-y-3 border-t border-line p-4">
                  {t.messages.map((m) => (
                    <div key={m.id} className={cx('max-w-[85%] p-3 text-sm', m.is_staff ? 'bg-champagne-50' : 'ml-auto bg-ivory-200')}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-[11px] text-charcoal-500">{m.is_staff ? 'Support team' : 'You'} · {formatDate(m.created_at, true)}</p>
                    </div>
                  ))}
                  {t.status !== 'closed' && (
                    <div className="flex gap-2"><Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" aria-label="Reply" />
                      <Button disabled={!reply.trim()} loading={send.isPending} onClick={() => send.mutate(t.id)}>Reply</Button></div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
