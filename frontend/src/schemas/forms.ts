import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const adminLoginSchema = loginSchema.extend({ mfa_code: z.string().trim().max(8).optional() })
export type AdminLoginValues = z.infer<typeof adminLoginSchema>

export function passwordSchema(minLength = 10, requireMixed = true) {
  let s = z.string().min(minLength, `Use at least ${minLength} characters`).max(128)
  if (requireMixed) {
    s = s.regex(/[A-Za-z]/, 'Include at least one letter').regex(/\d/, 'Include at least one number')
  }
  return s
}

export function registerSchema(minLength = 10, requireMixed = true) {
  return z.object({
    full_name: z.string().trim().min(1, 'Enter your name').max(160),
    email: z.string().trim().email('Enter a valid email address'),
    password: passwordSchema(minLength, requireMixed),
    accept_terms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms and privacy policy' }) }),
    marketing_opt_in: z.boolean().optional(),
  })
}
export type RegisterValues = z.infer<ReturnType<typeof registerSchema>>

const postal = z.string().trim().min(2, 'Enter a postal code').max(20)

export const addressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  full_name: z.string().trim().min(1, 'Enter the recipient name').max(160),
  phone: z.string().trim().min(5, 'Enter a phone number for the courier').max(32),
  line1: z.string().trim().min(1, 'Enter the street address').max(255),
  line2: z.string().trim().max(255).optional().or(z.literal('')),
  city: z.string().trim().min(1, 'Enter the city').max(120),
  state: z.string().trim().max(120).optional().or(z.literal('')),
  postal_code: postal,
  country_code: z.string().length(2, 'Choose a country'),
  is_default: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.country_code === 'IN' && !/^[1-9]\d{5}$/.test(v.postal_code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['postal_code'], message: 'Enter a valid 6-digit PIN code' })
  }
})
export type AddressValues = z.infer<typeof addressSchema>

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(160),
  email: z.string().trim().email('Enter a valid email address'),
  subject: z.string().trim().min(3, 'Add a short subject').max(200),
  order_number: z.string().trim().max(24).optional().or(z.literal('')),
  message: z.string().trim().min(5, 'Tell us a little more').max(5000),
})
export type ContactValues = z.infer<typeof contactSchema>

export const checkoutTermsSchema = z.object({
  accept_shipping_terms: z.literal(true, { errorMap: () => ({ message: 'Please confirm the delivery terms' }) }),
})
