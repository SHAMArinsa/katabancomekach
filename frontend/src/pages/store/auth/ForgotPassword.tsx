import { useMutation } from '@tanstack/react-query'
import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { api, errorMessage } from '@/services/api'
import { AuthShell } from './AuthShell'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const m = useMutation({ mutationFn: () => api.post<{ message: string }>('/auth/forgot-password', { email }) })
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }
  return (
    <AuthShell title="Reset password" footer={<Link to="/login" className="underline">Back to sign in</Link>}>
      {m.isSuccess ? <Alert tone="good">{m.data.message}</Alert> : (
        <form onSubmit={submit} className="space-y-5">
          {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
          <p className="text-sm text-charcoal-600">Enter your email and we will send you a link to choose a new password.</p>
          <Field label="Email" htmlFor="f-email"><Input id="f-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" block loading={m.isPending}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  )
}
