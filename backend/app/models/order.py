from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Money, TimestampMixin
from app.models.enums import FULFILLMENT_STATUSES, PAYMENT_STATUSES, SHIPPING_FEE_STATUSES, check_in


class Order(Base, TimestampMixin):
    """All amounts are snapshots taken at order creation, in the base currency (INR)."""
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(check_in("payment_status", PAYMENT_STATUSES), name="payment_status"),
        CheckConstraint(check_in("shipping_fee_status", SHIPPING_FEE_STATUSES), name="shipping_fee_status"),
        CheckConstraint(check_in("fulfillment_status", FULFILLMENT_STATUSES), name="fulfillment_status"),
        CheckConstraint("payment_method <> 'cod'", name="no_cod"),
        CheckConstraint("total_amount >= 0", name="total_nonneg"),
        # Business rule: an order can never be dispatched/delivered unless the product payment is verified.
        CheckConstraint(
            "fulfillment_status NOT IN ('dispatched','delivered') OR payment_status IN ('paid','partially_refunded','refunded')",
            name="dispatch_requires_payment"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    is_international: Mapped[bool] = mapped_column(Boolean, default=False)
    destination_country: Mapped[str] = mapped_column(String(2), index=True)

    base_currency: Mapped[str] = mapped_column(String(3), default="INR")
    display_currency: Mapped[str] = mapped_column(String(3), default="INR")
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=1)  # base -> display

    subtotal_amount: Mapped[Decimal] = mapped_column(Money)
    discount_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    gift_wrap_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    prices_include_tax: Mapped[bool] = mapped_column(Boolean, default=True)
    total_amount: Mapped[Decimal] = mapped_column(Money)  # charged online (product amount)
    eligible_subtotal: Mapped[Decimal] = mapped_column(Money)
    free_delivery_threshold: Mapped[Decimal] = mapped_column(Money)
    free_delivery: Mapped[bool] = mapped_column(Boolean)
    estimated_shipping_fee: Mapped[Decimal | None] = mapped_column(Money)  # collected by courier, not charged online
    coupon_code: Mapped[str | None] = mapped_column(String(40))

    payment_method: Mapped[str] = mapped_column(String(24), default="online")
    payment_status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    shipping_fee_status: Mapped[str] = mapped_column(String(24), index=True)
    fulfillment_status: Mapped[str] = mapped_column(String(24), default="unfulfilled", index=True)

    shipping_terms: Mapped[dict] = mapped_column(JSONB, default=dict)  # snapshot of arrangement shown to customer
    customs_disclosure: Mapped[str | None] = mapped_column(Text)
    customer_note: Mapped[str | None] = mapped_column(Text)
    requires_attention: Mapped[bool] = mapped_column(Boolean, default=False)
    attention_reason: Mapped[str | None] = mapped_column(Text)
    is_test: Mapped[bool] = mapped_column(Boolean, default=False)

    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str | None] = mapped_column(Text)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin",
                                                    order_by="OrderItem.id")
    addresses: Mapped[list["OrderAddress"]] = relationship(cascade="all, delete-orphan", lazy="selectin")

    @property
    def shipping_address(self) -> "OrderAddress | None":
        return next((a for a in self.addresses if a.kind == "shipping"), None)


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="qty_pos"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id", ondelete="SET NULL"))
    product_name: Mapped[str] = mapped_column(String(200))
    variant_name: Mapped[str] = mapped_column(String(120), default="")
    sku: Mapped[str] = mapped_column(String(64))
    image_url: Mapped[str | None] = mapped_column(String(500))
    unit_price: Mapped[Decimal] = mapped_column(Money)
    compare_at_price: Mapped[Decimal | None] = mapped_column(Money)
    quantity: Mapped[int] = mapped_column(Integer)
    discount_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=0)
    tax_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    gift_wrap: Mapped[bool] = mapped_column(Boolean, default=False)
    gift_wrap_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    line_total: Mapped[Decimal] = mapped_column(Money)
    hs_code: Mapped[str | None] = mapped_column(String(16))
    country_of_origin: Mapped[str | None] = mapped_column(String(2))
    fragility: Mapped[str | None] = mapped_column(String(20))
    returned_quantity: Mapped[int] = mapped_column(Integer, default=0)


class OrderAddress(Base):
    __tablename__ = "order_addresses"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="shipping")  # shipping | billing
    full_name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(32))
    line1: Mapped[str] = mapped_column(String(255))
    line2: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(120))
    postal_code: Mapped[str] = mapped_column(String(20))
    country_code: Mapped[str] = mapped_column(String(2))


class OrderStatusHistory(Base, TimestampMixin):
    __tablename__ = "order_status_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    field: Mapped[str] = mapped_column(String(32))  # payment_status | shipping_fee_status | fulfillment_status
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str] = mapped_column(String(24))
    note: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
