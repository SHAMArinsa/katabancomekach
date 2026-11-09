import { lazy } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AdminAuthProvider } from '@/features/admin/AdminAuth'
import { CustomerAuthProvider } from '@/features/auth/CustomerAuth'
import { CartProvider } from '@/features/cart/CartContext'
import { AdminLayout } from '@/layouts/AdminLayout'
import { AccountLayout, RequireCustomer, StoreLayout } from '@/layouts/StoreLayout'

const Home = lazy(() => import('@/pages/store/Home'))
const Listing = lazy(() => import('@/pages/store/Listing'))
const ProductPage = lazy(() => import('@/pages/store/ProductPage'))
const Collections = lazy(() => import('@/pages/store/Collections'))
const CmsPage = lazy(() => import('@/pages/store/CmsPage'))
const Contact = lazy(() => import('@/pages/store/Contact'))
const Faq = lazy(() => import('@/pages/store/Faq'))
const TrackOrder = lazy(() => import('@/pages/store/TrackOrder'))
const CookiePreferences = lazy(() => import('@/pages/store/CookiePreferences'))
const CartPage = lazy(() => import('@/pages/store/CartPage'))
const Checkout = lazy(() => import('@/pages/store/Checkout'))
const PaymentPage = lazy(() => import('@/pages/store/PaymentPage'))
const OrderConfirmation = lazy(() => import('@/pages/store/OrderConfirmation'))
const NotFound = lazy(() => import('@/pages/store/NotFound'))
const AuthPages = {
  Login: lazy(() => import('@/pages/store/auth/Login')),
  Register: lazy(() => import('@/pages/store/auth/Register')),
  VerifyEmail: lazy(() => import('@/pages/store/auth/VerifyEmail')),
  Forgot: lazy(() => import('@/pages/store/auth/ForgotPassword')),
  Reset: lazy(() => import('@/pages/store/auth/ResetPassword')),
}
const Account = {
  Overview: lazy(() => import('@/pages/account/Overview')),
  Orders: lazy(() => import('@/pages/account/Orders')),
  OrderDetail: lazy(() => import('@/pages/account/OrderDetail')),
  Returns: lazy(() => import('@/pages/account/Returns')),
  Wishlist: lazy(() => import('@/pages/account/Wishlist')),
  Addresses: lazy(() => import('@/pages/account/Addresses')),
  Profile: lazy(() => import('@/pages/account/Profile')),
  Support: lazy(() => import('@/pages/account/Support')),
}
const Admin = {
  Login: lazy(() => import('@/pages/admin/Login')),
  Dashboard: lazy(() => import('@/pages/admin/Dashboard')),
  Orders: lazy(() => import('@/pages/admin/Orders')),
  OrderDetail: lazy(() => import('@/pages/admin/OrderDetail')),
  Products: lazy(() => import('@/pages/admin/Products')),
  ProductEdit: lazy(() => import('@/pages/admin/ProductEdit')),
  Categories: lazy(() => import('@/pages/admin/Categories')),
  Inventory: lazy(() => import('@/pages/admin/Inventory')),
  Payments: lazy(() => import('@/pages/admin/Payments')),
  Customers: lazy(() => import('@/pages/admin/Customers')),
  CustomerDetail: lazy(() => import('@/pages/admin/CustomerDetail')),
  Support: lazy(() => import('@/pages/admin/Support')),
  Reviews: lazy(() => import('@/pages/admin/Reviews')),
  Coupons: lazy(() => import('@/pages/admin/Coupons')),
  Content: lazy(() => import('@/pages/admin/Content')),
  Shipping: lazy(() => import('@/pages/admin/Shipping')),
  Settings: lazy(() => import('@/pages/admin/Settings')),
  Staff: lazy(() => import('@/pages/admin/Staff')),
  Audit: lazy(() => import('@/pages/admin/Audit')),
  Account: lazy(() => import('@/pages/admin/Account')),
  Reset: lazy(() => import('@/pages/store/auth/ResetPassword')),
}

function AdminRoot() {
  return <AdminAuthProvider><Outlet /></AdminAuthProvider>
}

function StoreRoot() {
  return <CustomerAuthProvider><CartProvider><StoreLayout /></CartProvider></CustomerAuthProvider>
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminRoot />}>
      <Route path="login" element={<Admin.Login />} />
      <Route path="reset-password" element={<Admin.Reset admin />} />
      <Route element={<AdminLayout />}>
        <Route index element={<Admin.Dashboard />} />
        <Route path="orders" element={<Admin.Orders />} />
        <Route path="orders/:orderNumber" element={<Admin.OrderDetail />} />
        <Route path="products" element={<Admin.Products />} />
        <Route path="products/new" element={<Admin.ProductEdit />} />
        <Route path="products/:id" element={<Admin.ProductEdit />} />
        <Route path="categories" element={<Admin.Categories />} />
        <Route path="inventory" element={<Admin.Inventory />} />
        <Route path="payments" element={<Admin.Payments />} />
        <Route path="customers" element={<Admin.Customers />} />
        <Route path="customers/:id" element={<Admin.CustomerDetail />} />
        <Route path="support" element={<Admin.Support />} />
        <Route path="reviews" element={<Admin.Reviews />} />
        <Route path="coupons" element={<Admin.Coupons />} />
        <Route path="content" element={<Admin.Content />} />
        <Route path="shipping" element={<Admin.Shipping />} />
        <Route path="settings" element={<Admin.Settings />} />
        <Route path="staff" element={<Admin.Staff />} />
        <Route path="audit" element={<Admin.Audit />} />
        <Route path="account" element={<Admin.Account />} />
      </Route>
      </Route>

      <Route element={<StoreRoot />}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Listing mode="all" />} />
        <Route path="products" element={<Navigate to="/shop" replace />} />
        <Route path="products/:slug" element={<ProductPage />} />
        <Route path="categories" element={<Navigate to="/shop" replace />} />
        <Route path="categories/:slug" element={<Listing mode="category" />} />
        <Route path="search" element={<Listing mode="search" />} />
        <Route path="new-arrivals" element={<Listing mode="new" />} />
        <Route path="bestsellers" element={<Listing mode="bestsellers" />} />
        <Route path="featured" element={<Listing mode="featured" />} />
        <Route path="sale" element={<Listing mode="sale" />} />
        <Route path="gifts" element={<Listing mode="gifts" />} />
        <Route path="collections" element={<Collections />} />
        <Route path="collections/:slug" element={<Listing mode="collection" />} />
        <Route path="about" element={<CmsPage slug="about" />} />
        <Route path="shipping-policy" element={<CmsPage slug="shipping-policy" />} />
        <Route path="returns-policy" element={<CmsPage slug="returns-policy" />} />
        <Route path="privacy-policy" element={<CmsPage slug="privacy-policy" />} />
        <Route path="terms" element={<CmsPage slug="terms" />} />
        <Route path="cookie-policy" element={<CmsPage slug="cookie-policy" />} />
        <Route path="contact" element={<Contact />} />
        <Route path="faq" element={<Faq />} />
        <Route path="track" element={<TrackOrder />} />
        <Route path="cookie-preferences" element={<CookiePreferences />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="login" element={<AuthPages.Login />} />
        <Route path="register" element={<AuthPages.Register />} />
        <Route path="verify-email" element={<AuthPages.VerifyEmail />} />
        <Route path="forgot-password" element={<AuthPages.Forgot />} />
        <Route path="reset-password" element={<AuthPages.Reset />} />
        <Route element={<RequireCustomer />}>
          <Route path="checkout" element={<Checkout />} />
          <Route path="checkout/pay/:orderNumber" element={<PaymentPage />} />
          <Route path="checkout/confirmation/:orderNumber" element={<OrderConfirmation />} />
          <Route path="account" element={<AccountLayout />}>
            <Route index element={<Account.Overview />} />
            <Route path="orders" element={<Account.Orders />} />
            <Route path="orders/:orderNumber" element={<Account.OrderDetail />} />
            <Route path="returns" element={<Account.Returns />} />
            <Route path="wishlist" element={<Account.Wishlist />} />
            <Route path="addresses" element={<Account.Addresses />} />
            <Route path="profile" element={<Account.Profile />} />
            <Route path="support" element={<Account.Support />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
