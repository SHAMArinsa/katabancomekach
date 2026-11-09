import { Seo } from '@/components/store/Seo'
import { ButtonLink } from '@/components/ui'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-32 text-center">
      <Seo title="Page not found" noindex />
      <p className="eyebrow">404</p>
      <h1 className="mt-3 font-display text-5xl">This page has slipped away</h1>
      <p className="mt-4 max-w-md text-charcoal-600">The page you are looking for may have moved or no longer exists.</p>
      <ButtonLink to="/shop" className="mt-10">Continue shopping</ButtonLink>
    </div>
  )
}
