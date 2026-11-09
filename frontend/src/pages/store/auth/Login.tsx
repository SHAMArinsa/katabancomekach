import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { DemoLogin } from '@/components/ui/DemoLogin'
import { useSettings } from '@/features/catalog/hooks'
import { useAuth } from '@/features/auth/CustomerAuth'
import { loginSchema, LoginValues } from '@/schemas/forms'
import { errorMessage } from '@/services/api'
import { AuthShell } from './AuthShell'

export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/admin') ? next : '/account'
}

export default function Login() {
  const { login, user, ready } = useAuth()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [err, setErr] = useState<string | null>(null)
  const { data: settings } = useSettings()
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })
  if (ready && user) return <Navigate to={safeNext(sp.get('next'))} replace />
  const onSubmit = async (v: LoginValues) => {
    setErr(null)
    try { await login(v.email, v.password); nav(safeNext(sp.get('next')), { replace: true }) } catch (e) { setErr(errorMessage(e)) }
  }
  return (
    <AuthShell title="Sign in" eyebrow="Welcome back" footer={<>New here? <Link to={`/register${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`} className="underline decoration-champagne underline-offset-4">Create an account</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {err && <Alert tone="bad">{err}</Alert>}
        <DemoLogin account={settings?.environment.demo_accounts?.customer} onUse={(e, p) => { setValue('email', e); setValue('password', p) }} />
        <Field label="Email" htmlFor="l-email" error={errors.email?.message}><Input id="l-email" type="email" autoComplete="email" {...register('email')} invalid={!!errors.email} /></Field>
        <Field label="Password" htmlFor="l-pw" error={errors.password?.message}><Input id="l-pw" type="password" autoComplete="current-password" {...register('password')} invalid={!!errors.password} /></Field>
        <Button type="submit" block loading={isSubmitting}>Sign in</Button>
        <p className="text-center text-sm"><Link to="/forgot-password" className="text-charcoal-600 underline underline-offset-4">Forgot your password?</Link></p>
      </form>
    </AuthShell>
  )
}
