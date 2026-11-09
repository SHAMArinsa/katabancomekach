from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Select, and_, or_, select

from app.models import Category, Product, ProductVariant


def now() -> datetime:
    return datetime.now(timezone.utc)


def sale_active(p: Product, at: datetime | None = None) -> bool:
    at = at or now()
    if p.sale_price is None or p.sale_price >= p.price:
        return False
    if p.sale_starts_at and at < p.sale_starts_at:
        return False
    if p.sale_ends_at and at > p.sale_ends_at:
        return False
    return True


def unit_price(p: Product, v: ProductVariant | None) -> Decimal:
    if v is not None and v.price_override is not None:
        return Decimal(v.price_override)
    return Decimal(p.sale_price) if sale_active(p) else Decimal(p.price)


def compare_at(p: Product, v: ProductVariant | None) -> Decimal | None:
    if v is not None and v.price_override is not None:
        return Decimal(p.compare_at_price) if p.compare_at_price and p.compare_at_price > v.price_override else None
    if sale_active(p):
        return Decimal(p.compare_at_price) if p.compare_at_price and p.compare_at_price > p.sale_price else Decimal(p.price)
    if p.compare_at_price and p.compare_at_price > p.price:
        return Decimal(p.compare_at_price)
    return None


def is_discounted(p: Product, v: ProductVariant | None = None) -> bool:
    return compare_at(p, v) is not None


def default_variant(p: Product) -> ProductVariant | None:
    active = [v for v in p.variants if v.is_active]
    return next((v for v in active if v.is_default), active[0] if active else None)


def available_qty(v: ProductVariant) -> int:
    return v.inventory.available if v.inventory else 0


def product_available_qty(p: Product) -> int:
    return sum(available_qty(v) for v in p.variants if v.is_active)


def category_visible(c: Category | None) -> bool:
    while c is not None:
        if c.status != "published":
            return False
        c = c.parent
    return True


def is_publicly_visible(p: Product) -> bool:
    return p.status == "published" and p.deleted_at is None and category_visible(p.category)


def purchasable_problem(p: Product, v: ProductVariant | None, qty: int) -> str | None:
    if not is_publicly_visible(p):
        return "This product is no longer available."
    if v is None or not v.is_active or v.product_id != p.id:
        return "This option is no longer available."
    if qty < 1:
        return "Quantity must be at least 1."
    avail = available_qty(v)
    if avail <= 0:
        return "Out of stock."
    if qty > avail:
        return f"Only {avail} available."
    return None


def public_products_query() -> Select:
    """Base query for storefront listings: published, not deleted, category published (or none)."""
    return (select(Product).outerjoin(Category, Product.category_id == Category.id)
            .where(Product.status == "published", Product.deleted_at.is_(None),
                   or_(Product.category_id.is_(None), Category.status == "published")))


def on_sale_clause():
    t = now()
    return and_(Product.sale_price.is_not(None), Product.sale_price < Product.price,
                or_(Product.sale_starts_at.is_(None), Product.sale_starts_at <= t),
                or_(Product.sale_ends_at.is_(None), Product.sale_ends_at >= t))
