import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Checkbox, Field, Input } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { useSettings } from '@/features/catalog/hooks'
import { registerSchema, RegisterValues } from '@/schemas/forms'
import { errorMessage } from '@/services/api'
import { AuthShell } from './AuthShell'
import { safeNext } from './Login'

export default function Register() {
  const { register: signUp, user, ready } = useAuth()
  const { data: settings } = useSettings()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [err, setErr] = useState<string | null>(null)
  const min = settings?.account.password_min_length ?? 10
  const mixed = settings?.account.password_require_mixed ?? true
  const schema = useMemo(() => registerSchema(min, mixed), [min, mixed])
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({ resolver: zodResolver(schema) })
  if (ready && user) return <Navigate to={safeNext(sp.get('next'))} replace />
  if (settings && !settings.account.registration_enabled) {
    return <AuthShell title="Create an account"><Alert tone="info">New registrations are paused at the moment. Please check back soon.</Alert></AuthShell>
  }
  const onSubmit = async (v: RegisterValues) => {
    setErr(null)
    try {
      const res = await signUp(v)
      nav(res.email_verification_required ? '/verify-email?sent=1' : safeNext(sp.get('next')), { replace: true, state: { devLink: res.dev_verification_link } })
    } catch (e) { setErr(errorMessage(e)) }
  }
  return (
    <AuthShell title="Create an account" eyebrow="Join us" footer={<>Already have an account? <Link to="/login" className="underline decoration-champagne underline-offset-4">Sign in</Link></>}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {err && <Alert tone="bad">{err}</Alert>}
        <Field label="Full name" htmlFor="r-name" error={errors.full_name?.message}><Input id="r-name" autoComplete="name" {...register('full_name')} invalid={!!errors.full_name} /></Field>
        <Field label="Email" htmlFor="r-email" error={errors.email?.message}><Input id="r-email" type="email" autoComplete="email" {...register('email')} invalid={!!errors.email} /></Field>
        <Field label="Password" htmlFor="r-pw" error={errors.password?.message} hint={`At least ${min} characters${mixed ? ', with letters and numbers' : ''}.`}>
          <Input id="r-pw" type="password" autoComplete="new-password" {...register('password')} invalid={!!errors.password} />
        </Field>
        <Checkbox {...register('accept_terms')} label={<span>I agree to the <Link to="/terms" className="underline">terms</Link> and <Link to="/privacy-policy" className="underline">privacy policy</Link>.</span>} />
        {errors.accept_terms && <p className="text-xs text-red-700">{errors.accept_terms.message}</p>}
        <Checkbox {...register('marketing_opt_in')} label="Send me news about new collections (optional)." />
        <Button type="submit" block loading={isSubmitting}>Create account</Button>
      </form>
    </AuthShell>
  )
}
