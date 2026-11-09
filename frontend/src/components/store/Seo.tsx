import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettings } from '@/features/catalog/hooks'

function setMeta(attr: 'name' | 'property', key: string, content: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!content) { el?.remove(); return }
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el) }
  el.setAttribute('content', content)
}

/** Client-side SEO: title, description, canonical, Open Graph and optional JSON-LD structured data. */
export function Seo({ title, description, image, type = 'website', jsonLd, noindex }: {
  title?: string; description?: string; image?: string | null; type?: string; jsonLd?: object; noindex?: boolean
}) {
  const { data: settings } = useSettings()
  const { pathname } = useLocation()
  const brand = settings?.store.brand_name ?? import.meta.env.VITE_APP_NAME ?? 'Glass Luxury Store'
  const fullTitle = title ? `${title} — ${brand}` : (settings?.content.seo_default_title ?? brand)
  const desc = description || settings?.content.seo_default_description
  const ld = jsonLd ? JSON.stringify(jsonLd) : ''

  useEffect(() => {
    document.title = fullTitle
    const url = window.location.origin + pathname
    setMeta('name', 'description', desc)
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : undefined)
    setMeta('property', 'og:title', fullTitle)
    setMeta('property', 'og:description', desc)
    setMeta('property', 'og:type', type)
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:site_name', brand)
    setMeta('property', 'og:image', image ? new URL(image, window.location.origin).toString() : undefined)
    setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link) }
    link.href = url
    const id = 'ld-json'
    document.getElementById(id)?.remove()
    if (ld) {
      const s = document.createElement('script')
      s.type = 'application/ld+json'
      s.id = id
      s.textContent = ld
      document.head.appendChild(s)
    }
    return () => { document.getElementById(id)?.remove() }
  }, [fullTitle, desc, image, type, pathname, brand, noindex, ld])
  return null
}
