from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy.orm import Session

from app.core.deps import get_optional_customer
from app.db.session import get_db
from app.models import User
from app.schemas.common import CartItemIn, Strict
from app.schemas.serializers import plain
from app.services.pricing import CartLineInput, build_quote

router = APIRouter(prefix="/shipping", tags=["shipping"])


class GuestQuoteIn(Strict):
    items: list[CartItemIn] = Field(max_length=50)
    country_code: str | None = Field(None, min_length=2, max_length=2)
    postal_code: str | None = Field(None, max_length=20)
    coupon_code: str | None = Field(None, max_length=40)
    display_currency: str = Field("INR", min_length=3, max_length=3)


@router.post("/quote")
def guest_quote(body: GuestQuoteIn, user: User | None = Depends(get_optional_customer), db: Session = Depends(get_db)):
    """Quote for a bag held in the browser (guests). Same engine as checkout; nothing is reserved."""
    q = build_quote(db, [CartLineInput(i.variant_id, i.quantity, i.gift_wrap) for i in body.items],
                    country=body.country_code, postal_code=body.postal_code, coupon_code=body.coupon_code,
                    user=user, display_currency=body.display_currency)
    return plain(q.to_dict())
