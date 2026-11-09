import { ReactNode, useState } from 'react'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui'
import { cx, humanize } from '@/utils/format'

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('whitespace-nowrap border-b-2 px-4 py-2.5 text-[12px] uppercase tracking-[0.14em] transition',
            value === t.id ? 'border-champagne text-charcoal' : 'border-transparent text-charcoal-500 hover:text-charcoal')}>{t.label}</button>
      ))}
    </div>
  )
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div className="border border-line bg-white/80 p-5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-charcoal-500">{label}</p>
      <p className={cx('mt-2 font-display text-3xl', tone === 'bad' && 'text-red-800', tone === 'warn' && 'text-amber-700', tone === 'good' && 'text-emerald-800')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-charcoal-500">{hint}</p>}
    </div>
  )
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 border border-line bg-white/60 p-4">{children}</div>
}

export function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-charcoal-400">—</span>
  return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all bg-ivory-200/60 p-2 text-[11px]">{JSON.stringify(value, null, 2)}</pre>
}

/* ---------------------------------------------------------------- JSON-schema driven form (business settings) */

type Schema = {
  type?: string; title?: string; enum?: unknown[]; const?: unknown; minimum?: number; maximum?: number; maxLength?: number
  items?: Schema; properties?: Record<string, Schema>; anyOf?: Schema[]; $ref?: string; default?: unknown; description?: string
}

function resolve(s: Schema, defs: Record<string, Schema>): Schema {
  if (s.$ref) return resolve(defs[s.$ref.split('/').pop()!], defs)
  if (s.anyOf) {
    const nonNull = s.anyOf.filter((x) => x.type !== 'null')
    if (nonNull.length === 1) return { ...resolve(nonNull[0], defs), title: s.title }
    const strs = nonNull.find((x) => x.type === 'string' || x.type === 'number')
    if (strs) return { ...strs, title: s.title }
  }
  return s
}

export function SchemaForm({ schema, value, onChange, prefix = '' }: {
  schema: Schema & { $defs?: Record<string, Schema> }; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; prefix?: string
}) {
  const defs = schema.$defs ?? {}
  return <ObjectFields props={schema.properties ?? {}} defs={defs} value={value} onChange={onChange} prefix={prefix} />
}

function ObjectFields({ props, defs, value, onChange, prefix }: {
  props: Record<string, Schema>; defs: Record<string, Schema>; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; prefix: string
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {Object.entries(props).map(([key, raw]) => {
        const s = resolve(raw, defs)
        const id = `${prefix}${key}`
        const label = humanize(key)
        const v = value[key]
        const set = (nv: unknown) => onChange({ ...value, [key]: nv })
        if (s.type === 'object' && s.properties) {
          return (
            <fieldset key={key} className="col-span-full border border-line p-4">
              <legend className="px-2 text-[11px] uppercase tracking-[0.14em] text-charcoal-600">{label}</legend>
              <ObjectFields props={s.properties} defs={defs} value={(v as Record<string, unknown>) ?? {}} onChange={set} prefix={`${id}.`} />
            </fieldset>
          )
        }
        if (s.type === 'boolean') return <div key={key} className="flex items-end pb-2"><Checkbox id={id} label={label} checked={!!v} onChange={(e) => set(e.target.checked)} /></div>
        if (s.enum) {
          return <Field key={key} label={label} htmlFor={id}><Select id={id} value={String(v ?? '')} onChange={(e) => set(e.target.value)}>{s.enum.map((o) => <option key={String(o)} value={String(o)}>{humanize(String(o))}</option>)}</Select></Field>
        }
        if (s.type === 'array') {
          const items = resolve(s.items ?? {}, defs)
          const arr = (v as string[]) ?? []
          if (items.enum) {
            return (
              <Field key={key} label={label}>
                <div className="flex flex-wrap gap-3">
                  {items.enum.map((o) => (
                    <Checkbox key={String(o)} label={humanize(String(o))} checked={arr.includes(String(o))}
                      onChange={(e) => set(e.target.checked ? [...arr, String(o)] : arr.filter((x) => x !== o))} />
                  ))}
                </div>
              </Field>
            )
          }
          return <Field key={key} label={label} htmlFor={id} hint="Comma-separated"><Input id={id} value={arr.join(', ')} onChange={(e) => set(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>
        }
        const isNum = s.type === 'number' || s.type === 'integer' || (typeof v === 'string' && /threshold|amount|percent/.test(key))
        const long = (s.maxLength ?? 0) > 300 || (typeof v === 'string' && v.length > 90)
        return (
          <Field key={key} label={label} htmlFor={id} hint={s.minimum !== undefined && s.maximum !== undefined ? `Range ${s.minimum}–${s.maximum}` : undefined}>
            {long ? <Textarea id={id} value={String(v ?? '')} onChange={(e) => set(e.target.value)} />
              : <Input id={id} inputMode={isNum ? 'decimal' : undefined} value={String(v ?? '')}
                onChange={(e) => set(s.type === 'integer' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}
          </Field>
        )
      })}
    </div>
  )
}

export function useDialog<T = true>() {
  const [state, setState] = useState<T | null>(null)
  return { value: state, open: (v: T) => setState(v), close: () => setState(null), isOpen: state !== null }
}
