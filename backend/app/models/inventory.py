from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Inventory(Base, TimestampMixin):
    """Stock per variant. `reserved` is held for unpaid orders; available = on_hand - reserved."""
    __tablename__ = "inventory"
    __table_args__ = (
        CheckConstraint("on_hand >= 0", name="on_hand_nonneg"),
        CheckConstraint("reserved >= 0", name="reserved_nonneg"),
        CheckConstraint("reserved <= on_hand", name="reserved_le_on_hand"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"), unique=True)
    on_hand: Mapped[int] = mapped_column(Integer, default=0)
    reserved: Mapped[int] = mapped_column(Integer, default=0)

    @property
    def available(self) -> int:
        return max(0, self.on_hand - self.reserved)


class InventoryMovement(Base, TimestampMixin):
    __tablename__ = "inventory_movements"
    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"), index=True)
    change: Mapped[int] = mapped_column(Integer)  # signed change to on_hand
    reason: Mapped[str] = mapped_column(String(32))  # adjustment|sale|restock|return|cancellation|damage|import
    note: Mapped[str | None] = mapped_column(Text)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    on_hand_after: Mapped[int] = mapped_column(Integer)


class InventoryReservation(Base, TimestampMixin):
    __tablename__ = "inventory_reservations"
    __table_args__ = (CheckConstraint("quantity > 0", name="qty_pos"),
                      CheckConstraint("status IN ('active','converted','released')", name="status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="active", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
