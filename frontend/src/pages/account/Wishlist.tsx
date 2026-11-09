import { ProductGrid, useWishlist } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { ButtonLink, Empty, PageLoader } from '@/components/ui'

export default function Wishlist() {
  const { data, isLoading } = useWishlist()
  if (isLoading) return <PageLoader />
  return (
    <div>
      <Seo title="Wishlist" noindex />
      <h2 className="mb-6 font-display text-3xl">Wishlist</h2>
      {!data?.length ? <Empty title="Nothing saved yet" action={<ButtonLink to="/shop">Discover pieces</ButtonLink>}>Tap the heart on any piece to keep it here.</Empty>
        : <ProductGrid products={data} columns={3} />}
    </div>
  )
}
