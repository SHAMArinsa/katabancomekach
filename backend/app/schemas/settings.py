"""Validated business-settings sections. Stored as JSON in `site_settings`.

Every field has a safe default, so a fresh database works immediately.
Only declarative values are accepted — never code, SQL or server config.
"""
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator

CountryCode = str


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SocialLinks(_Section):
    instagram: str = ""
    facebook: str = ""
    pinterest: str = ""
    youtube: str = ""
    x: str = ""


class Announcement(_Section):
    enabled: bool = True
    text: str = Field("Complimentary delivery on orders over ₹2,000 within India", max_length=200)
    link: str = Field("/shipping-policy", max_length=300)


class StoreSettings(_Section):
    brand_name: str = Field("Maison Verre", min_length=1, max_length=80)
    tagline: str = Field("Hand-finished glass for the considered home", max_length=160)
    logo_url: str = ""
    favicon_url: str = ""
    business_description: str = Field(
        "A curated house of glass — vases, tableware and objects chosen for clarity, weight and craft.",
        max_length=1000)
    contact_email: str = "hello@example.com"
    contact_phone: str = "+91 00000 00000"
    business_address: str = "Registered business address — update in Admin › Settings › Store"
    gstin: str = ""
    social: SocialLinks = SocialLinks()
    store_status: Literal["open", "closed"] = "open"
    maintenance_mode: bool = False
    maintenance_message: str = "We are refining a few details and will be back shortly."
    announcement: Announcement = Announcement()
    footer_text: str = "Every piece is inspected, wrapped by hand and shipped with care."


class CatalogSettings(_Section):
    default_product_status: Literal["draft", "published"] = "draft"
    default_low_stock_threshold: int = Field(5, ge=0, le=10000)
    show_out_of_stock: bool = True
    new_arrival_days: int = Field(45, ge=1, le=365)
    dimension_unit: Literal["cm", "mm", "in"] = "cm"
    weight_unit: Literal["g", "kg", "lb"] = "g"
    capacity_unit: Literal["ml", "l", "oz"] = "ml"
    badges: list[str] = ["New", "Bestseller", "Limited", "Handmade", "Sale"]
    attribute_names: list[str] = ["Glass type", "Finish", "Technique", "Dishwasher safe", "Lead-free"]


class PricingSettings(_Section):
    base_currency: Literal["INR"] = "INR"
    display_currencies: list[str] = ["INR", "USD", "EUR", "GBP", "AED"]
    prices_include_tax: bool = True
    min_order_amount: Decimal = Field(Decimal("0"), ge=0)
    max_discount_percent: Decimal = Field(Decimal("60"), ge=0, le=100)
    allow_coupon_with_sale_items: bool = False
    rounding: Literal["half_up", "half_even"] = "half_up"
    show_compare_at_price: bool = True


class ShippingSettings(_Section):
    domestic_country: CountryCode = "IN"
    domestic_free_threshold: Decimal = Field(Decimal("2000"), ge=0)
    international_free_threshold: Decimal = Field(Decimal("10000"), ge=0)
    threshold_basis: Literal["after_discount", "before_discount"] = "after_discount"
    international_enabled: bool = True
    fragile_international_allowed: bool = True
    insurance_available: bool = False
    insurance_note: str = "Transit insurance is not currently offered."
    default_package_weight_grams: int = Field(1000, ge=1)
    recipient_paid_note: str = Field(
        "Your product amount is paid online now. For orders below the free-delivery threshold, the courier's "
        "shipping charge is collected from the recipient at delivery. Product cash-on-delivery is not offered.",
        max_length=1000)
    customs_disclosure: str = Field(
        "International orders may be subject to import duties, taxes and customs fees charged by the destination "
        "country. These are not included in our prices and are payable by the recipient.", max_length=2000)

    @field_validator("domestic_country")
    @classmethod
    def upper(cls, v: str) -> str:
        if len(v) != 2:
            raise ValueError("Use a 2-letter ISO country code")
        return v.upper()


class PaymentSettings(_Section):
    provider: Literal["mock", "razorpay"] = "mock"
    mode: Literal["test", "live"] = "test"
    enabled_methods: list[Literal["card", "upi", "netbanking", "wallet"]] = ["card", "upi", "netbanking", "wallet"]
    supported_currencies: list[str] = ["INR"]
    failure_message: str = "Your payment could not be completed. No amount has been captured — please try again."
    payment_instructions: str = "Pay securely online. Cash on delivery is not available for products."
    refund_to_original_method: bool = True


class AccountSettings(_Section):
    registration_enabled: bool = True
    require_email_verification: bool = True
    phone_verification_enabled: bool = False
    password_min_length: int = Field(10, ge=8, le=128)
    password_require_mixed: bool = True
    max_failed_logins: int = Field(5, ge=3, le=20)
    lockout_minutes: int = Field(15, ge=1, le=1440)
    return_window_days: int = Field(7, ge=0, le=90)
    damage_claim_window_hours: int = Field(48, ge=1, le=720)
    support_email: str = "support@example.com"
    support_phone: str = ""


class ContentSettings(_Section):
    seo_default_title: str = "Maison Verre — Luxury Glassware & Home Décor"
    seo_default_description: str = "Hand-finished glass vases, tableware, lighting and gifts. Shipped across India and worldwide."
    newsletter_enabled: bool = True
    newsletter_heading: str = "Letters from the studio"
    newsletter_text: str = "New collections, care notes and private previews. No clutter."
    home_sections: list[str] = ["hero", "categories", "new_arrivals", "campaign", "bestsellers", "collections",
                                "story", "craft", "packaging", "reviews", "faq", "newsletter"]
    hidden_home_sections: list[str] = []


class NotificationSettings(_Section):
    sender_name: str = "Maison Verre"
    order_confirmation: bool = True
    payment_failed: bool = True
    shipping_updates: bool = True
    return_updates: bool = True
    admin_alert_email: str = ""


class PrivacySettings(_Section):
    cookie_banner_enabled: bool = True
    analytics_enabled: bool = False
    analytics_provider: Literal["none", "plausible", "umami"] = "none"
    analytics_site_id: str = ""
    terms_version: str = "1"
    privacy_version: str = "1"


SECTIONS: dict[str, type[_Section]] = {
    "store": StoreSettings,
    "catalog": CatalogSettings,
    "pricing": PricingSettings,
    "shipping": ShippingSettings,
    "payment": PaymentSettings,
    "account": AccountSettings,
    "content": ContentSettings,
    "notifications": NotificationSettings,
    "privacy": PrivacySettings,
}

# Sections whose changes need the extra `settings.payments` permission.
PAYMENT_SECTIONS = {"payment"}
