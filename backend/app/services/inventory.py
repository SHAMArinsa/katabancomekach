"""Inventory with reservations and row-level locking.

 * reserve():  at order creation — locks inventory rows (SELECT ... FOR UPDATE, ordered by
               variant id to avoid deadlocks) and increments `reserved`. Fails atomically if any
               line lacks stock, so concurrent checkouts cannot oversell.
 * convert():  after verified payment — moves reserved stock out of on_hand (stock deduction).
 * release():  on payment failure/expiry/cancellation before payment — frees the reservation.
 * restock():  after a paid order is cancelled before dispatch, or an approved return is restocked.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import BusinessRuleError, Conflict
from app.models import Inventory, InventoryMovement, InventoryReservation, Order, User


def _now() -> datetime:
    return datetime.now(timezone.utc)


def lock_inventory(db: Session, variant_ids: list[int]) -> dict[int, Inventory]:
    rows = db.scalars(select(Inventory).where(Inventory.variant_id.in_(sorted(set(variant_ids))))
                      .order_by(Inventory.variant_id).with_for_update()
                      .execution_options(populate_existing=True)).all()
    return {r.variant_id: r for r in rows}


def reserve(db: Session, order: Order, quantities: dict[int, int]) -> None:
    inv = lock_inventory(db, list(quantities))
    expires = _now() + timedelta(minutes=settings.RESERVATION_MINUTES)
    for vid, qty in sorted(quantities.items()):
        row = inv.get(vid)
        if row is None or row.on_hand - row.reserved < qty:
            raise Conflict("Some items just sold out. Please review your bag.", code="insufficient_stock",
                           details={"variant_id": vid, "available": (row.on_hand - row.reserved) if row else 0})
        row.reserved += qty
        db.add(InventoryReservation(variant_id=vid, order_id=order.id, quantity=qty, status="active",
                                    expires_at=expires))


def _active_reservations(db: Session, order_id: int) -> list[InventoryReservation]:
    return db.scalars(select(InventoryReservation).where(InventoryReservation.order_id == order_id,
                                                         InventoryReservation.status == "active")
                      .with_for_update().execution_options(populate_existing=True)).all()


def convert(db: Session, order: Order) -> list[str]:
    """Deduct stock for a paid order. Returns a list of problems (e.g. reservation had expired and
    stock was sold elsewhere) — the order is then flagged for attention instead of overselling."""
    problems: list[str] = []
    reservations = _active_reservations(db, order.id)
    reserved_by_variant = {r.variant_id: r for r in reservations}
    needed = {it.variant_id: it.quantity for it in order.items if it.variant_id}
    inv = lock_inventory(db, list(needed))
    for vid, qty in sorted(needed.items()):
        row = inv.get(vid)
        res = reserved_by_variant.get(vid)
        if res is not None:
            row.reserved -= res.quantity
            res.status = "converted"
        if row is None or row.on_hand - row.reserved < qty:
            problems.append(f"Insufficient stock for variant {vid} after payment")
            continue
        row.on_hand -= qty
        db.add(InventoryMovement(variant_id=vid, change=-qty, reason="sale", order_id=order.id,
                                 on_hand_after=row.on_hand))
    return problems


def release(db: Session, order: Order) -> None:
    reservations = _active_reservations(db, order.id)
    if not reservations:
        return
    inv = lock_inventory(db, [r.variant_id for r in reservations])
    for r in reservations:
        row = inv.get(r.variant_id)
        if row is not None:
            row.reserved = max(0, row.reserved - r.quantity)
        r.status = "released"


def restock(db: Session, variant_id: int, qty: int, reason: str, order_id: int | None = None,
            actor: User | None = None, note: str | None = None) -> None:
    inv = lock_inventory(db, [variant_id]).get(variant_id)
    if inv is None:
        return
    inv.on_hand += qty
    db.add(InventoryMovement(variant_id=variant_id, change=qty, reason=reason, order_id=order_id,
                             actor_user_id=actor.id if actor else None, note=note, on_hand_after=inv.on_hand))


def adjust(db: Session, variant_id: int, *, set_to: int | None = None, delta: int | None = None,
           reason: str = "adjustment", note: str | None = None, actor: User | None = None) -> Inventory:
    inv = lock_inventory(db, [variant_id]).get(variant_id)
    if inv is None:
        inv = Inventory(variant_id=variant_id, on_hand=0, reserved=0)
        db.add(inv)
        db.flush()
    new = set_to if set_to is not None else inv.on_hand + (delta or 0)
    if new < 0:
        raise BusinessRuleError("Stock cannot be negative")
    if new < inv.reserved:
        raise BusinessRuleError(f"{inv.reserved} units are reserved by pending orders; stock cannot go below that.")
    change = new - inv.on_hand
    inv.on_hand = new
    if change:
        db.add(InventoryMovement(variant_id=variant_id, change=change, reason=reason, note=note,
                                 actor_user_id=actor.id if actor else None, on_hand_after=new))
    return inv


def sweep_expired(db: Session) -> int:
    """Release expired reservations of unpaid orders and cancel those orders. Safe to call often."""
    from app.services.orders import expire_unpaid_order  # local import to avoid cycle
    expired_order_ids = db.scalars(
        select(InventoryReservation.order_id).where(InventoryReservation.status == "active",
                                                    InventoryReservation.expires_at < _now()).distinct()).all()
    count = 0
    for oid in expired_order_ids:
        order = db.scalar(select(Order).where(Order.id == oid).with_for_update(skip_locked=True)
                          .execution_options(populate_existing=True))
        if order and order.payment_status in ("pending", "failed"):
            expire_unpaid_order(db, order)
            count += 1
    db.commit()
    return count
