from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Money, TimestampMixin
from app.models.enums import REFUND_STATUSES, check_in


class Payment(Base, TimestampMixin):
    """A payment attempt for an order. Verified rows are immutable from the admin UI."""
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("status IN ('created','authorized','captured','failed')", name="status"),
        CheckConstraint("method <> 'cod'", name="no_cod"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    provider: Mapped[str] = mapped_column(String(24))
    provider_order_id: Mapped[str] = mapped_column(String(80), unique=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(80), unique=True)
    method: Mapped[str] = mapped_column(String(24), default="online")
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(16), default="created")
    is_test: Mapped[bool] = mapped_column(Boolean, default=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict | None] = mapped_column(JSONB)


class PaymentEvent(Base, TimestampMixin):
    """Webhook/verification events, stored once per (provider, event_id) for idempotency."""
    __tablename__ = "payment_events"
    __table_args__ = (UniqueConstraint("provider", "event_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(24))
    event_id: Mapped[str] = mapped_column(String(120))
    event_type: Mapped[str] = mapped_column(String(60))
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"), index=True)
    signature_valid: Mapped[bool] = mapped_column(Boolean)
    outcome: Mapped[str] = mapped_column(String(40), default="received")
    payload: Mapped[dict] = mapped_column(JSONB)


class Refund(Base, TimestampMixin):
    __tablename__ = "refunds"
    __table_args__ = (CheckConstraint(check_in("status", REFUND_STATUSES), name="status"),
                      CheckConstraint("amount > 0", name="amount_pos"),
                      UniqueConstraint("idempotency_key"))
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    provider_refund_id: Mapped[str | None] = mapped_column(String(80))
    idempotency_key: Mapped[str] = mapped_column(String(80))
    return_id: Mapped[int | None] = mapped_column(ForeignKey("returns.id", ondelete="SET NULL"))
    damage_claim_id: Mapped[int | None] = mapped_column(ForeignKey("damage_claims.id", ondelete="SET NULL"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
