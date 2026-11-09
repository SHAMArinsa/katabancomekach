"""Payment creation, verification, webhooks and refunds.

 * Orders are never marked paid from a frontend redirect alone: /payments/verify checks the
   gateway signature AND re-fetches the payment from the provider to confirm status, amount
   and currency. Webhooks are signature-verified.
 * Every verification/webhook is stored in payment_events with a unique (provider, event_id),
   so duplicates are processed exactly once.
 * Amount or currency mismatches never mark an order paid; they flag it for attention.
"""
import json
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError, NotFound, Unauthorized
from app.core.logging import logger
from app.integrations.payments import get_payment_provider
from app.models import Order, Payment, PaymentEvent, Refund, User
from app.services import orders as order_svc
from app.services import site_settings
from app.services.audit import audit
from app.services.money import to_minor
from app.services.notifications import notify


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_payment(db: Session, order: Order) -> tuple[Payment, dict]:
    if order.fulfillment_status == "cancelled":
        raise BusinessRuleError("This order has expired or was cancelled. Please place a new order.",
                                code="order_closed")
    if order.payment_status not in ("pending", "failed"):
        raise BusinessRuleError("This order does not need payment.", code="already_paid")
    if order.payment_method == "cod":  # defence in depth; DB constraint also forbids it
        raise BusinessRuleError("Cash on delivery is not available for products.")
    pay_settings = site_settings.payment(db)
    provider = get_payment_provider(pay_settings.provider)
    amount_minor = to_minor(Decimal(order.total_amount))
    porder = provider.create_order(amount_minor, "INR", order.order_number,
                                   {"order_number": order.order_number})
    if porder.amount_minor != amount_minor or porder.currency != "INR":
        raise BusinessRuleError("Payment provider returned a mismatched amount.")
    payment = Payment(order_id=order.id, provider=provider.name, provider_order_id=porder.provider_order_id,
                      amount=order.total_amount, currency="INR", status="created", is_test=provider.is_test)
    db.add(payment)
    if order.payment_status == "failed":
        order_svc.set_status(db, order, "payment_status", "pending", note="Payment retried")
    db.flush()
    checkout = {"provider": provider.name, "provider_order_id": porder.provider_order_id,
                "amount_minor": amount_minor, "currency": "INR", "order_number": order.order_number,
                "is_test": provider.is_test, **porder.checkout}
    return payment, checkout


def _apply_outcome(db: Session, payment: Payment, status: str, amount_minor: int | None, currency: str | None,
                   provider_payment_id: str | None, method: str | None, error: str | None) -> str:
    # Lock order then payment (consistent order) and reload current values to serialise
    # concurrent webhook + verify calls for the same payment.
    order = db.scalar(select(Order).where(Order.id == payment.order_id).with_for_update()
                      .execution_options(populate_existing=True))
    payment = db.scalar(select(Payment).where(Payment.id == payment.id).with_for_update()
                        .execution_options(populate_existing=True))
    if provider_payment_id and not payment.provider_payment_id:
        clash = db.scalar(select(Payment).where(Payment.provider_payment_id == provider_payment_id,
                                                Payment.id != payment.id))
        if clash is None:
            payment.provider_payment_id = provider_payment_id
    if method:
        payment.method = method
    if status in ("captured", "authorized"):
        expected = to_minor(Decimal(payment.amount))
        if amount_minor != expected or (currency or "").upper() != payment.currency:
            payment.status = "failed"
            payment.failure_reason = f"Amount/currency mismatch: got {amount_minor} {currency}, expected {expected} {payment.currency}"
            order.requires_attention = True
            order.attention_reason = payment.failure_reason
            logger.warning(f"payment mismatch on {order.order_number}: {payment.failure_reason}")
            return "amount_mismatch"
        if status == "captured":
            if payment.status == "captured":
                return "already_captured"
            payment.status = "captured"
            payment.verified_at = _now()
            order_svc.mark_paid(db, order, note=f"Verified {payment.provider} payment {payment.provider_payment_id}")
            return "captured"
        if payment.status == "created":
            payment.status = "authorized"
        if order.payment_status in ("pending", "failed"):
            order_svc.set_status(db, order, "payment_status", "authorized", note="Payment authorized")
        return "authorized"
    if status == "failed":
        if payment.status == "captured":
            return "ignored_already_captured"
        payment.status = "failed"
        payment.failure_reason = error or "Payment failed"
        order_svc.mark_payment_failed(db, order, payment.failure_reason)
        return "failed"
    return "ignored"


def verify_payment(db: Session, user: User, provider_order_id: str, provider_payment_id: str,
                   signature: str) -> Order:
    payment = db.scalar(select(Payment).join(Order, Order.id == Payment.order_id)
                        .where(Payment.provider_order_id == provider_order_id, Order.user_id == user.id))
    if not payment:
        raise NotFound("Payment not found")
    provider = get_payment_provider(payment.provider)
    if not provider.verify_checkout_signature(provider_order_id, provider_payment_id, signature):
        db.add(PaymentEvent(provider=payment.provider, event_id=f"verify-badsig:{provider_payment_id}:{_now().timestamp()}",
                            event_type="checkout.verify", payment_id=payment.id, signature_valid=False,
                            outcome="invalid_signature", payload={"provider_payment_id": provider_payment_id}))
        db.commit()
        raise Unauthorized("Payment signature could not be verified", code="invalid_signature")
    event_id = f"verify:{provider_payment_id}"
    existing = db.scalar(select(PaymentEvent).where(PaymentEvent.provider == payment.provider,
                                                    PaymentEvent.event_id == event_id))
    order = db.get(Order, payment.order_id)
    if existing:
        return order
    try:
        remote = provider.fetch_payment(provider_payment_id)
    except Exception as e:
        raise BusinessRuleError(f"Could not confirm payment with the provider: {e}", code="provider_unavailable")
    if remote.provider_order_id and remote.provider_order_id != provider_order_id:
        raise BusinessRuleError("Payment does not belong to this order", code="order_mismatch")
    status = {"captured": "captured", "authorized": "authorized", "failed": "failed"}.get(remote.status, "ignored")
    outcome = _apply_outcome(db, payment, status, remote.amount_minor, remote.currency, provider_payment_id,
                             remote.method, remote.error)
    db.add(PaymentEvent(provider=payment.provider, event_id=event_id, event_type="checkout.verify",
                        payment_id=payment.id, signature_valid=True, outcome=outcome,
                        payload={"provider_payment_id": provider_payment_id, "status": remote.status,
                                 "amount": remote.amount_minor, "currency": remote.currency}))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # a webhook or parallel verify already processed it
    db.refresh(order)
    return order


def handle_webhook(db: Session, provider_name: str, body: bytes, signature: str | None,
                   event_id_header: str | None = None) -> dict:
    provider = get_payment_provider(provider_name)
    if not provider.verify_webhook(body, signature):
        logger.warning(f"rejected webhook with invalid signature from {provider_name}")
        raise Unauthorized("Invalid webhook signature", code="invalid_signature")
    payload = json.loads(body or b"{}")
    if event_id_header:
        payload["_event_id"] = event_id_header
    ev = provider.parse_webhook(payload)
    record = PaymentEvent(provider=provider.name, event_id=ev.event_id, event_type=ev.event_type,
                          signature_valid=True, outcome="received", payload=payload)
    db.add(record)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"status": "duplicate", "event_id": ev.event_id}
    payment = None
    if ev.provider_order_id:
        payment = db.scalar(select(Payment).where(Payment.provider_order_id == ev.provider_order_id))
    if payment is None and ev.provider_payment_id:
        payment = db.scalar(select(Payment).where(Payment.provider_payment_id == ev.provider_payment_id))
    if payment is None:
        record.outcome = "unknown_payment"
        db.commit()
        return {"status": "ignored", "reason": "unknown payment"}
    record.payment_id = payment.id
    status = {"payment.captured": "captured", "order.paid": "captured", "payment.authorized": "authorized",
              "payment.failed": "failed"}.get(ev.event_type, "ignored")
    record.outcome = _apply_outcome(db, payment, status, ev.amount_minor, ev.currency, ev.provider_payment_id,
                                    ev.method, ev.error) if status != "ignored" else "ignored"
    db.commit()
    return {"status": "processed", "outcome": record.outcome}


def refunded_total(db: Session, order_id: int) -> Decimal:
    return Decimal(db.scalar(select(func.coalesce(func.sum(Refund.amount), 0))
                             .where(Refund.order_id == order_id, Refund.status != "failed")) or 0)


def refund_order(db: Session, order: Order, *, amount: Decimal | None, reason: str, actor: User | None,
                 idempotency_key: str, return_id: int | None = None, damage_claim_id: int | None = None) -> Refund:
    existing = db.scalar(select(Refund).where(Refund.idempotency_key == idempotency_key))
    if existing:
        return existing
    if order.payment_status not in ("paid", "partially_refunded"):
        raise BusinessRuleError("Only paid orders can be refunded.")
    payment = db.scalar(select(Payment).where(Payment.order_id == order.id, Payment.status == "captured")
                        .order_by(Payment.id.desc()))
    if not payment:
        raise BusinessRuleError("No captured payment found for this order.")
    refundable = Decimal(payment.amount) - refunded_total(db, order.id)
    amount = refundable if amount is None else Decimal(amount)
    if amount <= 0 or amount > refundable:
        raise BusinessRuleError(f"Refund amount must be between ₹0.01 and ₹{refundable:,.2f}.")
    refund = Refund(order_id=order.id, payment_id=payment.id, amount=amount, currency=payment.currency,
                    reason=reason, status="pending", idempotency_key=idempotency_key, return_id=return_id,
                    damage_claim_id=damage_claim_id, actor_user_id=actor.id if actor else None)
    db.add(refund)
    db.flush()
    try:
        provider = get_payment_provider(payment.provider)
        result = provider.refund(payment.provider_payment_id or "", to_minor(amount), idempotency_key,
                                 {"order_number": order.order_number})
        refund.provider_refund_id = result.provider_refund_id
        refund.status = result.status if result.status in ("processed", "pending") else "failed"
    except Exception as e:
        refund.status = "failed"
        refund.reason = f"{reason} (provider error: {str(e)[:200]})"
    if refund.status != "failed":
        refund.processed_at = _now() if refund.status == "processed" else None
        fully = (refundable - amount) <= Decimal("0.00")
        new_status = "refunded" if fully else "partially_refunded"
        order_svc.set_status(db, order, "payment_status", new_status, note=reason, actor=actor)
        user = db.get(User, order.user_id)
        notify(db, "refund_processed", order.email,
               {"name": user.full_name if user else "", "order_number": order.order_number,
                "amount": f"₹{amount:,.2f}"}, order=order, pref="return_updates")
    if actor:
        audit(db, actor, "refund.create", "order", order.order_number,
              after={"amount": amount, "status": refund.status}, reason=reason)
    return refund
