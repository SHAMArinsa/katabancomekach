import mimetypes
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import request_ip, require
from app.core.errors import BusinessRuleError, NotFound
from app.db.session import get_db
from app.integrations.storage import private_storage
from app.models import (DamageClaim, Order, OrderItem, ProductReview, Return, SupportMessage, SupportTicket, User,
                        UserAddress)
from app.schemas.admin import ClaimDecisionIn, RestrictIn, ReturnDecisionIn, TicketUpdateIn
from app.schemas.serializers import claim_out, m, return_out, ticket_out, user_out
from app.services import inventory as inv_svc
from app.services import payments as pay_svc
from app.services.audit import audit
from app.services.auth import revoke_all
from app.services.notifications import notify

router = APIRouter(tags=["admin-customers"])


def _now():
    return datetime.now(timezone.utc)


# ======================================================================= customers

@router.get("/customers")
def list_customers(db: Session = Depends(get_db), admin: User = Depends(require("customers.read")),
                   q: str | None = Query(None, max_length=100), restricted: bool | None = None,
                   deletion_requested: bool = False, page: int = Query(1, ge=1)):
    pii = "customers.pii" in admin.permission_codes
    stmt = select(User).where(User.is_staff.is_(False))
    if q:
        pat = f"%{q}%"
        stmt = stmt.where(or_(User.email.ilike(pat), User.full_name.ilike(pat), User.phone.ilike(pat)))
    if restricted is not None:
        stmt = stmt.where(User.restricted_at.is_not(None) if restricted else User.restricted_at.is_(None))
    if deletion_requested:
        stmt = stmt.where(User.deletion_requested_at.is_not(None), User.deleted_at.is_(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.created_at.desc()).offset((page - 1) * 25).limit(25)).all()
    counts = dict(db.execute(select(Order.user_id, func.count()).where(Order.user_id.in_([u.id for u in rows]))
                             .group_by(Order.user_id)).all()) if rows else {}
    return {"items": [user_out(u, admin_view=True, pii=pii) | {"order_count": counts.get(u.id, 0)} for u in rows],
            "total": total, "page": page, "pages": (total + 24) // 25}


def _customer(db: Session, uid: int) -> User:
    u = db.get(User, uid)
    if not u or u.is_staff:
        raise NotFound("Customer not found")
    return u


@router.get("/customers/{uid}")
def get_customer(uid: int, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(require("customers.read"))):
    u = _customer(db, uid)
    pii = "customers.pii" in admin.permission_codes
    orders = db.scalars(select(Order).where(Order.user_id == u.id).order_by(Order.created_at.desc())).all()
    out = user_out(u, admin_view=True, pii=pii)
    out["orders"] = [{"order_number": o.order_number, "created_at": o.created_at.isoformat(),
                      "total": m(o.total_amount), "payment_status": o.payment_status,
                      "fulfillment_status": o.fulfillment_status} for o in orders]
    out["lifetime_value"] = m(sum((o.total_amount for o in orders if o.payment_status in ("paid", "partially_refunded")), 0))
    if pii:
        out["addresses"] = [{"label": a.label, "full_name": a.full_name, "line1": a.line1, "city": a.city,
                             "postal_code": a.postal_code, "country_code": a.country_code, "phone": a.phone}
                            for a in db.scalars(select(UserAddress).where(UserAddress.user_id == u.id)).all()]
        audit(db, admin, "customer.view_pii", "user", u.id, ip=request_ip(request))
        db.commit()
    out["tickets"] = [ticket_out(t) for t in db.scalars(select(SupportTicket).where(SupportTicket.user_id == u.id)).all()]
    return out


@router.post("/customers/{uid}/restrict")
def restrict(uid: int, body: RestrictIn, request: Request, db: Session = Depends(get_db),
             admin: User = Depends(require("customers.write"))):
    u = _customer(db, uid)
    if body.restricted:
        u.restricted_at = _now()
        u.restriction_reason = body.reason
        revoke_all(db, u)
    else:
        u.restricted_at = None
        u.restriction_reason = None
    audit(db, admin, "customer.restrict" if body.restricted else "customer.unrestrict", "user", u.id,
          reason=body.reason, ip=request_ip(request))
    db.commit()
    return user_out(u, admin_view=True)


@router.post("/customers/{uid}/process-deletion")
def process_deletion(uid: int, request: Request, db: Session = Depends(get_db),
                     admin: User = Depends(require("customers.write", "customers.pii"))):
    """Anonymise the account. Orders are retained (legal/tax) but de-identified."""
    u = _customer(db, uid)
    open_orders = db.scalar(select(func.count()).select_from(Order).where(
        Order.user_id == u.id, Order.fulfillment_status.in_(("processing", "packed", "dispatched")))) or 0
    if open_orders:
        raise BusinessRuleError("This customer has orders in progress. Process deletion after they complete.")
    anon = f"deleted-{u.id}@invalid.local"
    for a in db.scalars(select(UserAddress).where(UserAddress.user_id == u.id)).all():
        db.delete(a)
    for o in db.scalars(select(Order).where(Order.user_id == u.id)).all():
        o.email = anon
        for addr in o.addresses:
            addr.full_name, addr.phone, addr.line1, addr.line2 = "Deleted customer", "-", "-", None
    u.email, u.full_name, u.phone = anon, "Deleted customer", None
    u.is_active = False
    u.deleted_at = _now()
    u.password_hash = "!"
    u.marketing_opt_in = False
    revoke_all(db, u)
    audit(db, admin, "customer.delete", "user", uid, reason="Account deletion request processed",
          ip=request_ip(request))
    db.commit()
    return {"ok": True}


# ======================================================================= returns

@router.get("/returns")
def list_returns(db: Session = Depends(get_db), _: User = Depends(require("support.manage")),
                 status: str | None = None):
    stmt = select(Return, Order.order_number).join(Order, Order.id == Return.order_id)
    if status:
        stmt = stmt.where(Return.status == status)
    return [return_out(r) | {"order_number": n} for r, n in db.execute(stmt.order_by(Return.id.desc()).limit(200)).all()]


@router.post("/returns/{rid}")
def decide_return(rid: int, body: ReturnDecisionIn, db: Session = Depends(get_db),
                  admin: User = Depends(require("support.manage"))):
    r = db.get(Return, rid)
    if not r:
        raise NotFound("Return not found")
    order = db.scalar(select(Order).where(Order.id == r.order_id).with_for_update())
    allowed = {"requested": {"approved", "rejected"}, "approved": {"received", "rejected"},
               "received": {"refunded", "closed"}, "refunded": {"closed"}, "rejected": {"closed"}, "closed": set()}
    if body.status not in allowed[r.status]:
        raise BusinessRuleError(f"Cannot move a return from {r.status} to {body.status}.")
    if body.status == "refunded" and "payments.refund" not in admin.permission_codes:
        from app.core.errors import Forbidden
        raise Forbidden("Refund permission required")
    items = {i.id: i for i in order.items}
    if body.status == "received":
        for ri in r.items:
            oi = items[ri.order_item_id]
            oi.returned_quantity += ri.quantity
            if body.restock and oi.variant_id:
                ri.restock = True
                inv_svc.restock(db, oi.variant_id, ri.quantity, "return", order.id, admin, note=f"Return #{r.id}")
        if all(i.returned_quantity >= i.quantity for i in order.items) and order.fulfillment_status == "delivered":
            from app.services.orders import set_status
            set_status(db, order, "fulfillment_status", "returned", note=f"Return #{r.id} received", actor=admin)
    if body.status == "refunded":
        default_amt = sum((items[ri.order_item_id].line_total / items[ri.order_item_id].quantity) * ri.quantity
                          for ri in r.items)
        from decimal import Decimal
        pay_svc.refund_order(db, order, amount=body.refund_amount or Decimal(default_amt).quantize(Decimal("0.01")),
                             reason=f"Return #{r.id}", actor=admin, idempotency_key=f"return-{r.id}", return_id=r.id)
    if body.return_tracking_number:
        r.return_tracking_number = body.return_tracking_number
    r.status = body.status
    r.admin_note = body.admin_note or r.admin_note
    if body.status in ("refunded", "closed", "rejected"):
        r.resolved_at = _now()
    notify(db, "return_update", order.email, {"name": "", "status": body.status.replace("_", " "),
                                              "detail": body.admin_note or "", "order_number": order.order_number},
           order=order, pref="return_updates")
    audit(db, admin, "return.update", "return", r.id, after={"status": body.status}, reason=body.admin_note)
    db.commit()
    return return_out(r)


# ======================================================================= damage claims

@router.get("/claims")
def list_claims(db: Session = Depends(get_db), _: User = Depends(require("support.manage")),
                status: str | None = None):
    stmt = select(DamageClaim, Order.order_number).join(Order, Order.id == DamageClaim.order_id)
    if status:
        stmt = stmt.where(DamageClaim.status == status)
    return [claim_out(c) | {"order_number": n} for c, n in db.execute(stmt.order_by(DamageClaim.id.desc()).limit(200)).all()]


@router.get("/claims/{cid}/evidence/{index}")
def claim_evidence(cid: int, index: int, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(require("support.manage"))):
    c = db.get(DamageClaim, cid)
    if not c or index < 0 or index >= len(c.evidence_keys or []):
        raise NotFound("Evidence not found")
    key = c.evidence_keys[index]
    data = private_storage.read(key)
    audit(db, admin, "claim.evidence_view", "damage_claim", cid, ip=request_ip(request))
    db.commit()
    return Response(data, media_type=mimetypes.guess_type(key)[0] or "application/octet-stream",
                    headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/claims/{cid}")
def decide_claim(cid: int, body: ClaimDecisionIn, db: Session = Depends(get_db),
                 admin: User = Depends(require("support.manage"))):
    c = db.get(DamageClaim, cid)
    if not c:
        raise NotFound("Claim not found")
    if c.status in ("rejected", "resolved"):
        raise BusinessRuleError("This claim is closed.")
    order = db.scalar(select(Order).where(Order.id == c.order_id).with_for_update())
    if body.status == "approved_refund":
        if "payments.refund" not in admin.permission_codes:
            from app.core.errors import Forbidden
            raise Forbidden("Refund permission required")
        amount = body.refund_amount
        if amount is None and c.order_item_id:
            oi = db.get(OrderItem, c.order_item_id)
            amount = oi.line_total if oi else None
        pay_svc.refund_order(db, order, amount=amount, reason=f"Damage claim #{c.id}", actor=admin,
                             idempotency_key=f"claim-{c.id}", damage_claim_id=c.id)
    c.status = body.status
    c.resolution_note = body.resolution_note or c.resolution_note
    if body.status in ("approved_refund", "approved_replacement", "rejected", "resolved"):
        c.resolved_at = _now()
    if body.status == "approved_replacement":
        order.requires_attention = True
        order.attention_reason = (f"Replacement approved for damage claim #{c.id}: create and dispatch a "
                                  "replacement shipment.")
    audit(db, admin, "claim.update", "damage_claim", c.id, after={"status": body.status}, reason=body.resolution_note)
    db.commit()
    return claim_out(c)


# ======================================================================= support tickets

@router.get("/tickets")
def list_tickets(db: Session = Depends(get_db), _: User = Depends(require("support.manage")),
                 status: str | None = None):
    stmt = select(SupportTicket)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    return [ticket_out(t, staff=True) for t in db.scalars(stmt.order_by(SupportTicket.updated_at.desc()).limit(200)).all()]


@router.post("/tickets/{tid}")
def update_ticket(tid: int, body: TicketUpdateIn, db: Session = Depends(get_db),
                  admin: User = Depends(require("support.manage"))):
    t = db.get(SupportTicket, tid)
    if not t:
        raise NotFound("Ticket not found")
    if body.reply:
        t.messages.append(SupportMessage(author_user_id=admin.id, is_staff=True, body=body.reply))
        t.status = "pending_customer"
        t.assigned_to_user_id = t.assigned_to_user_id or admin.id
    if body.status:
        t.status = body.status
    t.updated_at = _now()
    db.commit()
    return ticket_out(t, staff=True)


# ======================================================================= reviews moderation

@router.get("/reviews")
def list_reviews(db: Session = Depends(get_db), _: User = Depends(require("reviews.moderate")),
                 pending: bool = True):
    from app.models import Product
    stmt = select(ProductReview, Product.name).join(Product, Product.id == ProductReview.product_id)
    if pending:
        stmt = stmt.where(ProductReview.is_approved.is_(False))
    rows = db.execute(stmt.order_by(ProductReview.id.desc()).limit(200)).all()
    return [{"id": r.id, "product_name": n, "rating": r.rating, "title": r.title, "body": r.body,
             "display_name": r.display_name, "is_approved": r.is_approved, "created_at": r.created_at.isoformat()}
            for r, n in rows]


@router.post("/reviews/{rid}")
def moderate_review(rid: int, approve: bool, db: Session = Depends(get_db),
                    admin: User = Depends(require("reviews.moderate"))):
    r = db.get(ProductReview, rid)
    if not r:
        raise NotFound("Review not found")
    if approve:
        r.is_approved = True
    else:
        db.delete(r)
    audit(db, admin, "review.approve" if approve else "review.reject", "review", rid)
    db.commit()
    return {"ok": True}
