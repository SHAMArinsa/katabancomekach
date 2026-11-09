import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, Field, Input } from '@/components/ui'
import { DemoLogin } from '@/components/ui/DemoLogin'
import { useSettings } from '@/features/catalog/hooks'
import { useAdmin } from '@/features/admin/AdminAuth'
import { adminLoginSchema, AdminLoginValues } from '@/schemas/forms'
import { ApiError, errorMessage } from '@/services/api'

export default function AdminLogin() {
  const { login, admin, ready } = useAdmin()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [err, setErr] = useState<string | null>(null)
  const [needMfa, setNeedMfa] = useState(false)
  const { data: settings } = useSettings()
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<AdminLoginValues>({ resolver: zodResolver(adminLoginSchema) })
  const next = sp.get('next')?.startsWith('/admin') ? sp.get('next')! : '/admin'
  if (ready && admin) return <Navigate to={next} replace />
  const onSubmit = async (v: AdminLoginValues) => {
    setErr(null)
    try { await login(v.email, v.password, v.mfa_code); nav(next, { replace: true }) } catch (e) {
      if (e instanceof ApiError && e.code === 'mfa_required') { setNeedMfa(true); return }
      setErr(errorMessage(e))
    }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-charcoal px-5">
      <Seo title="Admin sign in" noindex />
      <div className="w-full max-w-sm">
        <p className="text-center text-[11px] uppercase tracking-luxe text-champagne-300">Administration</p>
        <h1 className="mt-2 text-center font-display text-4xl text-ivory">Staff sign in</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-5 bg-ivory p-7" noValidate>
          {err && <Alert tone="bad">{err}</Alert>}
          <DemoLogin dark account={settings?.environment.demo_accounts?.admin} onUse={(e, p) => { setValue('email', e); setValue('password', p) }} />
          <Field label="Email" htmlFor="ad-email" error={errors.email?.message}><Input id="ad-email" type="email" autoComplete="username" {...register('email')} /></Field>
          <Field label="Password" htmlFor="ad-pw" error={errors.password?.message}><Input id="ad-pw" type="password" autoComplete="current-password" {...register('password')} /></Field>
          {needMfa && <Field label="Authenticator code" htmlFor="ad-mfa" hint="6-digit code from your authenticator app"><Input id="ad-mfa" inputMode="numeric" autoComplete="one-time-code" autoFocus {...register('mfa_code')} /></Field>}
          <Button type="submit" block loading={isSubmitting}>Sign in</Button>
          <p className="text-center text-xs text-charcoal-500">Staff accounts are created by a Super Admin. There is no public registration.</p>
        </form>
      </div>
    </div>
  )
}
