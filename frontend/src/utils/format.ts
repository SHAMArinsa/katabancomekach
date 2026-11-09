const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatINR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(n)) return '—'
  return Number.isInteger(n) ? inrWhole.format(n) : inrPaise.format(n)
}

export function formatMoney(value: string | number | null | undefined, currency = 'INR'): string {
  if (currency === 'INR') return formatINR(value)
  if (value === null || value === undefined || value === '') return '—'
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(Number(value))
  } catch {
    return `${currency} ${value}`
  }
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function humanize(s: string | null | undefined): string {
  if (!s) return '—'
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export const STATUS_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  pending: 'warn', authorized: 'info', paid: 'good', failed: 'bad', partially_refunded: 'info', refunded: 'neutral',
  not_applicable: 'neutral', pending_collection: 'warn', collected: 'good', collection_failed: 'bad', waived: 'neutral',
  disputed: 'bad', unfulfilled: 'neutral', processing: 'info', packed: 'info', dispatched: 'info', delivered: 'good',
  cancelled: 'bad', returned: 'neutral', published: 'good', draft: 'warn', archived: 'neutral', hidden: 'warn',
  requested: 'warn', approved: 'info', rejected: 'bad', received: 'info', closed: 'neutral', submitted: 'warn',
  under_review: 'info', approved_refund: 'good', approved_replacement: 'good', resolved: 'good', open: 'warn',
  pending_customer: 'info', in_stock: 'good', low_stock: 'warn', out_of_stock: 'bad', low: 'warn', out: 'bad', ok: 'good',
  processed: 'good', captured: 'good', created: 'neutral',
}

export const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', AE: 'United Arab Emirates', SG: 'Singapore', AU: 'Australia',
  CA: 'Canada', DE: 'Germany', FR: 'France', NL: 'Netherlands', JP: 'Japan', BR: 'Brazil',
}
