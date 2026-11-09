import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'
import type { Category, PublicSettings } from '@/types'

export function useSettings() {
  return useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.get<PublicSettings>('/public/settings'),
    staleTime: 5 * 60_000,
  })
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<Category[]>('/public/categories'),
    staleTime: 5 * 60_000,
  })
}

export interface Destination { country_code: string; country_name: string; enabled: boolean; postal_code_regex: string | null; reason: string | null }

export function useDestinations() {
  return useQuery({
    queryKey: ['destinations'],
    queryFn: () => api.get<Destination[]>('/public/destinations'),
    staleTime: 10 * 60_000,
  })
}

export interface CurrencyInfo { code: string; symbol: string; name: string; decimals: number; rate: string; as_of: string | null }

export function useCurrencies() {
  return useQuery({
    queryKey: ['currencies'],
    queryFn: () => api.get<CurrencyInfo[]>('/public/currencies'),
    staleTime: 10 * 60_000,
  })
}
