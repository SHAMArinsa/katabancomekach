import { useMutation } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, ButtonLink, Field, Input } from '@/components/ui'
import { api, errorMessage } from '@/services/api'
import { AuthShell } from './AuthShell'

export default function ResetPassword({ admin }: { admin?: boolean }) {
  const [sp] = useSearchParams()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const m = useMutation({ mutationFn: () => api.post('/auth/reset-password', { token: sp.get('token'), password: pw }) })
  const submit = (e: FormEvent) => { e.preventDefault(); if (pw !== pw2) { setMismatch(true); return } setMismatch(false); m.mutate() }
  return (
    <AuthShell title="Choose a new password">
      {m.isSuccess ? (
        <div className="space-y-5"><Alert tone="good">Your password has been updated.</Alert><ButtonLink to={admin ? '/admin/login' : '/login'} className="w-full">Sign in</ButtonLink></div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          {!sp.get('token') && <Alert tone="bad">This link is missing its token. Please use the link from your email.</Alert>}
          {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
          <Field label="New password" htmlFor="np"><Input id="np" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Confirm password" htmlFor="np2" error={mismatch ? 'Passwords do not match' : undefined}><Input id="np2" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button type="submit" block loading={m.isPending}>Update password</Button>
        </form>
      )}
    </AuthShell>
  )
}
