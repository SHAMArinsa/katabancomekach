export type Money = string

export interface ImageRef { url: string; alt: string }

export interface ProductCard {
  id: number
  name: string
  slug: string
  sku: string
  short_description: string
  price: Money
  compare_at_price: Money | null
  on_sale: boolean
  image: ImageRef | null
  hover_image: ImageRef | null
  category: { name: string; slug: string } | null
  badge: string | null
  is_new_arrival: boolean
  is_bestseller: boolean
  is_featured: boolean
  stock_state: 'in_stock' | 'low_stock' | 'out_of_stock'
  default_variant_id: number | null
  has_variants: boolean
}

export interface Variant {
  id: number
  sku: string
  name: string
  options: Record<string, string>
  is_default: boolean
  price: Money
  compare_at_price: Money | null
  available: boolean
  available_quantity: number
  price_override?: Money | null
  is_active?: boolean
  on_hand?: number
  reserved?: number
  position?: number
}

export interface Review { rating: number; title: string; body: string; display_name: string; created_at?: string }

export interface ProductDetail extends ProductCard {
  description: string
  brand: string | null
  glass_type: string | null
  material: string | null
  color: string | null
  finish: string | null
  dimensions: string | null
  capacity: string | null
  weight_grams: number | null
  fragility: 'standard' | 'fragile' | 'highly_fragile'
  care_instructions: string
  gift_wrap_available: boolean
  gift_wrap_price: Money
  ships_internationally: boolean
  images: { id: number; url: string; alt: string; media_type: string; position: number }[]
  variants: Variant[]
  attributes: { name: string; value: string }[]
  collections: { name: string; slug: string }[]
  seo_title: string
  seo_description: string
  available_quantity: number
  country_of_origin: string
  related?: ProductCard[]
  reviews?: Review[]
  rating?: { average: number; count: number } | null
  breadcrumbs?: { name: string; slug: string }[]
}

export interface Category {
  id: number
  name: string
  slug: string
  description: string
  image_url: string | null
  parent_id: number | null
  position: number
  status: string
  seo_title: string | null
  seo_description: string | null
  children?: Category[]
  parent?: Category | null
  product_count?: number
}

export interface Paged<T> { items: T[]; total: number; page: number; pages: number; page_size?: number }

export interface QuoteLine {
  variant_id: number
  product_id: number
  product_name: string
  product_slug: string
  variant_name: string
  sku: string
  image_url: string | null
  unit_price: Money
  compare_at_price: Money | null
  on_sale: boolean
  quantity: number
  gift_wrap: boolean
  gift_wrap_amount: Money
  line_subtotal: Money
  discount: Money
  tax_rate: Money
  tax_amount: Money
  line_total: Money
  available: number
  fragility: string
  issue: string | null
  cart_item_id?: number
}

export interface ShippingQuote {
  free_delivery: boolean
  threshold: Money
  threshold_basis: string
  eligible_subtotal: Money
  amount_to_free_delivery: Money
  fee_payer: 'store' | 'recipient'
  fee_collection_status: string
  estimated_fee: Money | null
  fee_charged_online: Money
  arrangement_supported: boolean
  arrangement_note: string | null
  note: string
  customs_disclosure: string | null
  provider: string | null
  estimated_days: [number, number] | null
  insurance_available: boolean
  contains_fragile: boolean
}

export interface Quote {
  currency: string
  lines: QuoteLine[]
  subtotal: Money
  discount: Money
  gift_wrap: Money
  tax: Money
  prices_include_tax: boolean
  total: Money
  destination: { country: string; is_international: boolean; supported: boolean; reasons: string[] }
  shipping: ShippingQuote
  coupon: { code: string; valid: boolean; message: string | null; discount: Money } | null
  payment: { methods: string[]; cod_available: false; provider: string; mode: string; instructions: string; amount_due_online: Money }
  display: { currency: string; rate: string; total: Money; subtotal: Money; threshold: Money; note: string | null }
  blocking_issues: string[]
  can_checkout: boolean
  coupon_code?: string | null
}

export interface Address {
  id?: number
  label?: string
  full_name: string
  phone: string
  line1: string
  line2?: string | null
  city: string
  state?: string | null
  postal_code: string
  country_code: string
  is_default?: boolean
}

export interface Shipment {
  id: number
  kind: string
  courier_name: string
  tracking_number: string | null
  tracking_url: string | null
  status: string
  is_test: boolean
  insured: boolean
  shipped_at: string | null
  delivered_at: string | null
  customs_data: Record<string, unknown> | null
  events: { status: string; description: string; location: string | null; occurred_at: string }[]
}

export interface OrderItem {
  id: number
  product_id: number | null
  variant_id: number | null
  product_name: string
  variant_name: string
  sku: string
  image_url: string | null
  unit_price: Money
  compare_at_price: Money | null
  quantity: number
  discount: Money
  tax_rate: string
  tax: Money
  gift_wrap: boolean
  gift_wrap_amount: Money
  line_total: Money
  returned_quantity: number
}

export interface Order {
  order_number: string
  created_at: string
  is_international: boolean
  destination_country: string
  currency: string
  display_currency: string
  subtotal: Money
  discount: Money
  gift_wrap: Money
  tax: Money
  prices_include_tax: boolean
  total: Money
  eligible_subtotal: Money
  free_delivery_threshold: Money
  free_delivery: boolean
  estimated_shipping_fee: Money | null
  coupon_code: string | null
  payment_method: string
  payment_status: string
  shipping_fee_status: string
  fulfillment_status: string
  shipping_terms: Record<string, unknown> & { note?: string }
  customs_disclosure: string | null
  is_test: boolean
  paid_at: string | null
  dispatched_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  items: OrderItem[]
  shipping_address: Address | null
  shipments: Shipment[]
  can_cancel?: boolean
  can_pay?: boolean
  can_return?: boolean
  can_claim?: boolean
  returns?: ReturnReq[]
  claims?: Claim[]
}

export interface ReturnReq {
  id: number
  order_id: number
  order_number?: string
  status: string
  reason: string
  admin_note: string | null
  return_tracking_number: string | null
  created_at: string
  items: { order_item_id: number; quantity: number; restock: boolean }[]
}

export interface Claim {
  id: number
  order_id: number
  order_number?: string
  claim_type: string
  description: string
  status: string
  resolution_note: string | null
  evidence_count: number
  order_item_id: number | null
  created_at: string
}

export interface Ticket {
  id: number
  subject: string
  status: string
  order_number: string | null
  email: string
  name: string
  created_at: string
  updated_at: string
  messages: { id: number; body: string; is_staff: boolean; created_at: string }[]
}

export interface User {
  id: number
  email: string
  full_name: string
  phone: string | null
  email_verified: boolean
  marketing_opt_in: boolean
  created_at: string
}

export interface StaffUser {
  id: number
  email: string
  full_name: string
  is_active: boolean
  mfa_enabled: boolean
  roles: { id: number; name: string }[]
  permissions: string[]
  last_login_at: string | null
}

export interface PublicSettings {
  store: {
    brand_name: string
    tagline: string
    logo_url: string
    favicon_url: string
    business_description: string
    contact_email: string
    contact_phone: string
    business_address: string
    gstin: string
    social: Record<string, string>
    store_status: 'open' | 'closed'
    maintenance_mode: boolean
    maintenance_message: string
    announcement: { enabled: boolean; text: string; link: string }
    footer_text: string
  }
  shipping: {
    domestic_country: string
    domestic_free_threshold: Money
    international_free_threshold: Money
    threshold_basis: string
    international_enabled: boolean
    recipient_paid_note: string
    customs_disclosure: string
    insurance_available: boolean
    insurance_note: string
  }
  pricing: { base_currency: string; display_currencies: string[]; prices_include_tax: boolean; show_compare_at_price: boolean }
  payment: { methods: string[]; provider: string; mode: string; cod_available: false; instructions: string; failure_message: string }
  account: {
    registration_enabled: boolean
    require_email_verification: boolean
    password_min_length: number
    password_require_mixed: boolean
    return_window_days: number
    damage_claim_window_hours: number
    support_email: string
    support_phone: string
  }
  content: {
    seo_default_title: string
    seo_default_description: string
    newsletter_enabled: boolean
    newsletter_heading: string
    newsletter_text: string
    home_sections: string[]
    hidden_home_sections: string[]
  }
  privacy: { cookie_banner_enabled: boolean; analytics_enabled: boolean; analytics_provider: string; analytics_site_id: string }
  environment: { payments_test_mode: boolean; app_env: string; demo_accounts?: { admin: { email: string; password: string } | null; customer: { email: string; password: string } | null } | null }
}

export interface Block {
  id: number
  title: string
  subtitle: string
  body: string
  image_url: string | null
  link_url: string | null
  link_label: string | null
  data: Record<string, unknown>
}

export interface HomeData {
  sections: string[]
  blocks: Record<string, Block[]>
  featured_categories: Category[]
  new_arrivals: ProductCard[]
  bestsellers: ProductCard[]
  featured: ProductCard[]
  collections: { name: string; slug: string; kind: string; description: string; image_url: string | null }[]
  reviews: Review[]
}
