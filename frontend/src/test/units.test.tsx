import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DeliveryArrangement, Totals } from '@/components/store/OrderSummary'
import { FreeDeliveryMeter } from '@/components/store/CartDrawer'
import { Markdown } from '@/components/ui/Markdown'
import { addressSchema, registerSchema } from '@/schemas/forms'
import { formatINR, humanize } from '@/utils/format'
import { quote } from './utils'

describe('formatting', () => {
  it('formats rupees with paise only when needed', () => {
    expect(formatINR('2000.00')).toBe('₹2,000')
    expect(formatINR('732.2')).toBe('₹732.20')
    expect(formatINR(null)).toBe('—')
    expect(humanize('pending_collection')).toBe('Pending collection')
  })
})

describe('form schemas', () => {
  it('validates Indian PIN codes', () => {
    const base = { full_name: 'A', phone: '+919800000000', line1: 'x', city: 'y', country_code: 'IN' }
    expect(addressSchema.safeParse({ ...base, postal_code: '700016' }).success).toBe(true)
    expect(addressSchema.safeParse({ ...base, postal_code: '12345' }).success).toBe(false)
    expect(addressSchema.safeParse({ ...base, country_code: 'US', postal_code: '10001' }).success).toBe(true)
  })
  it('applies the configured password policy', () => {
    const s = registerSchema(10, true)
    const v = { full_name: 'A', email: 'a@b.co', accept_terms: true as const }
    expect(s.safeParse({ ...v, password: 'shortpw1' }).success).toBe(false)
    expect(s.safeParse({ ...v, password: 'longpassword' }).success).toBe(false)
    expect(s.safeParse({ ...v, password: 'longpassword1' }).success).toBe(true)
  })
})

describe('Markdown', () => {
  it('renders formatting without injecting HTML', () => {
    const { container } = render(<MemoryRouter><Markdown source={'## Title\n\n- **bold** item\n\n<img src=x onerror=alert(1)> [link](/terms) [bad](javascript:alert(1))'} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute('href', '/terms')
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull()
  })
})

describe('shipping threshold messages', () => {
  it('explains recipient-paid shipping below the threshold', () => {
    render(<><FreeDeliveryMeter quote={quote()} /><DeliveryArrangement quote={quote()} /></>)
    expect(screen.getByTestId('free-delivery-meter')).toHaveTextContent('Add ₹500 more for complimentary')
    expect(screen.getByText('Shipping paid by the recipient at delivery')).toBeInTheDocument()
    expect(screen.getByText(/Shipping charged online now/)).toHaveTextContent('₹0')
    expect(screen.getByText(/Indicative courier charge/)).toHaveTextContent('₹150')
  })
  it('shows complimentary delivery at or above the threshold', () => {
    render(<><FreeDeliveryMeter quote={quote({ free: true })} /><DeliveryArrangement quote={quote({ free: true })} /></>)
    expect(screen.getByTestId('free-delivery-meter')).toHaveTextContent('unlocked complimentary delivery')
    expect(screen.getByText('Complimentary delivery')).toBeInTheDocument()
  })
  it('never adds shipping to the online total', () => {
    render(<Totals quote={quote()} />)
    expect(screen.getByText('Shipping charged online').nextSibling).toHaveTextContent('₹0')
    expect(screen.getByText('Pay online now').nextSibling).toHaveTextContent('₹1,500')
  })
})
