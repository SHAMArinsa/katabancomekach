import { Fragment, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * Tiny, safe renderer for admin-authored content: headings (##), lists (-), paragraphs,
 * **bold**, *italic* and [links](/path). Produces React elements only — never raw HTML.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyBase}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={k} className="font-medium text-charcoal">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('[')) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      const href = lm[2]
      if (href.startsWith('/')) out.push(<Link key={k} to={href} className="underline decoration-champagne underline-offset-4">{lm[1]}</Link>)
      else if (/^https?:\/\//.test(href)) out.push(<a key={k} href={href} rel="noopener noreferrer" target="_blank" className="underline decoration-champagne underline-offset-4">{lm[1]}</a>)
      else out.push(lm[1])
    } else out.push(<em key={k}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = (source || '').replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className={className ?? 'space-y-4 text-[15px] leading-relaxed text-charcoal-700'}>
      {blocks.map((b, bi) => {
        const t = b.trim()
        if (!t) return null
        if (t.startsWith('### ')) return <h4 key={bi} className="pt-2 text-sm font-medium uppercase tracking-[0.14em]">{inline(t.slice(4), `h${bi}`)}</h4>
        if (t.startsWith('## ')) return <h3 key={bi} className="pt-4 font-display text-2xl text-charcoal">{inline(t.slice(3), `h${bi}`)}</h3>
        if (t.startsWith('# ')) return <h2 key={bi} className="pt-4 font-display text-3xl text-charcoal">{inline(t.slice(2), `h${bi}`)}</h2>
        const lines = t.split('\n')
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return <ul key={bi} className="list-disc space-y-1.5 pl-5 marker:text-champagne">{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*] /, ''), `l${bi}${li}`)}</li>)}</ul>
        }
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `p${bi}${li}`)}</Fragment>)}</p>
      })}
    </div>
  )
}
