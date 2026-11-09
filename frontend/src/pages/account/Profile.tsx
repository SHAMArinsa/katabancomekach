import { useMutation } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, Card, Checkbox, ConfirmDialog, Field, Input, useToast } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { api, errorMessage } from '@/services/api'

export default function Profile() {
  const { user, reload } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user?.full_name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [optIn, setOptIn] = useState(user?.marketing_opt_in ?? false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [delOpen, setDelOpen] = useState(false)
  const save = useMutation({
    mutationFn: () => api.patch('/customer/profile', { full_name: name, phone: phone || null, marketing_opt_in: optIn }),
    onSuccess: () => { reload(); toast('Profile updated') }, onError: (e) => toast(errorMessage(e), 'bad'),
  })
  const pw = useMutation({
    mutationFn: () => api.post('/customer/password', { current_password: cur, new_password: next }),
    onSuccess: () => { setCur(''); setNext(''); toast('Password changed') },
  })
  const del = useMutation({ mutationFn: () => api.post<{ message: string }>('/customer/delete-request'), onSuccess: () => setDelOpen(false) })
  return (
    <div className="space-y-8">
      <Seo title="Profile" noindex />
      <h2 className="font-display text-3xl">Profile</h2>
      <Card title="Your details">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate() }} className="max-w-lg space-y-4">
          <Field label="Email"><Input value={user?.email ?? ''} disabled /></Field>
          <Field label="Full name" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Phone" htmlFor="p-phone"><Input id="p-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Checkbox checked={optIn} onChange={(e) => setOptIn(e.target.checked)} label="Email me about new collections and private previews" />
          <Button type="submit" loading={save.isPending}>Save</Button>
        </form>
      </Card>
      <Card title="Password">
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); pw.mutate() }} className="max-w-lg space-y-4">
          {pw.isError && <Alert tone="bad">{errorMessage(pw.error)}</Alert>}
          <Field label="Current password" htmlFor="p-cur"><Input id="p-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
          <Field label="New password" htmlFor="p-new"><Input id="p-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
          <Button type="submit" variant="secondary" loading={pw.isPending}>Change password</Button>
        </form>
      </Card>
      <Card title="Privacy">
        {del.isSuccess ? <Alert tone="good">{del.data.message}</Alert> : (
          <div className="space-y-3 text-sm text-charcoal-600">
            <p>You can ask us to delete your account. Order records we must keep for tax purposes are retained in anonymised form.</p>
            <Button variant="danger" size="sm" onClick={() => setDelOpen(true)}>Request account deletion</Button>
          </div>
        )}
      </Card>
      <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} title="Delete your account?" danger confirmLabel="Request deletion"
        loading={del.isPending} onConfirm={() => del.mutate()} message="Our team will process your request and confirm by email. This cannot be undone." />
    </div>
  )
}
