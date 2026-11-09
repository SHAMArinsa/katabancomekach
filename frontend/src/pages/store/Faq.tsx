import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Seo } from '@/components/store/Seo'
import { Empty, PageLoader } from '@/components/ui'
import { api } from '@/services/api'

interface Faq { id: number; question: string; answer: string; group: string }

export default function FaqPage() {
  const { data, isLoading } = useQuery({ queryKey: ['faqs'], queryFn: () => api.get<Faq[]>('/public/faqs') })
  if (isLoading) return <PageLoader />
  const groups = Array.from(new Set((data ?? []).map((f) => f.group)))
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: (data ?? []).map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) }
  return (
    <div className="mx-auto max-w-3xl px-5 py-16 md:py-24">
      <Seo title="Frequently asked questions" jsonLd={ld} />
      <p className="eyebrow">Help</p>
      <h1 className="mt-2 font-display text-5xl md:text-6xl">Frequently asked questions</h1>
      {!data?.length ? <div className="mt-10"><Empty title="No FAQs yet" /></div> : groups.map((g) => (
        <section key={g} className="mt-12">
          <h2 className="mb-2 text-[11px] uppercase tracking-luxe text-champagne-500">{g}</h2>
          <div className="divide-y divide-line border-y border-line">
            {data.filter((f) => f.group === g).map((f) => (
              <details key={f.id} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-xl">{f.question}<span className="text-champagne transition group-open:rotate-45">+</span></summary>
                <p className="mt-3 text-[15px] leading-relaxed text-charcoal-600">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="mt-12 text-sm text-charcoal-600">Still have a question? <Link to="/contact" className="underline decoration-champagne underline-offset-4">Contact us</Link>.</p>
    </div>
  )
}
