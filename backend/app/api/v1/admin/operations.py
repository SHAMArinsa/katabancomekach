import csv
import io
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import request_ip, require
from app.core.errors import NotFound
from app.db.session import get_db
from app.models import (Inventory, InventoryMovement, InventoryReservation, Order, OrderStatusHistory, Payment,
                        PaymentEvent, Product, ProductVariant, Refund, Shipment, ShippingFeeCollection, User)
from app.schemas.admin import (CancelIn, FulfillmentIn, RefundIn, ShipmentIn, ShippingFeeIn, StockAdjustIn,
                               TrackingEventIn)
from app.schemas.serializers import m, order_out, payment_out, refund_out
from app.services import inventory as inv_svc
from app.services import orders as order_svc
from app.services import payments as pay_svc
from app.services.audit import audit
from app.services.catalog import product_available_qty

router = APIRouter(tags=["admin-operations"])


def _now():
    return datetime.now(timezone.utc)


# ======================================================================= dashboard

@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), _: User = Depends(require("dashboard.read")),
              days: int = Query(30, ge=1, le=365)):
    since = _now() - timedelta(days=days)
    live = Product.deleted_at.is_(None)
    products = db.scalars(select(Product).where(live)).unique().all()
    avail = {p.id: product_available_qty(p) for p in products}
    paid_states = ("paid", "partially_refunded", "refunded")
    o = Order
    count = lambda *w: db.scalar(select(func.count()).select_from(o).where(*w)) or 0  # noqa: E731
    gross = db.scalar(select(func.coalesce(func.sum(o.total_amount), 0)).where(
        o.payment_status.in_(paid_states), o.created_at >= since, o.is_test.is_(False))) or 0
    gross_test = db.scalar(select(func.coalesce(func.sum(o.total_amount), 0)).where(
        o.payment_status.in_(paid_states), o.created_at >= since, o.is_test.is_(True))) or 0
    refunds = db.scalar(select(func.coalesce(func.sum(Refund.amount), 0)).join(o, o.id == Refund.order_id).where(
        Refund.status != "failed", Refund.created_at >= since, o.is_test.is_(False))) or 0
    tax = db.scalar(select(func.coalesce(func.sum(o.tax_amount), 0)).where(
        o.payment_status.in_(paid_states), o.created_at >= since, o.is_test.is_(False))) or 0
    dom = db.scalar(select(func.coalesce(func.sum(o.total_amount), 0)).where(
        o.payment_status.in_(paid_states), o.created_at >= since, o.is_international.is_(False), o.is_test.is_(False))) or 0
    intl = db.scalar(select(func.coalesce(func.sum(o.total_amount), 0)).where(
        o.payment_status.in_(paid_states), o.created_at >= since, o.is_international.is_(True), o.is_test.is_(False))) or 0
    fee_rows = db.execute(select(o.shipping_fee_status, func.count()).group_by(o.shipping_fee_status)).all()
    recent = db.scalars(select(o).order_by(o.created_at.desc()).limit(10)).all()
    daily = db.execute(select(func.date_trunc("day", o.created_at).label("d"), func.sum(o.total_amount), func.count())
                       .where(o.payment_status.in_(paid_states), o.created_at >= since)
                       .group_by("d").order_by("d")).all()
    from app.models import ShippingProvider
    from app.services import site_settings
    store = site_settings.store(db)
    pay = site_settings.payment(db)
    low_items = sorted([p for p in products if p.status == "published" and avail[p.id] <= p.low_stock_threshold],
                       key=lambda p: avail[p.id])[:8]
    has_courier = db.scalar(select(func.count()).select_from(ShippingProvider).where(
        ShippingProvider.is_active.is_(True), ShippingProvider.code != "mock")) or 0
    checklist = [
        {"key": "brand", "label": "Set your brand name, logo and contact details", "done": store.brand_name != "Maison Verre" or bool(store.logo_url), "link": "/admin/settings?section=store"},
        {"key": "products", "label": "Add your own products with photos", "done": any(not (p.description or "").count("Sample product") for p in products), "link": "/admin/products/new"},
        {"key": "policies", "label": "Review shipping, returns and privacy policies", "done": False, "link": "/admin/content"},
        {"key": "courier", "label": "Add your real courier", "done": bool(has_courier > 1), "link": "/admin/shipping"},
        {"key": "payments", "label": "Connect Razorpay (test mode first)", "done": pay.provider == "razorpay", "link": "/admin/settings?section=payment"},
    ]
    return {
        "period_days": days,
        "checklist": checklist,
        "low_stock_items": [{"id": p.id, "name": p.name, "available": avail[p.id], "threshold": p.low_stock_threshold} for p in low_items],
        "products": {"total": len(products), "published": sum(p.status == "published" for p in products),
                     "draft": sum(p.status == "draft" for p in products),
                     "archived": sum(p.status == "archived" for p in products),
                     "out_of_stock": sum(1 for p in products if avail[p.id] <= 0),
                     "low_stock": sum(1 for p in products if 0 < avail[p.id] <= p.low_stock_threshold)},
        "orders": {"total": count(), "pending_payment": count(o.payment_status.in_(("pending", "authorized")),
                                                               o.fulfillment_status != "cancelled"),
                   "paid": count(o.payment_status == "paid"),
                   "to_fulfil": count(o.payment_status == "paid", o.fulfillment_status.in_(("processing", "packed"))),
                   "shipped": count(o.fulfillment_status == "dispatched"),
                   "delivered": count(o.fulfillment_status == "delivered"),
                   "cancelled": count(o.fulfillment_status == "cancelled"),
                   "needs_attention": count(o.requires_attention.is_(True))},
        "sales": {"gross": m(gross), "refunds": m(refunds), "net": m(Decimal(gross) - Decimal(refunds)),
                  "tax_collected": m(tax), "domestic": m(dom), "international": m(intl),
                  "test_mode_gross": m(gross_test)},
        "shipping_fee_collection": {s: c for s, c in fee_rows},
        "daily": [{"date": d.date().isoformat(), "sales": m(s), "orders": c} for d, s, c in daily],
        "recent_orders": [{"order_number": r.order_number, "email": r.email, "total": m(r.total_amount),
                           "payment_status": r.payment_status, "fulfillment_status": r.fulfillment_status,
                           "shipping_fee_status": r.shipping_fee_status, "is_test": r.is_test,
                           "destination_country": r.destination_country,
                           "created_at": r.created_at.isoformat()} for r in recent],
    }


# ======================================================================= orders

def _order_filters(stmt, q, payment_status, fulfillment_status, shipping_fee_status, country, date_from, date_to,
                   international, attention):
    if q:
        pat = f"%{q.strip()}%"
        stmt = stmt.where(or_(Order.order_number.ilike(pat), Order.email.ilike(pat)))
    if payment_status:
        stmt = stmt.where(Order.payment_status == payment_status)
    if fulfillment_status:
        stmt = stmt.where(Order.fulfillment_status == fulfillment_status)
    if shipping_fee_status:
        stmt = stmt.where(Order.shipping_fee_status == shipping_fee_status)
    if country:
        stmt = stmt.where(Order.destination_country == country.upper())
    if date_from:
        stmt = stmt.where(Order.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(Order.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    if international is not None:
        stmt = stmt.where(Order.is_international.is_(international))
    if attention:
        stmt = stmt.where(Order.requires_attention.is_(True))
    return stmt


@router.get("/orders")
def list_orders(db: Session = Depends(get_db), _: User = Depends(require("orders.read")),
                q: str | None = Query(None, max_length=100), payment_status: str | None = None,
                fulfillment_status: str | None = None, shipping_fee_status: str | None = None,
                country: str | None = Query(None, max_length=2), date_from: date | None = None,
                date_to: date | None = None, international: bool | None = None, attention: bool = False,
                page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)):
    stmt = _order_filters(select(Order), q, payment_status, fulfillment_status, shipping_fee_status, country,
                          date_from, date_to, international, attention)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Order.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [{"order_number": o.order_number, "email": o.email, "created_at": o.created_at.isoformat(),
                       "total": m(o.total_amount), "items": sum(i.quantity for i in o.items),
                       "destination_country": o.destination_country, "is_international": o.is_international,
                       "payment_status": o.payment_status, "fulfillment_status": o.fulfillment_status,
                       "shipping_fee_status": o.shipping_fee_status, "free_delivery": o.free_delivery,
                       "requires_attention": o.requires_attention, "is_test": o.is_test} for o in rows],
            "total": total, "page": page, "pages": (total + page_size - 1) // page_size}


def _order(db: Session, order_number: str, lock: bool = False) -> Order:
    stmt = select(Order).where(Order.order_number == order_number)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    o = db.scalar(stmt)
    if not o:
        raise NotFound("Order not found")
    return o


def _full(db: Session, o: Order) -> dict:
    ships = db.scalars(select(Shipment).where(Shipment.order_id == o.id).order_by(Shipment.id)).all()
    pays = db.scalars(select(Payment).where(Payment.order_id == o.id).order_by(Payment.id)).all()
    refs = db.scalars(select(Refund).where(Refund.order_id == o.id).order_by(Refund.id)).all()
    out = order_out(o, ships, admin=True, payments=pays, refunds=refs)
    fc = db.scalar(select(ShippingFeeCollection).where(ShippingFeeCollection.order_id == o.id))
    out["shipping_fee_collection"] = ({"status": fc.status, "estimated_amount": m(fc.estimated_amount),
                                       "collected_amount": m(fc.collected_amount), "notes": fc.notes,
                                       "courier_reference": fc.courier_reference} if fc else None)
    out["history"] = [{"field": h.field, "from": h.from_status, "to": h.to_status, "note": h.note,
                       "at": h.created_at.isoformat()} for h in db.scalars(
        select(OrderStatusHistory).where(OrderStatusHistory.order_id == o.id).order_by(OrderStatusHistory.id)).all()]
    out["courier_options"] = order_svc.courier_warnings(db, o)
    out["refunded_total"] = m(pay_svc.refunded_total(db, o.id))
    out["customer"] = {"id": o.user_id, "email": o.email}
    return out


@router.get("/orders/{order_number}")
def get_order(order_number: str, db: Session = Depends(get_db), _: User = Depends(require("orders.read"))):
    return _full(db, _order(db, order_number))


@router.post("/orders/{order_number}/fulfillment")
def set_fulfillment(order_number: str, body: FulfillmentIn, db: Session = Depends(get_db),
                    admin: User = Depends(require("orders.write"))):
    o = _order(db, order_number, lock=True)
    if body.status == "cancelled" and "orders.cancel" not in admin.permission_codes:
        from app.core.errors import Forbidden
        raise Forbidden("You do not have permission to cancel orders")
    order_svc.update_fulfillment(db, o, body.status, admin, body.note)
    db.commit()
    return _full(db, o)


@router.post("/orders/{order_number}/shipments", status_code=201)
def add_shipment(order_number: str, body: ShipmentIn, db: Session = Depends(get_db),
                 admin: User = Depends(require("orders.write"))):
    o = _order(db, order_number, lock=True)
    order_svc.create_shipment(db, o, admin, provider_id=body.provider_id, tracking_number=body.tracking_number,
                              courier_name=body.courier_name, insured=body.insured,
                              packaging_notes=body.packaging_notes, weight_grams=body.weight_grams)
    db.commit()
    return _full(db, o)


@router.post("/orders/{order_number}/shipments/{shipment_id}/events", status_code=201)
def add_tracking(order_number: str, shipment_id: int, body: TrackingEventIn, db: Session = Depends(get_db),
                 admin: User = Depends(require("orders.write"))):
    o = _order(db, order_number, lock=True)
    s = db.scalar(select(Shipment).where(Shipment.id == shipment_id, Shipment.order_id == o.id))
    if not s:
        raise NotFound("Shipment not found")
    order_svc.add_tracking_event(db, s, body.status, body.description, body.location)
    if body.status == "delivered" and o.fulfillment_status == "dispatched":
        order_svc.update_fulfillment(db, o, "delivered", admin, "Courier reported delivery")
    if body.status in ("exception", "lost"):
        o.requires_attention = True
        o.attention_reason = f"Delivery {body.status}: {body.description or ''}".strip()
    audit(db, admin, "shipment.event", "order", o.order_number, after=body.model_dump())
    db.commit()
    return _full(db, o)


@router.post("/orders/{order_number}/shipping-fee")
def set_shipping_fee(order_number: str, body: ShippingFeeIn, db: Session = Depends(get_db),
                     admin: User = Depends(require("orders.write"))):
    o = _order(db, order_number, lock=True)
    order_svc.update_shipping_fee(db, o, body.status, admin, collected_amount=body.collected_amount, note=body.note)
    db.commit()
    return _full(db, o)


@router.post("/orders/{order_number}/cancel")
def cancel(order_number: str, body: CancelIn, db: Session = Depends(get_db),
           admin: User = Depends(require("orders.cancel"))):
    o = _order(db, order_number, lock=True)
    order_svc.cancel_order(db, o, reason=body.reason, actor=admin)
    db.commit()
    return _full(db, o)


@router.post("/orders/{order_number}/refunds", status_code=201)
def refund(order_number: str, body: RefundIn, db: Session = Depends(get_db),
           admin: User = Depends(require("payments.refund"))):
    o = _order(db, order_number, lock=True)
    key = body.idempotency_key or f"manual-{o.order_number}-{int(_now().timestamp())}"
    pay_svc.refund_order(db, o, amount=body.amount, reason=body.reason, actor=admin, idempotency_key=key)
    db.commit()
    return _full(db, o)


@router.post("/orders/{order_number}/resolve-attention")
def resolve_attention(order_number: str, body: CancelIn, db: Session = Depends(get_db),
                      admin: User = Depends(require("orders.write"))):
    o = _order(db, order_number, lock=True)
    audit(db, admin, "order.attention_resolved", "order", o.order_number,
          before={"reason": o.attention_reason}, reason=body.reason)
    o.requires_attention = False
    o.attention_reason = None
    db.commit()
    return _full(db, o)


@router.get("/orders-export")
def export_orders(db: Session = Depends(get_db), admin: User = Depends(require("orders.export")),
                  q: str | None = None, payment_status: str | None = None, fulfillment_status: str | None = None,
                  shipping_fee_status: str | None = None, country: str | None = None,
                  date_from: date | None = None, date_to: date | None = None):
    stmt = _order_filters(select(Order), q, payment_status, fulfillment_status, shipping_fee_status, country,
                          date_from, date_to, None, False)
    rows = db.scalars(stmt.order_by(Order.created_at.desc()).limit(20000)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["order_number", "created_at", "email", "destination", "international", "subtotal", "discount",
                "tax", "total", "currency", "payment_status", "shipping_fee_status", "fulfillment_status",
                "free_delivery", "estimated_shipping_fee", "coupon", "test"])
    for o in rows:
        w.writerow([o.order_number, o.created_at.isoformat(), o.email, o.destination_country, o.is_international,
                    o.subtotal_amount, o.discount_amount, o.tax_amount, o.total_amount, o.base_currency,
                    o.payment_status, o.shipping_fee_status, o.fulfillment_status, o.free_delivery,
                    o.estimated_shipping_fee or "", o.coupon_code or "", o.is_test])
    audit(db, admin, "order.export", "order", None, after={"rows": len(rows)})
    db.commit()
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=orders.csv"})


# ======================================================================= payments (read-only)

@router.get("/payments")
def list_payments(db: Session = Depends(get_db), _: User = Depends(require("payments.read")),
                  status: str | None = None, page: int = Query(1, ge=1)):
    stmt = select(Payment, Order.order_number).join(Order, Order.id == Payment.order_id)
    if status:
        stmt = stmt.where(Payment.status == status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Payment.id.desc()).offset((page - 1) * 50).limit(50)).all()
    return {"items": [payment_out(p) | {"order_number": num} for p, num in rows], "total": total, "page": page,
            "pages": (total + 49) // 50}


@router.get("/payments/{payment_id}/events")
def payment_events(payment_id: int, db: Session = Depends(get_db), _: User = Depends(require("payments.read"))):
    rows = db.scalars(select(PaymentEvent).where(PaymentEvent.payment_id == payment_id).order_by(PaymentEvent.id)).all()
    return [{"event_id": e.event_id, "event_type": e.event_type, "outcome": e.outcome,
             "signature_valid": e.signature_valid, "created_at": e.created_at.isoformat()} for e in rows]


@router.get("/refunds")
def list_refunds(db: Session = Depends(get_db), _: User = Depends(require("payments.read"))):
    rows = db.execute(select(Refund, Order.order_number).join(Order, Order.id == Refund.order_id)
                      .order_by(Refund.id.desc()).limit(200)).all()
    return [refund_out(r) | {"order_number": n} for r, n in rows]


# ======================================================================= inventory

@router.get("/inventory")
def list_inventory(db: Session = Depends(get_db), _: User = Depends(require("inventory.read")),
                   q: str | None = Query(None, max_length=100), state: str | None = Query(None, pattern="^(low|out)$")):
    stmt = (select(ProductVariant, Product, Inventory).join(Product, Product.id == ProductVariant.product_id)
            .outerjoin(Inventory, Inventory.variant_id == ProductVariant.id)
            .where(Product.deleted_at.is_(None)))
    if q:
        pat = f"%{q}%"
        stmt = stmt.where(or_(Product.name.ilike(pat), ProductVariant.sku.ilike(pat)))
    out = []
    for v, p, inv in db.execute(stmt.order_by(Product.name, ProductVariant.position)).all():
        on_hand, reserved = (inv.on_hand, inv.reserved) if inv else (0, 0)
        avail = on_hand - reserved
        st = "out" if avail <= 0 else ("low" if avail <= p.low_stock_threshold else "ok")
        if state and st != state:
            continue
        out.append({"variant_id": v.id, "product_id": p.id, "product_name": p.name, "variant_name": v.name,
                    "sku": v.sku, "on_hand": on_hand, "reserved": reserved, "available": avail,
                    "low_stock_threshold": p.low_stock_threshold, "state": st, "product_status": p.status,
                    "variant_active": v.is_active})
    return out


@router.post("/inventory/adjust")
def adjust_stock(body: StockAdjustIn, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(require("inventory.write"))):
    if (body.set_to is None) == (body.delta is None):
        from app.core.errors import BusinessRuleError
        raise BusinessRuleError("Provide either set_to or delta.")
    if not db.get(ProductVariant, body.variant_id):
        raise NotFound("Variant not found")
    inv = inv_svc.adjust(db, body.variant_id, set_to=body.set_to, delta=body.delta, reason=body.reason,
                         note=body.note, actor=admin)
    audit(db, admin, "inventory.adjust", "variant", body.variant_id, after=body.model_dump(), ip=request_ip(request))
    db.commit()
    return {"variant_id": body.variant_id, "on_hand": inv.on_hand, "reserved": inv.reserved,
            "available": inv.on_hand - inv.reserved}


@router.get("/inventory/movements")
def movements(db: Session = Depends(get_db), _: User = Depends(require("inventory.read")),
              variant_id: int | None = None, limit: int = Query(100, le=500)):
    stmt = (select(InventoryMovement, ProductVariant.sku, Order.order_number)
            .join(ProductVariant, ProductVariant.id == InventoryMovement.variant_id)
            .outerjoin(Order, Order.id == InventoryMovement.order_id))
    if variant_id:
        stmt = stmt.where(InventoryMovement.variant_id == variant_id)
    rows = db.execute(stmt.order_by(InventoryMovement.id.desc()).limit(limit)).all()
    return [{"id": mv.id, "variant_id": mv.variant_id, "sku": sku, "change": mv.change, "reason": mv.reason,
             "note": mv.note, "order_number": num, "on_hand_after": mv.on_hand_after,
             "created_at": mv.created_at.isoformat()} for mv, sku, num in rows]


@router.get("/inventory/reservations")
def reservations(db: Session = Depends(get_db), _: User = Depends(require("inventory.read"))):
    rows = db.execute(select(InventoryReservation, ProductVariant.sku, Order.order_number)
                      .join(ProductVariant, ProductVariant.id == InventoryReservation.variant_id)
                      .join(Order, Order.id == InventoryReservation.order_id)
                      .where(InventoryReservation.status == "active")
                      .order_by(InventoryReservation.expires_at)).all()
    return [{"id": r.id, "sku": sku, "order_number": num, "quantity": r.quantity,
             "expires_at": r.expires_at.isoformat(), "expired": r.expires_at < _now()} for r, sku, num in rows]


@router.post("/inventory/reservations/sweep")
def sweep(db: Session = Depends(get_db), admin: User = Depends(require("inventory.write"))):
    n = inv_svc.sweep_expired(db)
    audit(db, admin, "inventory.sweep", "inventory_reservations", None, after={"expired_orders": n})
    db.commit()
    return {"expired_orders": n}
