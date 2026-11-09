/**
 * API client. Access tokens live in memory only; the refresh token is an httpOnly cookie
 * scoped to /api/v1/auth. Customer and admin sessions use separate clients, tokens and cookies.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
  /** Flattened human-readable details (validation messages, blocking issues). */
  get detailList(): string[] {
    if (Array.isArray(this.details)) {
      return this.details.map((d) => (typeof d === 'string' ? d : (d as { msg?: string }).msg ?? JSON.stringify(d)))
    }
    if (this.details && typeof this.details === 'object' && 'missing' in (this.details as object)) return []
    return []
  }
}

type Scope = 'customer' | 'admin'
type Listener = (token: string | null) => void

interface RequestOptions {
  body?: unknown
  form?: FormData
  query?: Record<string, string | number | boolean | undefined | null>
  auth?: boolean
  raw?: boolean
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return ''
  const p = new URLSearchParams()
  Object.entries(query).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export class ApiClient {
  private token: string | null = null
  private refreshing: Promise<string | null> | null = null
  private listeners = new Set<Listener>()
  constructor(private scope: Scope) {}

  get accessToken() { return this.token }

  /** A non-secret hint that a refresh cookie probably exists, so guests don't trigger a 401 on every visit. */
  get hasSessionHint() {
    try { return localStorage.getItem(`gl_session_${this.scope}`) === '1' } catch { return true }
  }

  setToken(token: string | null) {
    this.token = token
    try {
      if (token) localStorage.setItem(`gl_session_${this.scope}`, '1')
      else localStorage.removeItem(`gl_session_${this.scope}`)
    } catch { /* storage unavailable */ }
    this.listeners.forEach((l) => l(token))
  }

  onToken(l: Listener) {
    this.listeners.add(l)
    return () => { this.listeners.delete(l) }
  }

  private refreshPath() { return this.scope === 'admin' ? '/auth/admin/refresh' : '/auth/refresh' }

  /** Exchange the refresh cookie for a new access token. Concurrent callers share one request. */
  async refresh(): Promise<string | null> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const res = await fetch(API_BASE + this.refreshPath(), {
            method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'fetch' },
          })
          if (!res.ok) { this.setToken(null); return null }
          const data = await res.json()
          this.setToken(data.access_token)
          return data.access_token as string
        } catch {
          return null
        } finally {
          setTimeout(() => { this.refreshing = null }, 0)
        }
      })()
    }
    return this.refreshing
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
    const headers: Record<string, string> = { 'X-Requested-With': 'fetch', Accept: 'application/json' }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.token && opts.auth !== false) headers.Authorization = `Bearer ${this.token}`
    let res: Response
    try {
      res = await fetch(API_BASE + path + buildQuery(opts.query), {
        method,
        headers,
        credentials: 'include',
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      })
    } catch {
      throw new ApiError(0, 'network_error', 'We could not reach the server. Check your connection and try again.')
    }
    if (res.status === 401 && retry && opts.auth !== false && !path.startsWith('/auth/')) {
      const t = await this.refresh()
      if (t) return this.request<T>(method, path, opts, false)
    }
    if (opts.raw) {
      if (!res.ok) throw new ApiError(res.status, 'http_error', `Request failed (${res.status})`)
      return res as unknown as T
    }
    const text = await res.text()
    const data = text ? safeJson(text) : null
    if (!res.ok) {
      const err = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error
      throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed (${res.status})`, err?.details)
    }
    return data as T
  }

  get<T>(path: string, query?: RequestOptions['query']) { return this.request<T>('GET', path, { query }) }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, { body: body ?? {} }) }
  put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, { body }) }
  patch<T>(path: string, body?: unknown) { return this.request<T>('PATCH', path, { body }) }
  del<T>(path: string) { return this.request<T>('DELETE', path) }
  upload<T>(path: string, form: FormData) { return this.request<T>('POST', path, { form }) }

  async download(path: string, query: RequestOptions['query'], filename: string) {
    const res = await this.request<Response>('GET', path, { query, raw: true })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async blobUrl(path: string): Promise<string> {
    const res = await this.request<Response>('GET', path, { raw: true })
    return URL.createObjectURL(await res.blob())
  }
}

function safeJson(text: string) {
  try { return JSON.parse(text) } catch { return { error: { code: 'bad_response', message: text.slice(0, 200) } } }
}

export const api = new ApiClient('customer')
export const adminApi = new ApiClient('admin')

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) {
    const extra = e.detailList
    return extra.length ? `${e.message} ${extra.join(' ')}` : e.message
  }
  return fallback
}
