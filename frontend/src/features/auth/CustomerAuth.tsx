import { useQueryClient } from '@tanstack/react-query'
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '@/services/api'
import type { User } from '@/types'

interface Ctx {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<User>
  register: (data: Record<string, unknown>) => Promise<{ user: User; email_verification_required: boolean; dev_verification_link?: string | null }>
  logout: () => Promise<void>
  reload: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    let alive = true
    ;(async () => {
      const token = api.hasSessionHint ? await api.refresh() : null
      if (token && alive) {
        try { setUser(await api.get<User>('/auth/me')) } catch { /* session invalid */ }
      }
      if (alive) setReady(true)
    })()
    const off = api.onToken((t) => { if (!t) setUser(null) })
    return () => { alive = false; off() }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ access_token: string; user: User }>('/auth/login', { email, password })
    api.setToken(res.access_token)
    setUser(res.user)
    qc.invalidateQueries({ queryKey: ['cart'] })
    return res.user
  }, [qc])

  const register = useCallback(async (data: Record<string, unknown>) => {
    const res = await api.post<{ access_token: string; user: User; email_verification_required: boolean; dev_verification_link?: string | null }>('/auth/register', data)
    api.setToken(res.access_token)
    setUser(res.user)
    return res
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } finally {
      api.setToken(null)
      setUser(null)
      qc.removeQueries({ queryKey: ['cart'] })
      qc.removeQueries({ queryKey: ['account'] })
    }
  }, [qc])

  const reload = useCallback(async () => { setUser(await api.get<User>('/auth/me')) }, [])

  const value = useMemo(() => ({ user, ready, login, register, logout, reload }), [user, ready, login, register, logout, reload])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
