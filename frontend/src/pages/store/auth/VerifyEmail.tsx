import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Alert, Button, ButtonLink, Spinner } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { api, errorMessage } from '@/services/api'
import { AuthShell } from './AuthShell'

export default function VerifyEmail() {
  const [sp] = useSearchParams()
  const token = sp.get('token')
  const { user, reload } = useAuth()
  const ran = useRef(false)
  const loc = useLocation()
  const devLink = (loc.state as { devLink?: string } | null)?.devLink
  const verify = useMutation({ mutationFn: () => api.post('/auth/verify-email', { token }), onSuccess: () => { if (user) reload() } })
  const resend = useMutation({ mutationFn: () => api.post<{ dev_verification_link?: string | null }>('/auth/resend-verification') })
  const link = resend.data?.dev_verification_link ?? devLink
  useEffect(() => { if (token && !ran.current) { ran.current = true; verify.mutate() } }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthShell title="Verify your email">
      {token ? (
        verify.isPending ? <div className="flex justify-center"><Spinner /></div>
          : verify.isSuccess ? <div className="space-y-5"><Alert tone="good" title="Email verified">Thank you — your account is ready.</Alert><ButtonLink to="/shop" className="w-full">Start shopping</ButtonLink></div>
            : verify.isError ? <Alert tone="bad">{errorMessage(verify.error)}</Alert> : null
      ) : (
        <div className="space-y-5 text-sm text-charcoal-700">
          {sp.get('sent') && <Alert tone="good">Account created. We have emailed you a verification link.</Alert>}
          {link && (
            <div className="border border-dashed border-champagne-300 bg-champagne-50/60 p-4">
              <p className="font-medium">Local testing shortcut</p>
              <p className="mt-1 text-xs text-charcoal-600">Emails aren’t sent in development, so here is your link.</p>
              <ButtonLink to={link} className="mt-3 w-full">Verify my email now</ButtonLink>
            </div>
          )}
          <p>Open the link we sent to {user?.email ?? 'your inbox'} to confirm your email address. You will need a verified email to place an order.</p>
          {user && !user.email_verified && (
            <>
              <Button variant="secondary" block loading={resend.isPending} onClick={() => resend.mutate()}>Resend link</Button>
              {resend.isSuccess && <Alert tone="good">A new link is on its way.</Alert>}
            </>
          )}
          {!user && <p><Link to="/login" className="underline">Sign in</Link> to resend the link.</p>}
        </div>
      )}
    </AuthShell>
  )
}
