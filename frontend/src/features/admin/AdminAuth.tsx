import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { adminApi } from '@/services/api'
import type { StaffUser } from '@/types'

interface Ctx {
  admin: StaffUser | null
  ready: boolean
  login: (email: string, password: string, mfa_code?: string) => Promise<StaffUser>
  logout: () => Promise<void>
  can: (...perms: string[]) => boolean
  reload: () => Promise<void>
}

const AdminCtx = createContext<Ctx | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<StaffUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const t = adminApi.hasSessionHint ? await adminApi.refresh() : null
      if (t && alive) {
        try { setAdmin(await adminApi.get<StaffUser>('/auth/admin/me')) } catch { /* ignore */ }
      }
      if (alive) setReady(true)
    })()
    const off = adminApi.onToken((t) => { if (!t) setAdmin(null) })
    return () => { alive = false; off() }
  }, [])

  const login = useCallback(async (email: string, password: string, mfa_code?: string) => {
    const res = await adminApi.post<{ access_token: string; user: StaffUser }>('/auth/admin/login', { email, password, mfa_code: mfa_code || undefined })
    adminApi.setToken(res.access_token)
    setAdmin(res.user)
    return res.user
  }, [])

  const logout = useCallback(async () => {
    try { await adminApi.post('/auth/admin/logout') } finally { adminApi.setToken(null); setAdmin(null) }
  }, [])

  const reload = useCallback(async () => { setAdmin(await adminApi.get<StaffUser>('/auth/admin/me')) }, [])
  const can = useCallback((...perms: string[]) => !!admin && perms.every((p) => admin.permissions.includes(p)), [admin])

  const value = useMemo(() => ({ admin, ready, login, logout, can, reload }), [admin, ready, login, logout, can, reload])
  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>
}

export function useAdmin() {
  const ctx = useContext(AdminCtx)
  if (!ctx) throw new Error('useAdmin outside provider')
  return ctx
}
