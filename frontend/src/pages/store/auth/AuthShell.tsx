import { ReactNode } from 'react'
import { Seo } from '@/components/store/Seo'

export function AuthShell({ title, eyebrow, children, footer }: { title: string; eyebrow?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-5 py-16 md:py-24">
      <Seo title={title} noindex />
      {eyebrow && <p className="eyebrow text-center">{eyebrow}</p>}
      <h1 className="mt-2 text-center font-display text-5xl">{title}</h1>
      <div className="mt-10 border border-line bg-white/70 p-6 md:p-8">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-charcoal-600">{footer}</div>}
    </div>
  )
}
