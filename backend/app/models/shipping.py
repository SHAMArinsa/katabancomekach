from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Money, TimestampMixin
from app.models.enums import SHIPMENT_STATUSES, SHIPPING_FEE_STATUSES, check_in


class ShippingProvider(Base, TimestampMixin):
    __tablename__ = "shipping_providers"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)  # adapter key, e.g. "mock"
    name: Mapped[str] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    supports_domestic: Mapped[bool] = mapped_column(Boolean, default=True)
    supports_international: Mapped[bool] = mapped_column(Boolean, default=False)
    # Courier collects shipping charge from the recipient on a prepaid (product-paid) parcel
    supports_recipient_paid_shipping: Mapped[bool] = mapped_column(Boolean, default=False)
    supports_fragile: Mapped[bool] = mapped_column(Boolean, default=True)
    supports_insurance: Mapped[bool] = mapped_column(Boolean, default=False)
    tracking_url_template: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)


class ShippingZone(Base, TimestampMixin):
    __tablename__ = "shipping_zones"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    is_domestic: Mapped[bool] = mapped_column(Boolean, default=False)
    country_codes: Mapped[list[str]] = mapped_column(ARRAY(String(2)), default=list)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("shipping_providers.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    estimated_days_min: Mapped[int] = mapped_column(Integer, default=3)
    estimated_days_max: Mapped[int] = mapped_column(Integer, default=7)
    provider: Mapped[ShippingProvider | None] = relationship(lazy="joined")
    rates: Mapped[list["ShippingRate"]] = relationship(cascade="all, delete-orphan", lazy="selectin",
                                                       order_by="ShippingRate.max_weight_grams")


class ShippingRate(Base, TimestampMixin):
    """Indicative recipient-paid fee (base currency), by weight band. Shown as an estimate only."""
    __tablename__ = "shipping_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("shipping_zones.id", ondelete="CASCADE"), index=True)
    max_weight_grams: Mapped[int] = mapped_column(Integer)
    fee: Mapped[Decimal] = mapped_column(Money)
    fragile_surcharge: Mapped[Decimal] = mapped_column(Money, default=0)


class DestinationEligibility(Base, TimestampMixin):
    __tablename__ = "destination_eligibility"
    id: Mapped[int] = mapped_column(primary_key=True)
    country_code: Mapped[str] = mapped_column(String(2), unique=True)
    country_name: Mapped[str] = mapped_column(String(120))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    allows_fragile: Mapped[bool] = mapped_column(Boolean, default=True)
    currency_code: Mapped[str] = mapped_column(String(3), default="INR")
    postal_code_regex: Mapped[str | None] = mapped_column(String(120))
    customs_note: Mapped[str | None] = mapped_column(Text)
    restriction_reason: Mapped[str | None] = mapped_column(Text)


class Shipment(Base, TimestampMixin):
    __tablename__ = "shipments"
    __table_args__ = (CheckConstraint(check_in("status", SHIPMENT_STATUSES), name="status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("shipping_providers.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(12), default="outbound")  # outbound | return | replacement
    courier_name: Mapped[str] = mapped_column(String(120))
    tracking_number: Mapped[str | None] = mapped_column(String(120), index=True)
    tracking_url: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="created")
    package_weight_grams: Mapped[int | None] = mapped_column(Integer)
    insured: Mapped[bool] = mapped_column(Boolean, default=False)
    packaging_notes: Mapped[str | None] = mapped_column(Text)
    customs_data: Mapped[dict | None] = mapped_column(JSONB)  # commercial invoice / declaration snapshot
    is_test: Mapped[bool] = mapped_column(Boolean, default=False)
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    events: Mapped[list["ShipmentTrackingEvent"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="ShipmentTrackingEvent.occurred_at")


class ShipmentTrackingEvent(Base):
    __tablename__ = "shipment_tracking_events"
    __table_args__ = (UniqueConstraint("shipment_id", "external_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    shipment_id: Mapped[int] = mapped_column(ForeignKey("shipments.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(String(500))
    location: Mapped[str | None] = mapped_column(String(160))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ShippingFeeCollection(Base, TimestampMixin):
    """Recipient-paid shipping fee, tracked independently of product payment."""
    __tablename__ = "shipping_fee_collections"
    __table_args__ = (CheckConstraint(check_in("status", SHIPPING_FEE_STATUSES), name="status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), unique=True)
    status: Mapped[str] = mapped_column(String(24))
    estimated_amount: Mapped[Decimal | None] = mapped_column(Money)
    collected_amount: Mapped[Decimal | None] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    courier_reference: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
