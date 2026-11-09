/**
 * Bag state. Guests keep items in localStorage and get quotes from POST /shipping/quote.
 * Signed-in customers use the server bag (/customer/cart). On sign-in the guest bag is merged.
 * Every amount displayed comes from the backend quote — the browser never calculates prices.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/CustomerAuth'
import { api } from '@/services/api'
import type { Quote } from '@/types'

export interface GuestItem { variant_id: number; quantity: number; gift_wrap: boolean }
const KEY = 'gl_guest_bag_v1'
const PREF_KEY = 'gl_bag_prefs_v1'

function readGuest(): GuestItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function writeGuest(items: GuestItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)) } catch { /* storage unavailable */ }
}
function readPrefs(): { country: string; postal: string; currency: string; coupon: string } {
  try { return { country: 'IN', postal: '', currency: 'INR', coupon: '', ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } }
  catch { return { country: 'IN', postal: '', currency: 'INR', coupon: '' } }
}

interface Ctx {
  quote: Quote | undefined
  loading: boolean
  count: number
  country: string
  postal: string
  currency: string
  setDestination: (country: string, postal?: string) => void
  setCurrency: (c: string) => void
  add: (variantId: number, quantity: number, giftWrap?: boolean) => Promise<void>
  setQty: (variantId: number, giftWrap: boolean, quantity: number) => Promise<void>
  remove: (variantId: number, giftWrap: boolean) => Promise<void>
  applyCoupon: (code: string | null) => Promise<Quote | undefined>
  drawerOpen: boolean
  setDrawerOpen: (v: boolean) => void
  refetch: () => void
}

const CartCtx = createContext<Ctx | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const qc = useQueryClient()
  const [guest, setGuest] = useState<GuestItem[]>(readGuest)
  const [prefs, setPrefs] = useState(readPrefs)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => { writeGuest(guest) }, [guest])
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* ignore */ } }, [prefs])

  // Merge guest bag into the account bag after sign-in.
  useEffect(() => {
    if (!ready || !user || guest.length === 0) return
    api.post<Quote>('/customer/cart/merge', guest).then((q) => {
      setGuest([])
      qc.setQueryData(['cart', 'server', prefs.country, prefs.postal, prefs.currency], q)
    }).catch(() => { /* keep guest bag for retry */ })
  }, [ready, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const serverKey = ['cart', 'server', prefs.country, prefs.postal, prefs.currency]
  const serverQ = useQuery({
    queryKey: serverKey,
    enabled: ready && !!user,
    queryFn: () => api.get<Quote>('/customer/cart', { country: prefs.country, postal_code: prefs.postal || undefined, currency: prefs.currency }),
  })
  const guestQ = useQuery({
    queryKey: ['cart', 'guest', guest, prefs],
    enabled: ready && !user && guest.length > 0,
    queryFn: () => api.post<Quote>('/shipping/quote', {
      items: guest, country_code: prefs.country, postal_code: prefs.postal || undefined,
      coupon_code: prefs.coupon || undefined, display_currency: prefs.currency,
    }),
    placeholderData: (prev) => prev,
  })

  const quote = user ? serverQ.data : (guest.length ? guestQ.data : undefined)
  const setServer = useCallback((q: Quote) => {
    qc.setQueryData(serverKey, q)
    qc.invalidateQueries({ queryKey: ['cart', 'server'] })
  }, [qc, prefs]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = useCallback(async (variantId: number, quantity: number, giftWrap = false) => {
    if (user) {
      setServer(await api.post<Quote>('/customer/cart/items', { variant_id: variantId, quantity, gift_wrap: giftWrap }))
    } else {
      // Validate availability server-side before storing (quote reports stock issues).
      const next = [...guest]
      const ex = next.find((i) => i.variant_id === variantId && i.gift_wrap === giftWrap)
      if (ex) ex.quantity = Math.min(99, ex.quantity + quantity)
      else next.push({ variant_id: variantId, quantity, gift_wrap: giftWrap })
      const q = await api.post<Quote>('/shipping/quote', { items: next, country_code: prefs.country, display_currency: prefs.currency })
      const line = q.lines.find((l) => l.variant_id === variantId && l.gift_wrap === giftWrap)
      if (line?.issue) throw new Error(line.issue)
      setGuest(next)
    }
  }, [user, guest, prefs, setServer])

  const setQty = useCallback(async (variantId: number, giftWrap: boolean, quantity: number) => {
    if (user) {
      const line = quote?.lines.find((l) => l.variant_id === variantId && l.gift_wrap === giftWrap)
      if (!line?.cart_item_id) return
      setServer(await api.patch<Quote>(`/customer/cart/items/${line.cart_item_id}`, { quantity }))
    } else {
      setGuest((g) => g.map((i) => i.variant_id === variantId && i.gift_wrap === giftWrap ? { ...i, quantity } : i).filter((i) => i.quantity > 0))
    }
  }, [user, quote, setServer])

  const remove = useCallback((variantId: number, giftWrap: boolean) => setQty(variantId, giftWrap, 0), [setQty])

  const applyCoupon = useCallback(async (code: string | null) => {
    if (user) {
      const q = await api.put<Quote>('/customer/cart/coupon', { code })
      setServer(q)
      return q
    }
    setPrefs((p) => ({ ...p, coupon: code ?? '' }))
    return undefined
  }, [user, setServer])

  const value: Ctx = useMemo(() => ({
    quote,
    loading: user ? serverQ.isLoading : guestQ.isLoading && guest.length > 0,
    count: user ? (quote?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0) : guest.reduce((n, i) => n + i.quantity, 0),
    country: prefs.country, postal: prefs.postal, currency: prefs.currency,
    setDestination: (country: string, postal = '') => setPrefs((p) => ({ ...p, country, postal })),
    setCurrency: (currency: string) => setPrefs((p) => ({ ...p, currency })),
    add, setQty, remove, applyCoupon, drawerOpen, setDrawerOpen,
    refetch: () => { void (user ? serverQ.refetch() : guestQ.refetch()) },
  }), [quote, user, serverQ, guestQ, guest, prefs, add, setQty, remove, applyCoupon, drawerOpen])

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>
}

export function useCart() {
  const ctx = useContext(CartCtx)
  if (!ctx) throw new Error('useCart outside provider')
  return ctx
}
