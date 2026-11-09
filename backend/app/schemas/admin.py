from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import Strict

SLUG = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class CategoryIn(Strict):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(None, max_length=140, pattern=SLUG)
    parent_id: int | None = None
    description: str = Field("", max_length=5000)
    image_url: str | None = Field(None, max_length=500)
    position: int = 0
    status: Literal["published", "hidden", "archived"] = "published"
    seo_title: str | None = Field(None, max_length=160)
    seo_description: str | None = Field(None, max_length=320)


class CategoryPatch(Strict):
    name: str | None = Field(None, min_length=1, max_length=120)
    slug: str | None = Field(None, max_length=140, pattern=SLUG)
    parent_id: int | None = None
    description: str | None = Field(None, max_length=5000)
    image_url: str | None = Field(None, max_length=500)
    position: int | None = None
    status: Literal["published", "hidden", "archived"] | None = None
    seo_title: str | None = Field(None, max_length=160)
    seo_description: str | None = Field(None, max_length=320)


class ReorderIn(Strict):
    ids: list[int] = Field(min_length=1, max_length=500)


class CollectionIn(Strict):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(None, max_length=140, pattern=SLUG)
    kind: Literal["featured", "gift", "seasonal", "designer", "premium"] = "featured"
    description: str = Field("", max_length=5000)
    image_url: str | None = Field(None, max_length=500)
    is_visible: bool = True
    position: int = 0
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class ProductBase(Strict):
    name: str | None = Field(None, min_length=1, max_length=200)
    slug: str | None = Field(None, max_length=220, pattern=SLUG)
    sku: str | None = Field(None, min_length=1, max_length=64)
    short_description: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=20000)
    category_id: int | None = None
    brand: str | None = Field(None, max_length=120)
    glass_type: str | None = Field(None, max_length=120)
    material: str | None = Field(None, max_length=120)
    color: str | None = Field(None, max_length=80)
    finish: str | None = Field(None, max_length=80)
    dimensions: str | None = Field(None, max_length=120)
    capacity: str | None = Field(None, max_length=60)
    weight_grams: int | None = Field(None, ge=0)
    package_weight_grams: int | None = Field(None, ge=0)
    package_length_cm: Decimal | None = Field(None, ge=0)
    package_width_cm: Decimal | None = Field(None, ge=0)
    package_height_cm: Decimal | None = Field(None, ge=0)
    fragility: Literal["standard", "fragile", "highly_fragile"] | None = None
    care_instructions: str | None = Field(None, max_length=5000)
    price: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=2)
    compare_at_price: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=2)
    sale_price: Decimal | None = Field(None, ge=0, max_digits=12, decimal_places=2)
    sale_starts_at: datetime | None = None
    sale_ends_at: datetime | None = None
    tax_class: str | None = Field(None, max_length=40)
    hs_code: str | None = Field(None, max_length=16)
    country_of_origin: str | None = Field(None, min_length=2, max_length=2)
    low_stock_threshold: int | None = Field(None, ge=0)
    gift_wrap_available: bool | None = None
    gift_wrap_price: Decimal | None = Field(None, ge=0)
    ships_internationally: bool | None = None
    blocked_countries: list[str] | None = None
    search_keywords: str | None = Field(None, max_length=2000)
    seo_title: str | None = Field(None, max_length=160)
    seo_description: str | None = Field(None, max_length=320)
    is_featured: bool | None = None
    is_bestseller: bool | None = None
    is_new_arrival: bool | None = None
    badge: str | None = Field(None, max_length=40)
    collection_ids: list[int] | None = None
    attributes: list[dict] | None = None

    @field_validator("blocked_countries")
    @classmethod
    def countries(cls, v):
        if v is None:
            return v
        out = [c.strip().upper() for c in v if c.strip()]
        if any(len(c) != 2 for c in out):
            raise ValueError("Use 2-letter ISO country codes")
        return out


class ProductCreate(ProductBase):
    name: str = Field(min_length=1, max_length=200)
    sku: str = Field(min_length=1, max_length=64)
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    initial_stock: int = Field(0, ge=0)
    status: Literal["draft", "published"] | None = None


class ProductPatch(ProductBase):
    pass


class StatusIn(Strict):
    status: Literal["draft", "published", "archived"]


class VariantIn(Strict):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    options: dict[str, str] = {}
    price_override: Decimal | None = Field(None, ge=0)
    is_active: bool = True
    position: int = 0
    initial_stock: int = Field(0, ge=0)


class VariantPatch(Strict):
    sku: str | None = Field(None, min_length=1, max_length=64)
    name: str | None = Field(None, min_length=1, max_length=120)
    options: dict[str, str] | None = None
    price_override: Decimal | None = Field(None, ge=0)
    clear_price_override: bool = False
    is_active: bool | None = None
    position: int | None = None
    is_default: bool | None = None


class ImagePatch(Strict):
    alt_text: str | None = Field(None, max_length=255)


class ImageUrlIn(Strict):
    url: str = Field(min_length=1, max_length=500)
    alt_text: str = Field("", max_length=255)
    media_type: Literal["image", "video"] = "image"


class StockAdjustIn(Strict):
    variant_id: int
    set_to: int | None = Field(None, ge=0)
    delta: int | None = None
    reason: Literal["adjustment", "restock", "damage", "correction", "return"] = "adjustment"
    note: str | None = Field(None, max_length=500)


class FulfillmentIn(Strict):
    status: Literal["processing", "packed", "dispatched", "delivered", "cancelled", "returned", "unfulfilled"]
    note: str | None = Field(None, max_length=1000)


class ShipmentIn(Strict):
    provider_id: int
    tracking_number: str | None = Field(None, max_length=120)
    courier_name: str | None = Field(None, max_length=120)
    insured: bool = False
    packaging_notes: str | None = Field(None, max_length=1000)
    weight_grams: int | None = Field(None, ge=1)


class TrackingEventIn(Strict):
    status: Literal["in_transit", "out_for_delivery", "delivered", "exception", "returned", "lost"]
    description: str | None = Field(None, max_length=500)
    location: str | None = Field(None, max_length=160)


class ShippingFeeIn(Strict):
    status: Literal["pending_collection", "collected", "collection_failed", "waived", "disputed"]
    collected_amount: Decimal | None = Field(None, ge=0)
    note: str | None = Field(None, max_length=1000)


class CancelIn(Strict):
    reason: str = Field(min_length=3, max_length=1000)


class RefundIn(Strict):
    amount: Decimal | None = Field(None, gt=0)
    reason: str = Field(min_length=3, max_length=1000)
    idempotency_key: str | None = Field(None, max_length=80)


class ReturnDecisionIn(Strict):
    status: Literal["approved", "rejected", "received", "refunded", "closed"]
    admin_note: str | None = Field(None, max_length=2000)
    restock: bool = False
    refund_amount: Decimal | None = Field(None, gt=0)
    return_tracking_number: str | None = Field(None, max_length=120)


class ClaimDecisionIn(Strict):
    status: Literal["under_review", "approved_refund", "approved_replacement", "rejected", "resolved"]
    resolution_note: str | None = Field(None, max_length=2000)
    refund_amount: Decimal | None = Field(None, gt=0)


class TicketUpdateIn(Strict):
    status: Literal["open", "pending_customer", "resolved", "closed"] | None = None
    reply: str | None = Field(None, max_length=5000)


class RestrictIn(Strict):
    restricted: bool
    reason: str = Field(min_length=3, max_length=1000)


class CouponIn(Strict):
    code: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    description: str = Field("", max_length=255)
    discount_type: Literal["percent", "fixed"]
    value: Decimal = Field(gt=0)
    min_order_amount: Decimal = Field(Decimal("0"), ge=0)
    max_discount_amount: Decimal | None = Field(None, gt=0)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = Field(None, ge=1)
    per_customer_limit: int | None = Field(1, ge=1)
    applies_to_sale_items: bool = False
    domestic_only: bool = False
    is_active: bool = True


class ContentBlockIn(Strict):
    placement: Literal["hero", "banner", "campaign", "story", "craft", "packaging", "faq", "footer_link",
                       "promo_strip"]
    title: str = Field("", max_length=200)
    subtitle: str = Field("", max_length=500)
    body: str = Field("", max_length=10000)
    image_url: str | None = Field(None, max_length=500)
    link_url: str | None = Field(None, max_length=500)
    link_label: str | None = Field(None, max_length=80)
    position: int = 0
    is_visible: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    data: dict = {}

    @field_validator("link_url")
    @classmethod
    def safe_link(cls, v):
        if v and not (v.startswith("/") or v.startswith("https://") or v.startswith("http://")):
            raise ValueError("Links must be relative paths or http(s) URLs")
        return v


class CmsPageIn(Strict):
    slug: str = Field(min_length=1, max_length=80, pattern=SLUG)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field("", max_length=100000)
    seo_title: str | None = Field(None, max_length=160)
    seo_description: str | None = Field(None, max_length=320)
    is_published: bool = True


class EmailTemplateIn(Strict):
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20000)
    is_enabled: bool = True


class ShippingProviderIn(Strict):
    code: str = Field(min_length=2, max_length=40, pattern=r"^[a-z0-9_]+$")
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True
    supports_domestic: bool = True
    supports_international: bool = False
    supports_recipient_paid_shipping: bool = False
    supports_fragile: bool = True
    supports_insurance: bool = False
    tracking_url_template: str | None = Field(None, max_length=500)
    notes: str | None = Field(None, max_length=2000)


class RateIn(Strict):
    max_weight_grams: int = Field(gt=0)
    fee: Decimal = Field(ge=0)
    fragile_surcharge: Decimal = Field(Decimal("0"), ge=0)


class ZoneIn(Strict):
    name: str = Field(min_length=1, max_length=120)
    is_domestic: bool = False
    country_codes: list[str] = []
    provider_id: int | None = None
    is_active: bool = True
    estimated_days_min: int = Field(3, ge=0)
    estimated_days_max: int = Field(7, ge=0)
    rates: list[RateIn] = []

    @field_validator("country_codes")
    @classmethod
    def countries(cls, v):
        out = [c.strip().upper() for c in v if c.strip()]
        if any(len(c) != 2 and c != "*" for c in out):
            raise ValueError("Use 2-letter ISO country codes (or * for rest of world)")
        return out


class DestinationIn(Strict):
    country_code: str = Field(min_length=2, max_length=2)
    country_name: str = Field(min_length=1, max_length=120)
    is_enabled: bool = True
    allows_fragile: bool = True
    currency_code: str = Field("INR", min_length=3, max_length=3)
    postal_code_regex: str | None = Field(None, max_length=120)
    customs_note: str | None = Field(None, max_length=2000)
    restriction_reason: str | None = Field(None, max_length=500)

    @field_validator("postal_code_regex")
    @classmethod
    def valid_regex(cls, v):
        if v:
            import re
            try:
                re.compile(v)
            except re.error:
                raise ValueError("Invalid postal-code pattern")
        return v


class CurrencyIn(Strict):
    code: str = Field(min_length=3, max_length=3)
    name: str = Field(min_length=1, max_length=60)
    symbol: str = Field(min_length=1, max_length=8)
    decimals: int = Field(2, ge=0, le=3)
    is_enabled: bool = True


class ExchangeRateIn(Strict):
    quote_currency: str = Field(min_length=3, max_length=3)
    rate: Decimal = Field(gt=0)
    source: str = Field("manual", max_length=60)


class TaxRuleIn(Strict):
    tax_class: str = Field(min_length=1, max_length=40)
    country_code: str = Field(min_length=1, max_length=2)
    rate_percent: Decimal = Field(ge=0, le=100)
    label: str = Field("GST", max_length=60)
    is_active: bool = True


class StaffIn(Strict):
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=12, max_length=128)
    role_ids: list[int] = []


class StaffPatch(Strict):
    full_name: str | None = Field(None, max_length=160)
    is_active: bool | None = None
    role_ids: list[int] | None = None


class RoleIn(Strict):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field("", max_length=255)
    permissions: list[str] = []


class MfaEnableIn(Strict):
    code: str = Field(min_length=6, max_length=8)
