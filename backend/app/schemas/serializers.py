"""Explicit output shapes. Money is serialised as strings ("1234.50") to avoid float rounding."""
from dataclasses import asdict, is_dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.models import (Category, DamageClaim, Order, Payment, Product, ProductVariant, Refund, Return, Shipment,
                        SupportTicket, User)
from app.services.catalog import (available_qty, compare_at, default_variant, product_available_qty, sale_active,
                                  unit_price)


def m(v: Any) -> str | None:
    if v is None:
        return None
    return f"{Decimal(v):.2f}"


def plain(obj: Any) -> Any:
    """Recursively convert dataclasses/Decimals/datetimes to JSON-friendly values."""
    if is_dataclass(obj):
        obj = asdict(obj)
    if isinstance(obj, dict):
        return {k: plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [plain(v) for v in obj]
    if isinstance(obj, Decimal):
        return m(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


def category_out(c: Category, with_children: bool = False) -> dict:
    d = {"id": c.id, "name": c.name, "slug": c.slug, "description": c.description, "image_url": c.image_url,
         "parent_id": c.parent_id, "position": c.position, "status": c.status, "seo_title": c.seo_title,
         "seo_description": c.seo_description}
    if with_children:
        d["children"] = [category_out(ch) for ch in c.children if ch.status == "published"]
    return d


def stock_state(p: Product, low_default: int = 5) -> str:
    qty = product_available_qty(p)
    if qty <= 0:
        return "out_of_stock"
    if qty <= (p.low_stock_threshold or low_default):
        return "low_stock"
    return "in_stock"


def product_card(p: Product) -> dict:
    v = default_variant(p)
    price = unit_price(p, v)
    cmp = compare_at(p, v)
    return {
        "id": p.id, "name": p.name, "slug": p.slug, "sku": p.sku, "short_description": p.short_description,
        "price": m(price), "compare_at_price": m(cmp), "on_sale": cmp is not None,
        "image": ({"url": p.images[0].url, "alt": p.images[0].alt_text or p.name} if p.images else None),
        "hover_image": ({"url": p.images[1].url, "alt": p.images[1].alt_text or p.name} if len(p.images) > 1 else None),
        "category": {"name": p.category.name, "slug": p.category.slug} if p.category else None,
        "badge": p.badge, "is_new_arrival": p.is_new_arrival, "is_bestseller": p.is_bestseller,
        "is_featured": p.is_featured, "stock_state": stock_state(p), "default_variant_id": v.id if v else None,
        "has_variants": len([x for x in p.variants if x.is_active]) > 1,
    }


def variant_out(p: Product, v: ProductVariant, admin: bool = False) -> dict:
    d = {"id": v.id, "sku": v.sku, "name": v.name, "options": v.options, "is_default": v.is_default,
         "price": m(unit_price(p, v)), "compare_at_price": m(compare_at(p, v)),
         "available": available_qty(v) > 0, "available_quantity": min(available_qty(v), 99)}
    if admin:
        d.update({"price_override": m(v.price_override), "is_active": v.is_active, "position": v.position,
                  "on_hand": v.inventory.on_hand if v.inventory else 0,
                  "reserved": v.inventory.reserved if v.inventory else 0})
    return d


def product_detail(p: Product, admin: bool = False) -> dict:
    d = product_card(p)
    d.update({
        "description": p.description, "brand": p.brand, "glass_type": p.glass_type, "material": p.material,
        "color": p.color, "finish": p.finish, "dimensions": p.dimensions, "capacity": p.capacity,
        "weight_grams": p.weight_grams, "fragility": p.fragility, "care_instructions": p.care_instructions,
        "gift_wrap_available": p.gift_wrap_available, "gift_wrap_price": m(p.gift_wrap_price),
        "ships_internationally": p.ships_internationally,
        "images": [{"id": i.id, "url": i.url, "alt": i.alt_text or p.name, "media_type": i.media_type,
                    "position": i.position} for i in p.images],
        "variants": [variant_out(p, v, admin) for v in p.variants if admin or v.is_active],
        "attributes": [{"name": a.name, "value": a.value} for a in p.attributes],
        "collections": [{"name": c.name, "slug": c.slug} for c in p.collections if admin or c.is_visible],
        "seo_title": p.seo_title or p.name, "seo_description": p.seo_description or p.short_description,
        "available_quantity": min(product_available_qty(p), 99),
        "country_of_origin": p.country_of_origin,
    })
    if admin:
        d.update({
            "status": p.status, "category_id": p.category_id, "base_price": m(p.price),
            "raw_compare_at_price": m(p.compare_at_price), "sale_price": m(p.sale_price),
            "sale_starts_at": p.sale_starts_at.isoformat() if p.sale_starts_at else None,
            "sale_ends_at": p.sale_ends_at.isoformat() if p.sale_ends_at else None,
            "sale_active": sale_active(p), "tax_class": p.tax_class, "hs_code": p.hs_code,
            "low_stock_threshold": p.low_stock_threshold, "package_weight_grams": p.package_weight_grams,
            "package_length_cm": m(p.package_length_cm), "package_width_cm": m(p.package_width_cm),
            "package_height_cm": m(p.package_height_cm), "blocked_countries": p.blocked_countries or [],
            "search_keywords": p.search_keywords, "raw_seo_title": p.seo_title,
            "raw_seo_description": p.seo_description, "collection_ids": [c.id for c in p.collections],
            "published_at": p.published_at.isoformat() if p.published_at else None,
            "created_at": p.created_at.isoformat(), "updated_at": p.updated_at.isoformat(),
            "on_hand": sum((v.inventory.on_hand if v.inventory else 0) for v in p.variants),
            "reserved": sum((v.inventory.reserved if v.inventory else 0) for v in p.variants),
        })
    return d


def shipment_out(s: Shipment) -> dict:
    return {"id": s.id, "kind": s.kind, "courier_name": s.courier_name, "tracking_number": s.tracking_number,
            "tracking_url": s.tracking_url, "status": s.status, "is_test": s.is_test, "insured": s.insured,
            "shipped_at": s.shipped_at.isoformat() if s.shipped_at else None,
            "delivered_at": s.delivered_at.isoformat() if s.delivered_at else None,
            "customs_data": s.customs_data,
            "events": [{"status": e.status, "description": e.description, "location": e.location,
                        "occurred_at": e.occurred_at.isoformat()} for e in s.events]}


def order_out(o: Order, shipments: list[Shipment] | None = None, admin: bool = False,
              payments: list[Payment] | None = None, refunds: list[Refund] | None = None) -> dict:
    addr = o.shipping_address
    d = {
        "order_number": o.order_number, "created_at": o.created_at.isoformat(),
        "is_international": o.is_international, "destination_country": o.destination_country,
        "currency": o.base_currency, "display_currency": o.display_currency, "exchange_rate": str(o.exchange_rate),
        "subtotal": m(o.subtotal_amount), "discount": m(o.discount_amount), "gift_wrap": m(o.gift_wrap_amount),
        "tax": m(o.tax_amount), "prices_include_tax": o.prices_include_tax, "total": m(o.total_amount),
        "eligible_subtotal": m(o.eligible_subtotal), "free_delivery_threshold": m(o.free_delivery_threshold),
        "free_delivery": o.free_delivery, "estimated_shipping_fee": m(o.estimated_shipping_fee),
        "coupon_code": o.coupon_code, "payment_method": o.payment_method,
        "payment_status": o.payment_status, "shipping_fee_status": o.shipping_fee_status,
        "fulfillment_status": o.fulfillment_status, "shipping_terms": o.shipping_terms,
        "customs_disclosure": o.customs_disclosure, "is_test": o.is_test,
        "paid_at": o.paid_at.isoformat() if o.paid_at else None,
        "dispatched_at": o.dispatched_at.isoformat() if o.dispatched_at else None,
        "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
        "cancelled_at": o.cancelled_at.isoformat() if o.cancelled_at else None,
        "cancel_reason": o.cancel_reason,
        "items": [{"id": i.id, "product_id": i.product_id, "variant_id": i.variant_id, "product_name": i.product_name,
                   "variant_name": i.variant_name, "sku": i.sku, "image_url": i.image_url,
                   "unit_price": m(i.unit_price), "compare_at_price": m(i.compare_at_price), "quantity": i.quantity,
                   "discount": m(i.discount_amount), "tax_rate": str(i.tax_rate), "tax": m(i.tax_amount),
                   "gift_wrap": i.gift_wrap, "gift_wrap_amount": m(i.gift_wrap_amount),
                   "line_total": m(i.line_total), "returned_quantity": i.returned_quantity,
                   "hs_code": i.hs_code, "country_of_origin": i.country_of_origin} for i in o.items],
        "shipping_address": ({"full_name": addr.full_name, "phone": addr.phone, "line1": addr.line1,
                              "line2": addr.line2, "city": addr.city, "state": addr.state,
                              "postal_code": addr.postal_code, "country_code": addr.country_code} if addr else None),
        "shipments": [shipment_out(s) for s in (shipments or [])],
    }
    if admin:
        d.update({"id": o.id, "user_id": o.user_id, "email": o.email, "customer_note": o.customer_note,
                  "requires_attention": o.requires_attention, "attention_reason": o.attention_reason,
                  "payments": [payment_out(p) for p in (payments or [])],
                  "refunds": [refund_out(r) for r in (refunds or [])]})
    return d


def payment_out(p: Payment) -> dict:
    return {"id": p.id, "provider": p.provider, "provider_order_id": p.provider_order_id,
            "provider_payment_id": p.provider_payment_id, "method": p.method, "amount": m(p.amount),
            "currency": p.currency, "status": p.status, "is_test": p.is_test,
            "verified_at": p.verified_at.isoformat() if p.verified_at else None,
            "failure_reason": p.failure_reason, "created_at": p.created_at.isoformat()}


def refund_out(r: Refund) -> dict:
    return {"id": r.id, "amount": m(r.amount), "currency": r.currency, "reason": r.reason, "status": r.status,
            "provider_refund_id": r.provider_refund_id, "created_at": r.created_at.isoformat(),
            "processed_at": r.processed_at.isoformat() if r.processed_at else None}


def user_out(u: User, admin_view: bool = False, pii: bool = True) -> dict:
    d = {"id": u.id, "email": u.email if pii else _mask_email(u.email), "full_name": u.full_name,
         "phone": (u.phone if pii else ("•••" if u.phone else None)),
         "email_verified": u.email_verified_at is not None, "marketing_opt_in": u.marketing_opt_in,
         "created_at": u.created_at.isoformat()}
    if admin_view:
        d.update({"is_staff": u.is_staff, "is_active": u.is_active,
                  "restricted": u.restricted_at is not None, "restriction_reason": u.restriction_reason,
                  "deletion_requested_at": u.deletion_requested_at.isoformat() if u.deletion_requested_at else None,
                  "deleted": u.deleted_at is not None, "mfa_enabled": u.mfa_enabled,
                  "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                  "roles": [r.name for r in u.roles]})
    return d


def staff_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "is_active": u.is_active,
            "mfa_enabled": u.mfa_enabled, "roles": [{"id": r.id, "name": r.name} for r in u.roles],
            "permissions": sorted(u.permission_codes),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}


def _mask_email(e: str) -> str:
    name, _, dom = e.partition("@")
    return (name[:2] + "•••@" + dom) if dom else "•••"


def return_out(r: Return) -> dict:
    return {"id": r.id, "order_id": r.order_id, "status": r.status, "reason": r.reason, "admin_note": r.admin_note,
            "return_tracking_number": r.return_tracking_number, "created_at": r.created_at.isoformat(),
            "items": [{"order_item_id": i.order_item_id, "quantity": i.quantity, "restock": i.restock}
                      for i in r.items]}


def claim_out(c: DamageClaim) -> dict:
    return {"id": c.id, "order_id": c.order_id, "claim_type": c.claim_type, "description": c.description,
            "status": c.status, "resolution_note": c.resolution_note, "evidence_count": len(c.evidence_keys or []),
            "order_item_id": c.order_item_id, "created_at": c.created_at.isoformat()}


def ticket_out(t: SupportTicket, staff: bool = False) -> dict:
    return {"id": t.id, "subject": t.subject, "status": t.status, "order_number": t.order_number,
            "email": t.email, "name": t.name, "created_at": t.created_at.isoformat(),
            "updated_at": t.updated_at.isoformat(),
            "messages": [{"id": msg.id, "body": msg.body, "is_staff": msg.is_staff,
                          "created_at": msg.created_at.isoformat()} for msg in t.messages]}
