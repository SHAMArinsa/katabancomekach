from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Money, TimestampMixin


class Coupon(Base, TimestampMixin):
    __tablename__ = "coupons"
    __table_args__ = (
        CheckConstraint("discount_type IN ('percent','fixed')", name="discount_type"),
        CheckConstraint("value > 0", name="value_pos"),
        CheckConstraint("discount_type <> 'percent' OR value <= 100", name="percent_le_100"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)  # stored upper-case
    description: Mapped[str] = mapped_column(String(255), default="")
    discount_type: Mapped[str] = mapped_column(String(10))
    value: Mapped[Decimal] = mapped_column(Money)
    min_order_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    max_discount_amount: Mapped[Decimal | None] = mapped_column(Money)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    usage_limit: Mapped[int | None] = mapped_column(Integer)
    per_customer_limit: Mapped[int | None] = mapped_column(Integer, default=1)
    applies_to_sale_items: Mapped[bool] = mapped_column(Boolean, default=False)  # stacking with sale prices
    domestic_only: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CouponRedemption(Base, TimestampMixin):
    __tablename__ = "coupon_redemptions"
    __table_args__ = (UniqueConstraint("coupon_id", "order_id"),
                      CheckConstraint("status IN ('reserved','used','released')", name="status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    coupon_id: Mapped[int] = mapped_column(ForeignKey("coupons.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    status: Mapped[str] = mapped_column(String(10), default="reserved")


class Currency(Base, TimestampMixin):
    __tablename__ = "currencies"
    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    symbol: Mapped[str] = mapped_column(String(8))
    decimals: Mapped[int] = mapped_column(Integer, default=2)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_base: Mapped[bool] = mapped_column(Boolean, default=False)


class ExchangeRate(Base, TimestampMixin):
    """1 unit of base currency (INR) = `rate` units of `quote_currency`."""
    __tablename__ = "exchange_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    quote_currency: Mapped[str] = mapped_column(ForeignKey("currencies.code", ondelete="CASCADE"), index=True)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8))
    source: Mapped[str] = mapped_column(String(60), default="manual")
    effective_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class TaxRule(Base, TimestampMixin):
    __tablename__ = "tax_rules"
    __table_args__ = (UniqueConstraint("tax_class", "country_code"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tax_class: Mapped[str] = mapped_column(String(40))
    country_code: Mapped[str] = mapped_column(String(2))  # "IN" or "*" for any international destination
    rate_percent: Mapped[Decimal] = mapped_column(Numeric(6, 3))
    label: Mapped[str] = mapped_column(String(60), default="GST")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
