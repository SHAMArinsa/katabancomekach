"""Order lifecycle with three independent status machines."""
import secrets
import string
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, Conflict
from app.integrations.shipping import MockShippingAdapter, get_shipping_adapter
from app.models import (CouponRedemption, Coupon, Order, OrderAddress, OrderItem, OrderStatusHistory, Shipment,
                        ShipmentTrackingEvent, ShippingFeeCollection, ShippingProvider, User)
from app.models.enums import FULFILLMENT_TRANSITIONS, PAYMENT_TRANSITIONS, SHIPPING_FEE_TRANSITIONS
from app.services import inventory, site_settings
from app.services.audit import audit
from app.services.notifications import frontend_link, notify
from app.services.pricing import Quote

ALPHABET = string.ascii_uppercase + string.digits


def _now() -> datetime:
    return datetime.now(timezone.utc)


def new_order_number() -> str:
    return "GL" + _now().strftime("%y%m%d") + "".join(secrets.choice(ALPHABET) for _ in range(5))


def _history(db: Session, order: Order, field: str, old: str | None, new: str, note: str | None = None,
             actor: User | None = None) -> None:
    db.add(OrderStatusHistory(order_id=order.id, field=field, from_status=old, to_status=new, note=note,
                              actor_user_id=actor.id if actor else None))


def set_status(db: Session, order: Order, field: str, new: str, *, note: str | None = None,
               actor: User | None = None) -> None:
    transitions = {"payment_status": PAYMENT_TRANSITIONS, "shipping_fee_status": SHIPPING_FEE_TRANSITIONS,
                   "fulfillment_status": FULFILLMENT_TRANSITIONS}[field]
    old = getattr(order, field)
    if old == new:
        return
    if new not in transitions.get(old, set()):
        raise BusinessRuleError(f"Cannot change {field.replace('_', ' ')} from '{old}' to '{new}'.",
                                code="invalid_transition")
    setattr(order, field, new)
    _history(db, order, field, old, new, note, actor)


# --------------------------------------------------------------------------- creation

def create_order(db: Session, user: User, quote: Quote, address: dict, *, note: str | None = None,
                 coupon_code: str | None = None, is_test: bool = False) -> Order:
    if not quote.can_checkout:
        raise BusinessRuleError("This order cannot be placed.", details=quote.blocking_issues)
    ship = quote.shipping
    order = Order(
        order_number=new_order_number(), user_id=user.id, email=user.email,
        is_international=quote.destination["is_international"], destination_country=quote.destination["country"],
        base_currency="INR", display_currency=quote.display["currency"], exchange_rate=quote.display["rate"],
        subtotal_amount=quote.subtotal, discount_amount=quote.discount, gift_wrap_amount=quote.gift_wrap,
        tax_amount=quote.tax, prices_include_tax=quote.prices_include_tax, total_amount=quote.total,
        eligible_subtotal=ship["eligible_subtotal"], free_delivery_threshold=ship["threshold"],
        free_delivery=ship["free_delivery"], estimated_shipping_fee=ship["estimated_fee"],
        coupon_code=(quote.coupon or {}).get("code") if quote.coupon and quote.coupon.get("valid") else None,
        payment_method="online", payment_status="pending", fulfillment_status="unfulfilled",
        shipping_fee_status=ship["fee_collection_status"],
        shipping_terms={k: (str(v) if isinstance(v, Decimal) else v) for k, v in ship.items()
                        if k not in ("customs_disclosure",)},
        customs_disclosure=ship.get("customs_disclosure"), customer_note=note, is_test=is_test,
    )
    for ln in quote.lines:
        order.items.append(OrderItem(
            product_id=ln.product_id, variant_id=ln.variant_id, product_name=ln.product_name,
            variant_name=ln.variant_name, sku=ln.sku, image_url=ln.image_url, unit_price=ln.unit_price,
            compare_at_price=ln.compare_at_price, quantity=ln.quantity, discount_amount=ln.discount,
            tax_rate=ln.tax_rate, tax_amount=ln.tax_amount, gift_wrap=ln.gift_wrap,
            gift_wrap_amount=ln.gift_wrap_amount, line_total=ln.line_total, hs_code=ln.hs_code,
            country_of_origin=ln.country_of_origin, fragility=ln.fragility))
    order.addresses.append(OrderAddress(kind="shipping", **address))
    db.add(order)
    db.flush()
    inventory.reserve(db, order, {ln.variant_id: ln.quantity for ln in quote.lines})
    db.add(ShippingFeeCollection(order_id=order.id, status=order.shipping_fee_status,
                                 estimated_amount=order.estimated_shipping_fee, currency="INR"))
    if order.coupon_code:
        c = db.scalar(select(Coupon).where(Coupon.code == order.coupon_code))
        if c:
            db.add(CouponRedemption(coupon_id=c.id, order_id=order.id, user_id=user.id,
                                    amount=order.discount_amount, status="reserved"))
    _history(db, order, "payment_status", None, "pending", "Order created")
    return order


# --------------------------------------------------------------------------- payment outcomes

def mark_paid(db: Session, order: Order, *, note: str | None = None) -> None:
    if order.payment_status == "paid":
        return
    if order.fulfillment_status == "cancelled":
        # Payment arrived after the order expired/cancelled: keep the money traceable and flag it.
        set_status(db, order, "payment_status", "paid", note=note or "Payment captured after cancellation")
        order.paid_at = _now()
        order.requires_attention = True
        order.attention_reason = "Payment captured for a cancelled order — refund required."
        return
    set_status(db, order, "payment_status", "paid", note=note)
    order.paid_at = _now()
    problems = inventory.convert(db, order)
    if problems:
        order.requires_attention = True
        order.attention_reason = "; ".join(problems)
    for r in db.scalars(select(CouponRedemption).where(CouponRedemption.order_id == order.id)).all():
        r.status = "used"
    if order.fulfillment_status == "unfulfilled":
        set_status(db, order, "fulfillment_status", "processing", note="Payment verified")
    user = db.get(User, order.user_id)
    notify(db, "order_confirmation", order.email,
           {"name": user.full_name if user else "", "order_number": order.order_number,
            "total": f"₹{order.total_amount:,.2f}", "shipping_note": order.shipping_terms.get("note", ""),
            "link": frontend_link(f"/account/orders/{order.order_number}")}, order=order, pref="order_confirmation")


def mark_payment_failed(db: Session, order: Order, reason: str | None = None) -> None:
    if order.payment_status in ("pending", "authorized"):
        set_status(db, order, "payment_status", "failed", note=reason)
        user = db.get(User, order.user_id)
        notify(db, "payment_failed", order.email,
               {"name": user.full_name if user else "", "order_number": order.order_number,
                "link": frontend_link(f"/account/orders/{order.order_number}")}, order=order, pref="payment_failed")


def _release_coupon(db: Session, order: Order) -> None:
    for r in db.scalars(select(CouponRedemption).where(CouponRedemption.order_id == order.id)).all():
        r.status = "released"


def expire_unpaid_order(db: Session, order: Order) -> None:
    inventory.release(db, order)
    _release_coupon(db, order)
    if order.payment_status == "pending":
        set_status(db, order, "payment_status", "failed", note="Payment window expired")
    if order.fulfillment_status != "cancelled":
        set_status(db, order, "fulfillment_status", "cancelled", note="Payment not completed in time")
        order.cancelled_at = _now()
        order.cancel_reason = "Payment not completed in time"
    _close_fee_collection(db, order)


def _close_fee_collection(db: Session, order: Order) -> None:
    if order.shipping_fee_status == "pending_collection":
        set_status(db, order, "shipping_fee_status", "waived", note="Order cancelled before dispatch")
        fc = db.scalar(select(ShippingFeeCollection).where(ShippingFeeCollection.order_id == order.id))
        if fc:
            fc.status = "waived"


# --------------------------------------------------------------------------- cancellation

CANCELLABLE = {"unfulfilled", "processing", "packed"}


def cancel_order(db: Session, order: Order, *, reason: str, actor: User | None = None,
                 by_customer: bool = False) -> None:
    from app.services.payments import refund_order  # avoid import cycle
    if order.fulfillment_status not in CANCELLABLE:
        raise BusinessRuleError("This order can no longer be cancelled (it has been dispatched or closed).")
    if by_customer and order.fulfillment_status == "packed":
        raise BusinessRuleError("This order is already packed. Please contact support.")
    paid = order.payment_status in ("paid", "partially_refunded")
    set_status(db, order, "fulfillment_status", "cancelled", note=reason, actor=actor)
    order.cancelled_at = _now()
    order.cancel_reason = reason
    if paid:
        for it in order.items:
            remaining = it.quantity - it.returned_quantity
            if it.variant_id and remaining > 0:
                inventory.restock(db, it.variant_id, remaining, "cancellation", order.id, actor)
        refund_order(db, order, amount=None, reason=f"Order cancelled: {reason}", actor=actor,
                     idempotency_key=f"cancel-{order.order_number}")
    else:
        inventory.release(db, order)
        if order.payment_status in ("pending", "authorized"):
            set_status(db, order, "payment_status", "failed", note="Order cancelled before payment")
    if not paid:
        _release_coupon(db, order)
    _close_fee_collection(db, order)
    if actor:
        audit(db, actor, "order.cancel", "order", order.order_number, reason=reason)
    user = db.get(User, order.user_id)
    notify(db, "order_cancelled", order.email,
           {"name": user.full_name if user else "", "order_number": order.order_number,
            "detail": "A full refund has been initiated." if paid else "No payment was taken."}, order=order)


# --------------------------------------------------------------------------- fulfillment & shipments

def _provider_problems(order: Order, provider: ShippingProvider) -> list[str]:
    problems = []
    if not provider.is_active:
        problems.append("Courier is inactive.")
    if order.is_international and not provider.supports_international:
        problems.append("Courier does not support international shipments.")
    if not order.is_international and not provider.supports_domestic:
        problems.append("Courier does not support domestic shipments.")
    if order.shipping_fee_status == "pending_collection" and not provider.supports_recipient_paid_shipping:
        problems.append("Courier cannot collect the shipping fee from the recipient on a prepaid order. "
                        "Choose a compatible courier or waive the shipping fee before dispatch.")
    if any(i.fragility and i.fragility != "standard" for i in order.items) and not provider.supports_fragile:
        problems.append("Courier does not accept fragile items.")
    return problems


def courier_warnings(db: Session, order: Order) -> list[dict]:
    out = []
    for p in db.scalars(select(ShippingProvider).where(ShippingProvider.is_active.is_(True))).all():
        out.append({"provider_id": p.id, "name": p.name, "problems": _provider_problems(order, p)})
    return out


def create_shipment(db: Session, order: Order, actor: User, *, provider_id: int, tracking_number: str | None,
                    courier_name: str | None = None, insured: bool = False, packaging_notes: str | None = None,
                    weight_grams: int | None = None) -> Shipment:
    if order.payment_status != "paid":
        raise BusinessRuleError("Product payment must be verified before a shipment can be created.",
                                code="payment_not_verified")
    if order.fulfillment_status not in ("processing", "packed"):
        raise BusinessRuleError("Order must be processing or packed to create a shipment.")
    provider = db.get(ShippingProvider, provider_id)
    if not provider:
        raise BusinessRuleError("Unknown courier")
    problems = _provider_problems(order, provider)
    if problems:
        raise BusinessRuleError("Unsupported courier arrangement", code="unsupported_courier", details=problems)
    if insured and not provider.supports_insurance:
        raise BusinessRuleError("This courier does not offer insurance.")
    existing = db.scalar(select(Shipment).where(Shipment.order_id == order.id, Shipment.kind == "outbound",
                                                Shipment.status.not_in(("returned", "lost"))))
    if existing:
        raise Conflict("An active shipment already exists for this order.")
    addr = order.shipping_address
    weight = weight_grams or int(order.shipping_terms.get("total_weight_grams") or 1000)
    adapter = get_shipping_adapter(provider.code)
    if tracking_number:
        tn, url, cname, is_test = tracking_number, None, courier_name or provider.name, False
        if provider.tracking_url_template:
            url = provider.tracking_url_template.replace("{tracking_number}", tn)
    else:
        created = adapter.create_shipment(order.order_number, order.destination_country,
                                          addr.postal_code if addr else "", weight,
                                          order.shipping_fee_status == "pending_collection",
                                          any(i.fragility != "standard" for i in order.items))
        tn, url, cname, is_test = created.tracking_number, created.tracking_url, created.courier_name, created.is_test
    customs = None
    if order.is_international:
        customs = {"invoice_number": f"INV-{order.order_number}", "currency": "INR",
                   "items": [{"description": i.product_name, "sku": i.sku, "hs_code": i.hs_code,
                              "country_of_origin": i.country_of_origin, "quantity": i.quantity,
                              "unit_value": str(i.unit_price), "total_value": str(i.line_total)} for i in order.items],
                   "total_value": str(order.total_amount), "incoterm": "DAP",
                   "duties_payable_by": "recipient"}
    shipment = Shipment(order_id=order.id, provider_id=provider.id, courier_name=cname, tracking_number=tn,
                        tracking_url=url, status="created", package_weight_grams=weight, insured=insured,
                        packaging_notes=packaging_notes, customs_data=customs, is_test=is_test)
    db.add(shipment)
    fc = db.scalar(select(ShippingFeeCollection).where(ShippingFeeCollection.order_id == order.id))
    if fc and order.shipping_fee_status == "pending_collection":
        fc.courier_reference = tn
    audit(db, actor, "shipment.create", "order", order.order_number, after={"tracking_number": tn,
                                                                             "courier": cname})
    return shipment


def update_fulfillment(db: Session, order: Order, new: str, actor: User, note: str | None = None) -> None:
    if new == "cancelled":
        cancel_order(db, order, reason=note or "Cancelled by admin", actor=actor)
        return
    if new == "dispatched" and order.payment_status != "paid":
        raise BusinessRuleError("Cannot dispatch: product payment has not been verified.", code="payment_not_verified")
    shipment = db.scalar(select(Shipment).where(Shipment.order_id == order.id, Shipment.kind == "outbound")
                         .order_by(Shipment.id.desc()))
    if new == "dispatched":
        if shipment is None or not shipment.tracking_number:
            raise BusinessRuleError("Add a shipment with courier and tracking details before dispatch.")
        provider = db.get(ShippingProvider, shipment.provider_id) if shipment.provider_id else None
        if provider:
            problems = _provider_problems(order, provider)
            if problems:
                raise BusinessRuleError("Unsupported courier arrangement", code="unsupported_courier", details=problems)
    set_status(db, order, "fulfillment_status", new, note=note, actor=actor)
    user = db.get(User, order.user_id)
    if new == "dispatched":
        order.dispatched_at = _now()
        shipment.status = "in_transit"
        shipment.shipped_at = _now()
        notify(db, "order_dispatched", order.email,
               {"name": user.full_name if user else "", "order_number": order.order_number,
                "courier": shipment.courier_name, "tracking_number": shipment.tracking_number,
                "shipping_note": order.shipping_terms.get("note", ""),
                "link": frontend_link(f"/track?order={order.order_number}")}, order=order, pref="shipping_updates")
    if new == "delivered":
        order.delivered_at = _now()
        if shipment:
            shipment.status = "delivered"
            shipment.delivered_at = _now()
        notify(db, "order_delivered", order.email,
               {"name": user.full_name if user else "", "order_number": order.order_number,
                "link": frontend_link(f"/account/orders/{order.order_number}")}, order=order, pref="shipping_updates")
    audit(db, actor, "order.fulfillment", "order", order.order_number, after={"fulfillment_status": new}, reason=note)


def update_shipping_fee(db: Session, order: Order, new: str, actor: User, *, collected_amount: Decimal | None = None,
                        note: str | None = None) -> None:
    set_status(db, order, "shipping_fee_status", new, note=note, actor=actor)
    fc = db.scalar(select(ShippingFeeCollection).where(ShippingFeeCollection.order_id == order.id))
    if fc is None:
        fc = ShippingFeeCollection(order_id=order.id, status=new, currency="INR")
        db.add(fc)
    fc.status = new
    fc.updated_by_user_id = actor.id
    if collected_amount is not None:
        fc.collected_amount = collected_amount
    if note:
        fc.notes = note
    audit(db, actor, "order.shipping_fee", "order", order.order_number,
          after={"shipping_fee_status": new, "collected_amount": collected_amount}, reason=note)


def add_tracking_event(db: Session, shipment: Shipment, status: str, description: str | None = None,
                       location: str | None = None) -> ShipmentTrackingEvent:
    ev = MockShippingAdapter().simulated_event(status, location)
    row = ShipmentTrackingEvent(shipment_id=shipment.id, external_id=ev.external_id, status=status,
                                description=description or ev.description, location=location,
                                occurred_at=ev.occurred_at)
    db.add(row)
    if status in ("in_transit", "out_for_delivery", "exception", "returned", "lost", "delivered"):
        shipment.status = status
    return row


def order_for_customer(db: Session, user: User, order_number: str) -> Order:
    from app.core.errors import NotFound
    order = db.scalar(select(Order).where(Order.order_number == order_number, Order.user_id == user.id))
    if not order:
        raise NotFound("Order not found")
    return order


def account_settings(db: Session):
    return site_settings.account(db)
