import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { useAdmin } from '@/features/admin/AdminAuth'
import { AdminPage } from '@/layouts/AdminLayout'
import { adminApi, errorMessage } from '@/services/api'

function PasswordCard() {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const m = useMutation({ mutationFn: () => adminApi.post('/admin/me/password', { current_password: cur, new_password: next }), onSuccess: () => { setCur(''); setNext('') } })
  return (
    <Card title="Password">
      <div className="max-w-lg space-y-4">
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        {m.isSuccess && <Alert tone="good">Password changed.</Alert>}
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 12 characters with letters and numbers"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Button variant="secondary" loading={m.isPending} disabled={!cur || next.length < 12} onClick={() => m.mutate()}>Change password</Button>
      </div>
    </Card>
  )
}

export default function Account() {
  const { admin, reload } = useAdmin()
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null)
  const [code, setCode] = useState('')
  const start = useMutation({ mutationFn: () => adminApi.post<{ secret: string; otpauth_uri: string }>('/admin/me/mfa/setup'), onSuccess: setSetup })
  const enable = useMutation({ mutationFn: () => adminApi.post('/admin/me/mfa/enable', { code }), onSuccess: () => { setSetup(null); setCode(''); reload() } })
  const disable = useMutation({ mutationFn: () => adminApi.post('/admin/me/mfa/disable', { code }), onSuccess: () => { setCode(''); reload() } })
  const err = start.error ?? enable.error ?? disable.error
  return (
    <AdminPage title="Account security" subtitle={`${admin?.full_name} · ${admin?.email}`}>
      <Card title="Two-factor authentication (TOTP)">
        <div className="max-w-lg space-y-4 text-sm">
          {err && <Alert tone="bad">{errorMessage(err)}</Alert>}
          {admin?.mfa_enabled ? (
            <>
              <Alert tone="good">Two-factor authentication is on. You will be asked for a code at each sign-in.</Alert>
              <Field label="Enter a current code to turn it off"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <Button variant="danger" loading={disable.isPending} disabled={code.length < 6} onClick={() => disable.mutate()}>Turn off</Button>
            </>
          ) : setup ? (
            <>
              <p>Add this key to an authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.</p>
              <p className="break-all border border-line bg-white p-3 font-mono text-xs">{setup.secret}</p>
              <p className="break-all text-xs text-charcoal-500">{setup.otpauth_uri}</p>
              <Field label="Code from your app"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></Field>
              <Button loading={enable.isPending} disabled={code.length < 6} onClick={() => enable.mutate()}>Verify & turn on</Button>
            </>
          ) : (
            <>
              <p>Protect your admin account with a time-based one-time code in addition to your password. Strongly recommended for every staff member.</p>
              <Button loading={start.isPending} onClick={() => start.mutate()}>Set up two-factor authentication</Button>
            </>
          )}
        </div>
      </Card>
      <PasswordCard />
    </AdminPage>
  )
}
