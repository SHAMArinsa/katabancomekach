from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import CLAIM_STATUSES, RETURN_STATUSES, TICKET_STATUSES, check_in


class Return(Base, TimestampMixin):
    __tablename__ = "returns"
    __table_args__ = (CheckConstraint(check_in("status", RETURN_STATUSES), name="status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="requested")
    admin_note: Mapped[str | None] = mapped_column(Text)
    return_tracking_number: Mapped[str | None] = mapped_column(String(120))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    items: Mapped[list["ReturnItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class ReturnItem(Base):
    __tablename__ = "return_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="qty_pos"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("returns.id", ondelete="CASCADE"), index=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("order_items.id", ondelete="CASCADE"))
    quantity: Mapped[int] = mapped_column(Integer)
    restock: Mapped[bool] = mapped_column(Boolean, default=False)


class DamageClaim(Base, TimestampMixin):
    __tablename__ = "damage_claims"
    __table_args__ = (CheckConstraint(check_in("status", CLAIM_STATUSES), name="status"),
                      CheckConstraint("claim_type IN ('damaged','lost','wrong_item')", name="claim_type"))
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    order_item_id: Mapped[int | None] = mapped_column(ForeignKey("order_items.id", ondelete="SET NULL"))
    claim_type: Mapped[str] = mapped_column(String(16), default="damaged")
    description: Mapped[str] = mapped_column(Text)
    evidence_keys: Mapped[list[str]] = mapped_column(ARRAY(String(500)), default=list)  # private storage keys
    status: Mapped[str] = mapped_column(String(24), default="submitted")
    resolution_note: Mapped[str | None] = mapped_column(Text)
    replacement_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SupportTicket(Base, TimestampMixin):
    __tablename__ = "support_tickets"
    __table_args__ = (CheckConstraint(check_in("status", TICKET_STATUSES), name="status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(160), default="")
    subject: Mapped[str] = mapped_column(String(200))
    order_number: Mapped[str | None] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    assigned_to_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    messages: Mapped[list["SupportMessage"]] = relationship(cascade="all, delete-orphan", lazy="selectin",
                                                            order_by="SupportMessage.id")


class SupportMessage(Base, TimestampMixin):
    __tablename__ = "support_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True)
    author_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_staff: Mapped[bool] = mapped_column(Boolean, default=False)
    body: Mapped[str] = mapped_column(Text)
