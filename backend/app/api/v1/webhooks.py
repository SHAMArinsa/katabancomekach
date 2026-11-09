from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.errors import NotFound
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.services import payments as pay_svc

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

SIGNATURE_HEADERS = {"razorpay": "x-razorpay-signature", "mock": "x-mock-signature"}
EVENT_ID_HEADERS = {"razorpay": "x-razorpay-event-id"}


@router.post("/payments/{provider}", dependencies=[Depends(rate_limit("webhooks", 300, 60))])
async def payment_webhook(provider: str, request: Request, db: Session = Depends(get_db)):
    if provider not in SIGNATURE_HEADERS:
        raise NotFound("Unknown provider")
    body = await request.body()
    sig = request.headers.get(SIGNATURE_HEADERS[provider])
    event_id = request.headers.get(EVENT_ID_HEADERS.get(provider, ""), None) if provider in EVENT_ID_HEADERS else None
    return pay_svc.handle_webhook(db, provider, body, sig, event_id)
