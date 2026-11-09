import { useQuery } from '@tanstack/react-query'
import { Seo } from '@/components/store/Seo'
import { Empty, PageLoader } from '@/components/ui'
import { Markdown } from '@/components/ui/Markdown'
import { api } from '@/services/api'
import { formatDate } from '@/utils/format'

interface Page { slug: string; title: string; body: string; seo_title: string; seo_description: string | null; updated_at: string }

export default function CmsPage({ slug }: { slug: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['page', slug], queryFn: () => api.get<Page>(`/public/pages/${slug}`) })
  if (isLoading) return <PageLoader />
  if (error || !data) return <div className="container-luxe py-24"><Empty title="Page not found" /></div>
  return (
    <article className="mx-auto max-w-3xl px-5 py-16 md:py-24">
      <Seo title={data.seo_title} description={data.seo_description ?? undefined} />
      <h1 className="font-display text-5xl md:text-6xl">{data.title}</h1>
      <p className="mb-12 mt-3 text-xs uppercase tracking-luxe text-charcoal-500">Updated {formatDate(data.updated_at)}</p>
      <Markdown source={data.body} />
    </article>
  )
}
