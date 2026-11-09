from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_customer
from app.core.errors import BusinessRuleError, Forbidden, NotFound
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.integrations.payments import mock_provider
from app.models import Order, Payment, User
from app.schemas.common import MockCompleteIn, PaymentCreateIn, PaymentVerifyIn
from app.schemas.serializers import order_out
from app.services import payments as pay_svc
from app.services import orders as order_svc

router = APIRouter(prefix="/payments", tags=["payments"])
pay_limit = rate_limit("payments", 20, 60)


@router.post("/create", dependencies=[Depends(pay_limit)])
def create(body: PaymentCreateIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    order = order_svc.order_for_customer(db, user, body.order_number)
    order = db.scalar(select(Order).where(Order.id == order.id).with_for_update()
                      .execution_options(populate_existing=True))
    _payment, checkout = pay_svc.create_payment(db, order)
    db.commit()
    checkout.update({"customer": {"name": user.full_name, "email": user.email, "contact": user.phone or ""}})
    return checkout


@router.post("/verify", dependencies=[Depends(pay_limit)])
def verify(body: PaymentVerifyIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    order = pay_svc.verify_payment(db, user, body.provider_order_id, body.provider_payment_id, body.signature)
    return order_out(order)


@router.post("/mock/complete", dependencies=[Depends(pay_limit)])
def mock_complete(body: MockCompleteIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    """DEVELOPMENT/TEST ONLY. Simulates the hosted gateway: produces a signed result for the browser and
    (optionally) delivers a signed webhook, including duplicates. Disabled in production."""
    if settings.is_production and not settings.ALLOW_MOCK_IN_PRODUCTION:
        raise Forbidden("Mock payments are disabled")
    payment = db.scalar(select(Payment).join(Order, Order.id == Payment.order_id)
                        .where(Payment.provider_order_id == body.provider_order_id, Order.user_id == user.id))
    if not payment or payment.provider != "mock":
        raise NotFound("Mock payment not found")
    mock = mock_provider()
    amount_minor = None
    if body.tamper_amount:
        amount_minor = int(payment.amount * 100) - 100  # simulate a gateway/amount mismatch
    result, signature = mock.simulate(body.provider_order_id, body.outcome, amount_minor=amount_minor)
    webhook_results = []
    if body.send_webhook:
        raw, sig = mock.webhook_body(result)
        webhook_results.append(pay_svc.handle_webhook(db, "mock", raw, sig))
        if body.duplicate_webhook:
            webhook_results.append(pay_svc.handle_webhook(db, "mock", raw, sig))
    return {"provider_order_id": body.provider_order_id, "provider_payment_id": result.provider_payment_id,
            "signature": signature, "status": result.status, "webhooks": webhook_results, "is_test": True}
