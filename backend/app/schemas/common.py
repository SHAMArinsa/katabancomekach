from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RegisterIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    full_name: str = Field(min_length=1, max_length=160)
    phone: str | None = Field(None, max_length=32)
    accept_terms: bool
    marketing_opt_in: bool = False

    @field_validator("email")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.lower()


class LoginIn(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    mfa_code: str | None = Field(None, max_length=8)


class EmailIn(Strict):
    email: EmailStr


class TokenIn(Strict):
    token: str = Field(min_length=10, max_length=200)


class ResetPasswordIn(Strict):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordIn(Strict):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class ProfileIn(Strict):
    full_name: str | None = Field(None, min_length=1, max_length=160)
    phone: str | None = Field(None, max_length=32)
    marketing_opt_in: bool | None = None


class AddressIn(Strict):
    label: str = Field("Home", max_length=60)
    full_name: str = Field(min_length=1, max_length=160)
    phone: str = Field(min_length=5, max_length=32)
    line1: str = Field(min_length=1, max_length=255)
    line2: str | None = Field(None, max_length=255)
    city: str = Field(min_length=1, max_length=120)
    state: str | None = Field(None, max_length=120)
    postal_code: str = Field(min_length=2, max_length=20)
    country_code: str = Field(min_length=2, max_length=2)
    is_default: bool = False

    @field_validator("country_code")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper()


class CartItemIn(Strict):
    variant_id: int
    quantity: int = Field(ge=1, le=99)
    gift_wrap: bool = False


class CartItemUpdate(Strict):
    quantity: int = Field(ge=0, le=99)


class CouponIn(Strict):
    code: str | None = Field(None, max_length=40)


class QuoteIn(Strict):
    country_code: str | None = Field(None, min_length=2, max_length=2)
    postal_code: str | None = Field(None, max_length=20)
    coupon_code: str | None = Field(None, max_length=40)
    display_currency: str = Field("INR", min_length=3, max_length=3)


class CheckoutIn(Strict):
    address_id: int | None = None
    address: AddressIn | None = None
    coupon_code: str | None = Field(None, max_length=40)
    display_currency: str = Field("INR", min_length=3, max_length=3)
    note: str | None = Field(None, max_length=500)
    payment_method: Literal["online"] = "online"  # COD is not an accepted value
    accept_shipping_terms: bool
    accept_customs_terms: bool = False


class PaymentCreateIn(Strict):
    order_number: str = Field(max_length=24)


class PaymentVerifyIn(Strict):
    provider_order_id: str = Field(max_length=80)
    provider_payment_id: str = Field(max_length=80)
    signature: str = Field(max_length=256)


class MockCompleteIn(Strict):
    provider_order_id: str = Field(max_length=80)
    outcome: Literal["success", "failure"]
    send_webhook: bool = True
    duplicate_webhook: bool = False
    tamper_amount: bool = False


class ReturnItemIn(Strict):
    order_item_id: int
    quantity: int = Field(ge=1, le=99)


class ReturnIn(Strict):
    reason: str = Field(min_length=5, max_length=2000)
    items: list[ReturnItemIn] = Field(min_length=1)


class TicketIn(Strict):
    subject: str = Field(min_length=3, max_length=200)
    message: str = Field(min_length=5, max_length=5000)
    order_number: str | None = Field(None, max_length=24)
    email: EmailStr | None = None
    name: str | None = Field(None, max_length=160)


class MessageIn(Strict):
    body: str = Field(min_length=1, max_length=5000)


class ReviewIn(Strict):
    order_number: str = Field(max_length=24)
    product_id: int
    rating: int = Field(ge=1, le=5)
    title: str = Field("", max_length=160)
    body: str = Field("", max_length=4000)
    display_name: str = Field("", max_length=80)


class NewsletterIn(Strict):
    email: EmailStr
    consent: bool


class ConsentIn(Strict):
    necessary: bool = True
    analytics: bool = False
    marketing: bool = False


MoneyIn = Decimal
