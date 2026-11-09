import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X } from 'lucide-react'
import {
  ButtonHTMLAttributes, createContext, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes,
  TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState,
} from 'react'
import { Link } from 'react-router-dom'
import { cx, formatMoney, humanize, STATUS_TONE } from '@/utils/format'

/* ------------------------------------------------------------------ Button */
type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'link'
type Size = 'sm' | 'md' | 'lg'
const variants: Record<Variant, string> = {
  primary: 'bg-champagne-500 text-white hover:bg-champagne-600 border border-champagne-500',
  secondary: 'bg-white text-champagne-600 border border-champagne-400 hover:bg-champagne-50',
  ghost: 'bg-transparent text-charcoal border border-transparent hover:bg-ivory-200',
  gold: 'bg-champagne text-white border border-champagne hover:bg-champagne-500',
  danger: 'bg-white text-red-800 border border-red-200 hover:bg-red-50',
  link: 'bg-transparent text-charcoal underline underline-offset-4 decoration-champagne/60 hover:decoration-champagne px-0',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs', md: 'h-11 px-5 text-[13px]', lg: 'h-13 py-3.5 px-8 text-sm',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-md uppercase tracking-[0.08em] font-semibold transition-colors duration-200',
        'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-champagne',
        variants[variant], variant !== 'link' && sizes[size], block && 'w-full', className)} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
})

export function ButtonLink({ to, variant = 'primary', size = 'md', className, children }: {
  to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode
}) {
  return (
    <Link to={to} className={cx('inline-flex items-center justify-center gap-2 rounded-md uppercase tracking-[0.08em] font-semibold transition-colors duration-200',
      variants[variant], variant !== 'link' && sizes[size], className)}>{children}</Link>
  )
}

/* ------------------------------------------------------------------ Form fields */
export function Field({ label, error, hint, children, htmlFor, required }: {
  label?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={htmlFor} className="block text-[11px] uppercase tracking-[0.16em] text-charcoal-600">
          {label}{required && <span className="text-champagne"> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-charcoal-500">{hint}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </div>
  )
}

const inputBase = 'rounded-md w-full bg-white/70 border border-line px-3.5 h-11 text-sm text-charcoal placeholder:text-charcoal-400 focus:outline-none focus:border-champagne focus:ring-1 focus:ring-champagne/40 transition'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={cx(inputBase, invalid && 'border-red-400', className)} {...rest} />
  })

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={cx(inputBase, 'h-auto py-3 min-h-[110px]', invalid && 'border-red-400', className)} {...rest} />
  })

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return <select ref={ref} aria-invalid={invalid || undefined} className={cx(inputBase, 'pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2355514B%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_12px_center]', invalid && 'border-red-400', className)} {...rest}>{children}</select>
  })

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(
  function Checkbox({ label, className, id, ...rest }, ref) {
    const auto = useId()
    const cid = id ?? auto
    return (
      <label htmlFor={cid} className={cx('flex items-start gap-3 text-sm text-charcoal-700 cursor-pointer', className)}>
        <input ref={ref} id={cid} type="checkbox" className="mt-0.5 h-4 w-4 accent-charcoal border-line" {...rest} />
        <span>{label}</span>
      </label>
    )
  })

/* ------------------------------------------------------------------ Display */
export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={cx('inline-flex', className)}><Loader2 className="h-5 w-5 animate-spin text-champagne" /></span>
}

export function PageLoader() {
  return <div className="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
}

const tones = {
  neutral: 'bg-ivory-200 text-charcoal-600 border-line',
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  warn: 'bg-amber-50 text-amber-800 border-amber-200',
  bad: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  gold: 'bg-champagne-50 text-champagne-600 border-champagne-200',
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <span className={cx('inline-flex items-center border px-2 py-0.5 text-[11px] font-medium tracking-wide', tones[tone], className)}>{children}</span>
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{label ?? humanize(status)}</Badge>
}

export function Price({ value, compareAt, currency = 'INR', className, size = 'md' }: {
  value: string | number | null | undefined; compareAt?: string | number | null; currency?: string; className?: string; size?: 'sm' | 'md' | 'lg'
}) {
  const sz = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base'
  return (
    <span className={cx('inline-flex items-baseline gap-2', className)}>
      <span className={cx(sz, 'text-charcoal')}>{formatMoney(value, currency)}</span>
      {compareAt && Number(compareAt) > Number(value) && (
        <>
          <span className="sr-only">Original price</span>
          <s className="text-sm text-charcoal-400">{formatMoney(compareAt, currency)}</s>
        </>
      )}
    </span>
  )
}

export function Alert({ tone = 'info', title, children, className }: {
  tone?: 'info' | 'good' | 'warn' | 'bad'; title?: ReactNode; children?: ReactNode; className?: string
}) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle
  const t = { info: 'border-champagne-200 bg-champagne-50/60 text-charcoal-700', good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900', bad: 'border-red-200 bg-red-50 text-red-900' }[tone]
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex gap-3 border px-4 py-3 text-sm', t, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">{title && <p className="font-medium">{title}</p>}{children && <div>{children}</div>}</div>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center border border-dashed border-line px-6 py-16 text-center">
      <p className="font-display text-2xl">{title}</p>
      {children && <div className="mt-2 max-w-md text-sm text-charcoal-500">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('border border-line bg-white/80', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-[12px] font-medium uppercase tracking-[0.16em] text-charcoal-600">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  return (
    <nav className="flex items-center justify-center gap-4 pt-8" aria-label="Pagination">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
      <span className="text-xs uppercase tracking-luxe text-charcoal-500">Page {page} of {pages}</span>
      <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
    </nav>
  )
}

export function SectionHeading({ eyebrow, title, subtitle, action, align = 'left' }: {
  eyebrow?: string; title: ReactNode; subtitle?: ReactNode; action?: ReactNode; align?: 'left' | 'center'
}) {
  return (
    <div className={cx('mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between', align === 'center' && 'items-center text-center md:flex-col md:items-center')}>
      <div className={cx('max-w-2xl', align === 'center' && 'mx-auto')}>
        {eyebrow && <p className="mb-3 text-[11px] uppercase tracking-luxe text-champagne-500">{eyebrow}</p>}
        <h2 className="font-display text-4xl leading-tight md:text-[44px]">{title}</h2>
        {subtitle && <p className="mt-3 text-[15px] leading-relaxed text-charcoal-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ Dialog */
export function Dialog({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cx('relative max-h-[90vh] w-full overflow-auto bg-ivory shadow-2xl animate-fade-up outline-none', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-display text-2xl">{title}</h2>
          <button onClick={onClose} className="p-1 text-charcoal-500 hover:text-charcoal" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="px-6 py-5">{children}</div>
        {footer && <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</footer>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose, children }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean
  onConfirm: () => void; onClose: () => void; children?: ReactNode
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <div className="space-y-4 text-sm text-charcoal-700">{message}{children}</div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Toasts */
type Toast = { id: number; tone: 'good' | 'bad' | 'info'; text: string }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-3 border bg-ivory px-4 py-3 text-sm shadow-soft animate-fade-up',
            t.tone === 'bad' ? 'border-red-200' : t.tone === 'info' ? 'border-champagne-200' : 'border-emerald-200')}>
            {t.tone === 'bad' ? <AlertCircle className="h-4 w-4 text-red-700" /> : <CheckCircle2 className="h-4 w-4 text-emerald-700" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/* ------------------------------------------------------------------ Table */
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto border border-line bg-white/80">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line bg-ivory-200/60">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-3 text-[11px] font-medium uppercase tracking-[0.14em] text-charcoal-600">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-10 text-center text-sm text-charcoal-500">Nothing to show yet.</p>}
    </div>
  )
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx('px-4 py-3 align-middle', className)}>{children}</td>
}
