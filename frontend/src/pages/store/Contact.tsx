import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Mail, MapPin, Phone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Seo } from '@/components/store/Seo'
import { Alert, Button, Field, Input, Textarea } from '@/components/ui'
import { useAuth } from '@/features/auth/CustomerAuth'
import { useSettings } from '@/features/catalog/hooks'
import { contactSchema, ContactValues } from '@/schemas/forms'
import { api, errorMessage } from '@/services/api'

export default function Contact() {
  const { data: s } = useSettings()
  const { user } = useAuth()
  const { register, handleSubmit, formState: { errors }, reset } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema), values: { name: user?.full_name ?? '', email: user?.email ?? '', subject: '', message: '', order_number: '' },
  })
  const m = useMutation({ mutationFn: (v: ContactValues) => api.post('/public/contact', { ...v, order_number: v.order_number || undefined }), onSuccess: () => reset() })
  return (
    <div className="container-luxe grid gap-14 py-16 md:grid-cols-[1fr_1.3fr] md:py-24">
      <Seo title="Contact us" />
      <div>
        <p className="eyebrow">We are here to help</p>
        <h1 className="mt-2 font-display text-5xl">Contact us</h1>
        <p className="mt-5 max-w-sm text-charcoal-600">Questions about a piece, an order or a gift? Write to us and we will reply within one business day.</p>
        <ul className="mt-10 space-y-4 text-sm">
          {s?.account.support_email && <li className="flex gap-3"><Mail className="h-4 w-4 text-champagne" /><a href={`mailto:${s.account.support_email}`}>{s.account.support_email}</a></li>}
          {(s?.account.support_phone || s?.store.contact_phone) && <li className="flex gap-3"><Phone className="h-4 w-4 text-champagne" />{s?.account.support_phone || s?.store.contact_phone}</li>}
          {s?.store.business_address && <li className="flex gap-3"><MapPin className="h-4 w-4 text-champagne" />{s.store.business_address}</li>}
        </ul>
      </div>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="space-y-5 border border-line bg-white/60 p-6 md:p-10" noValidate>
        {m.isSuccess && <Alert tone="good" title="Message sent">Thank you — we will be in touch shortly.</Alert>}
        {m.isError && <Alert tone="bad">{errorMessage(m.error)}</Alert>}
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Name" error={errors.name?.message} htmlFor="c-name" required><Input id="c-name" {...register('name')} invalid={!!errors.name} /></Field>
          <Field label="Email" error={errors.email?.message} htmlFor="c-email" required><Input id="c-email" type="email" {...register('email')} invalid={!!errors.email} /></Field>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Subject" error={errors.subject?.message} htmlFor="c-subj" required><Input id="c-subj" {...register('subject')} invalid={!!errors.subject} /></Field>
          <Field label="Order number (optional)" htmlFor="c-ord"><Input id="c-ord" {...register('order_number')} /></Field>
        </div>
        <Field label="Message" error={errors.message?.message} htmlFor="c-msg" required><Textarea id="c-msg" rows={6} {...register('message')} invalid={!!errors.message} /></Field>
        <Button type="submit" loading={m.isPending}>Send message</Button>
      </form>
    </div>
  )
}
