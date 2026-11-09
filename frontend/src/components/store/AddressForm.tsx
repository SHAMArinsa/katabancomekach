import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Button, Checkbox, Field, Input, Select } from '@/components/ui'
import { useDestinations } from '@/features/catalog/hooks'
import { addressSchema, AddressValues } from '@/schemas/forms'

export function AddressForm({ initial, onSubmit, submitLabel = 'Save address', busy, showDefault = true, onChange, children }: {
  initial?: Partial<AddressValues>; onSubmit: (v: AddressValues) => void; submitLabel?: string; busy?: boolean
  showDefault?: boolean; onChange?: (v: Partial<AddressValues>) => void; children?: React.ReactNode
}) {
  const { data: dests } = useDestinations()
  const { register, handleSubmit, watch, formState: { errors } } = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: { country_code: 'IN', label: 'Home', ...initial } as AddressValues,
  })
  const country = watch('country_code')
  const postal = watch('postal_code')
  useEffect(() => { onChange?.({ country_code: country, postal_code: postal }) }, [country, postal]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Full name" htmlFor="a-name" error={errors.full_name?.message} required><Input id="a-name" autoComplete="name" {...register('full_name')} invalid={!!errors.full_name} /></Field>
        <Field label="Phone" htmlFor="a-phone" error={errors.phone?.message} hint="For the courier only" required><Input id="a-phone" type="tel" autoComplete="tel" {...register('phone')} invalid={!!errors.phone} /></Field>
      </div>
      <Field label="Address" htmlFor="a-l1" error={errors.line1?.message} required><Input id="a-l1" autoComplete="address-line1" {...register('line1')} invalid={!!errors.line1} /></Field>
      <Field label="Apartment, suite (optional)" htmlFor="a-l2"><Input id="a-l2" autoComplete="address-line2" {...register('line2')} /></Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="City" htmlFor="a-city" error={errors.city?.message} required><Input id="a-city" autoComplete="address-level2" {...register('city')} invalid={!!errors.city} /></Field>
        <Field label="State / region" htmlFor="a-state"><Input id="a-state" autoComplete="address-level1" {...register('state')} /></Field>
        <Field label={country === 'IN' ? 'PIN code' : 'Postal code'} htmlFor="a-pc" error={errors.postal_code?.message} required><Input id="a-pc" autoComplete="postal-code" {...register('postal_code')} invalid={!!errors.postal_code} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Country" htmlFor="a-cc" error={errors.country_code?.message} required>
          <Select id="a-cc" autoComplete="country" {...register('country_code')}>
            {(dests ?? [{ country_code: 'IN', country_name: 'India', enabled: true }]).map((d) => (
              <option key={d.country_code} value={d.country_code} disabled={!d.enabled}>{d.country_name}{!d.enabled ? ' — not available' : ''}</option>
            ))}
          </Select>
        </Field>
        {showDefault && <Field label="Label" htmlFor="a-label"><Input id="a-label" {...register('label')} /></Field>}
      </div>
      {showDefault && <Checkbox label="Make this my default address" {...register('is_default')} />}
      {children}
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  )
}
