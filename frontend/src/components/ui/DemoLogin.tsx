import { KeyRound } from 'lucide-react'

/** Shown on sign-in pages in local development only (the API exposes demo logins only when APP_ENV=development). */
export function DemoLogin({ account, onUse, dark }: { account?: { email: string; password: string } | null; onUse: (email: string, password: string) => void; dark?: boolean }) {
  if (!account) return null
  return (
    <div className={`flex items-start gap-3 border border-dashed p-4 text-sm ${dark ? 'border-champagne-300/50 text-charcoal-700' : 'border-champagne-300 bg-champagne-50/60'}`} data-testid="demo-login">
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-champagne-500" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">Demo login (local testing)</p>
        <p className="mt-1 font-mono text-xs">{account.email}</p>
        <p className="font-mono text-xs">{account.password}</p>
      </div>
      <button type="button" onClick={() => onUse(account.email, account.password)}
        className="self-center whitespace-nowrap border border-charcoal px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] hover:bg-charcoal hover:text-ivory">Use</button>
    </div>
  )
}
