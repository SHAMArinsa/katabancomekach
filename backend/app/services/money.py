"""Currency conversion and rounding.

Base currency is INR. All financial truth (orders, payments, thresholds) is in INR.
Other currencies are display conversions using admin-managed exchange rates.
Rounding: ROUND_HALF_UP to the currency's minor units (configurable to HALF_EVEN).
"""
from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import BusinessRuleError
from app.models import Currency, ExchangeRate

BASE_CURRENCY = "INR"
TWO = Decimal("0.01")


def q(amount, rounding: str = "half_up", decimals: int = 2) -> Decimal:
    exp = Decimal(1).scaleb(-decimals) if decimals else Decimal(1)
    mode = ROUND_HALF_EVEN if rounding == "half_even" else ROUND_HALF_UP
    return Decimal(str(amount)).quantize(exp, rounding=mode)


def to_minor(amount: Decimal, decimals: int = 2) -> int:
    return int((q(amount, decimals=decimals) * (10 ** decimals)).to_integral_value())


def latest_rate(db: Session, currency: str) -> Decimal:
    if currency == BASE_CURRENCY:
        return Decimal(1)
    cur = db.get(Currency, currency)
    if not cur or not cur.is_enabled:
        raise BusinessRuleError(f"Currency {currency} is not supported", code="unsupported_currency")
    rate = db.scalar(select(ExchangeRate).where(ExchangeRate.quote_currency == currency)
                     .order_by(ExchangeRate.effective_at.desc()).limit(1))
    if not rate:
        raise BusinessRuleError(f"No exchange rate configured for {currency}", code="missing_exchange_rate")
    return Decimal(rate.rate)


def convert(db: Session, amount_inr: Decimal, currency: str, rounding: str = "half_up") -> Decimal:
    if currency == BASE_CURRENCY:
        return q(amount_inr, rounding)
    cur = db.get(Currency, currency)
    decimals = cur.decimals if cur else 2
    return q(Decimal(amount_inr) * latest_rate(db, currency), rounding, decimals)
