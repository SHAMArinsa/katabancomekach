import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GlassImage } from '@/components/store/ProductCard'
import { Seo } from '@/components/store/Seo'
import { Empty, PageLoader } from '@/components/ui'
import { api } from '@/services/api'

interface Col { id: number; name: string; slug: string; kind: string; description: string; image_url: string | null }

export default function Collections() {
  const { data, isLoading } = useQuery({ queryKey: ['collections'], queryFn: () => api.get<Col[]>('/public/collections') })
  if (isLoading) return <PageLoader />
  return (
    <div className="container-luxe py-14">
      <Seo title="Collections" description="Featured, gift, seasonal, designer and premium collections." />
      <p className="eyebrow">Curated</p>
      <h1 className="mb-12 mt-2 font-display text-5xl md:text-6xl">Collections</h1>
      {!data?.length ? <Empty title="No collections yet" /> : (
        <div className="grid gap-x-8 gap-y-14 md:grid-cols-2">
          {data.map((c) => (
            <Link key={c.id} to={`/collections/${c.slug}`} className="group">
              <div className="aspect-[4/3] overflow-hidden bg-ivory-200"><GlassImage src={c.image_url} alt={c.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" /></div>
              <p className="mt-5 text-[10px] uppercase tracking-luxe text-champagne-500">{c.kind}</p>
              <h2 className="font-display text-3xl">{c.name}</h2>
              <p className="mt-2 max-w-md text-charcoal-600">{c.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
