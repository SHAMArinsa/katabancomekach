from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_customer, request_ip
from app.core.errors import BusinessRuleError, Forbidden, NotFound
from app.core.rate_limit import rate_limit
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models import (Cart, CartItem, ConsentRecord, DamageClaim, Order, OrderItem, Product, ProductReview,
                        ProductVariant, Return, ReturnItem, Shipment, SupportMessage, SupportTicket, UploadMetadata,
                        User, UserAddress, Wishlist, WishlistItem)
from app.schemas.common import (AddressIn, CartItemIn, CartItemUpdate, ChangePasswordIn, CheckoutIn, CouponIn,
                                MessageIn, ProfileIn, QuoteIn, ReturnIn, ReviewIn, TicketIn)
from app.schemas.serializers import (claim_out, order_out, plain, product_card, return_out, ticket_out, user_out)
from app.services import auth as auth_svc
from app.services import inventory
from app.services import orders as order_svc
from app.services import site_settings
from app.services.catalog import is_publicly_visible
from app.services.pricing import CartLineInput, build_quote
from app.services.uploads import read_image

router = APIRouter(prefix="/customer", tags=["customer"])


def _now():
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ profile

@router.get("/profile")
def get_profile(user: User = Depends(get_current_customer)):
    return user_out(user)


@router.patch("/profile")
def update_profile(body: ProfileIn, request: Request, user: User = Depends(get_current_customer),
                   db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "marketing_opt_in" in data and data["marketing_opt_in"] != user.marketing_opt_in:
        db.add(ConsentRecord(user_id=user.id, email=user.email, consent_type="marketing",
                             granted=bool(data["marketing_opt_in"]), ip_address=request_ip(request)))
    for k, v in data.items():
        setattr(user, k, v)
    db.commit()
    return user_out(user)


@router.post("/password", dependencies=[Depends(rate_limit("pwchange", 5, 300))])
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise BusinessRuleError("Current password is incorrect.", code="invalid_credentials")
    auth_svc.validate_password(db, body.new_password)
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


@router.post("/delete-request")
def request_deletion(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    user.deletion_requested_at = user.deletion_requested_at or _now()
    db.commit()
    return {"ok": True, "message": "Your deletion request has been received. We will confirm by email once processed. "
                                   "Order records required by law are retained in anonymised form."}


# ------------------------------------------------------------------ addresses

def _addr_dict(a: UserAddress) -> dict:
    return {"id": a.id, "label": a.label, "full_name": a.full_name, "phone": a.phone, "line1": a.line1,
            "line2": a.line2, "city": a.city, "state": a.state, "postal_code": a.postal_code,
            "country_code": a.country_code, "is_default": a.is_default}


@router.get("/addresses")
def list_addresses(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    rows = db.scalars(select(UserAddress).where(UserAddress.user_id == user.id)
                      .order_by(UserAddress.is_default.desc(), UserAddress.id)).all()
    return [_addr_dict(a) for a in rows]


def _own_address(db: Session, user: User, address_id: int) -> UserAddress:
    a = db.scalar(select(UserAddress).where(UserAddress.id == address_id, UserAddress.user_id == user.id))
    if not a:
        raise NotFound("Address not found")
    return a


def _clear_default(db: Session, user: User):
    for a in db.scalars(select(UserAddress).where(UserAddress.user_id == user.id)).all():
        a.is_default = False


@router.post("/addresses", status_code=201)
def add_address(body: AddressIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(UserAddress).where(UserAddress.user_id == user.id)) or 0
    if count >= 20:
        raise BusinessRuleError("You can save up to 20 addresses.")
    if body.is_default or count == 0:
        _clear_default(db, user)
    a = UserAddress(user_id=user.id, **body.model_dump())
    a.is_default = body.is_default or count == 0
    db.add(a)
    db.commit()
    return _addr_dict(a)


@router.put("/addresses/{address_id}")
def update_address(address_id: int, body: AddressIn, user: User = Depends(get_current_customer),
                   db: Session = Depends(get_db)):
    a = _own_address(db, user, address_id)
    if body.is_default:
        _clear_default(db, user)
    for k, v in body.model_dump().items():
        setattr(a, k, v)
    db.commit()
    return _addr_dict(a)


@router.delete("/addresses/{address_id}")
def delete_address(address_id: int, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    db.delete(_own_address(db, user, address_id))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ cart

def _cart(db: Session, user: User) -> Cart:
    cart = db.scalar(select(Cart).where(Cart.user_id == user.id))
    if not cart:
        cart = Cart(user_id=user.id)
        db.add(cart)
        db.flush()
    return cart


def _cart_response(db: Session, user: User, cart: Cart, country: str | None = None, postal: str | None = None,
                   currency: str = "INR") -> dict:
    quote = build_quote(db, [CartLineInput(i.variant_id, i.quantity, i.gift_wrap) for i in cart.items],
                        country=country, postal_code=postal, coupon_code=cart.coupon_code, user=user,
                        display_currency=currency)
    item_ids = {(i.variant_id, i.gift_wrap): i.id for i in cart.items}
    out = plain(quote.to_dict())
    for ln in out["lines"]:
        ln["cart_item_id"] = item_ids.get((ln["variant_id"], ln["gift_wrap"]))
    out["coupon_code"] = cart.coupon_code
    return out


@router.get("/cart")
def get_cart(country: str | None = Query(None, max_length=2), postal_code: str | None = Query(None, max_length=20),
             currency: str = Query("INR", max_length=3), user: User = Depends(get_current_customer),
             db: Session = Depends(get_db)):
    cart = _cart(db, user)
    db.commit()
    return _cart_response(db, user, cart, country, postal_code, currency)


def _validate_variant(db: Session, variant_id: int) -> ProductVariant:
    v = db.get(ProductVariant, variant_id)
    if not v or not v.is_active or not is_publicly_visible(v.product):
        raise BusinessRuleError("This product is not available.", code="not_purchasable")
    return v


@router.post("/cart/items", status_code=201)
def add_to_cart(body: CartItemIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    v = _validate_variant(db, body.variant_id)
    cart = _cart(db, user)
    existing = next((i for i in cart.items if i.variant_id == v.id and i.gift_wrap == body.gift_wrap), None)
    new_qty = (existing.quantity if existing else 0) + body.quantity
    avail = v.inventory.available if v.inventory else 0
    if avail <= 0:
        raise BusinessRuleError("This item is out of stock.", code="out_of_stock")
    if new_qty > avail:
        raise BusinessRuleError(f"Only {avail} available.", code="insufficient_stock")
    if existing:
        existing.quantity = new_qty
    else:
        cart.items.append(CartItem(variant_id=v.id, quantity=body.quantity, gift_wrap=body.gift_wrap))
    db.commit()
    return _cart_response(db, user, cart)


@router.patch("/cart/items/{item_id}")
def update_cart_item(item_id: int, body: CartItemUpdate, user: User = Depends(get_current_customer),
                     db: Session = Depends(get_db)):
    cart = _cart(db, user)
    item = next((i for i in cart.items if i.id == item_id), None)
    if not item:
        raise NotFound("Item not in bag")
    if body.quantity == 0:
        cart.items.remove(item)
    else:
        avail = item.variant.inventory.available if item.variant.inventory else 0
        if body.quantity > avail:
            raise BusinessRuleError(f"Only {avail} available.", code="insufficient_stock")
        item.quantity = body.quantity
    db.commit()
    return _cart_response(db, user, cart)


@router.delete("/cart/items/{item_id}")
def remove_cart_item(item_id: int, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    cart = _cart(db, user)
    item = next((i for i in cart.items if i.id == item_id), None)
    if item:
        cart.items.remove(item)
        db.commit()
    return _cart_response(db, user, cart)


@router.put("/cart/coupon")
def set_coupon(body: CouponIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    cart = _cart(db, user)
    cart.coupon_code = body.code.strip().upper() if body.code else None
    db.commit()
    return _cart_response(db, user, cart)


@router.post("/cart/merge")
def merge_cart(items: list[CartItemIn], user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    """Merge a guest bag (kept in the browser) into the account bag after login."""
    cart = _cart(db, user)
    for it in items[:50]:
        v = db.get(ProductVariant, it.variant_id)
        if not v or not v.is_active or not is_publicly_visible(v.product):
            continue
        avail = v.inventory.available if v.inventory else 0
        existing = next((i for i in cart.items if i.variant_id == v.id and i.gift_wrap == it.gift_wrap), None)
        qty = min(avail, max(it.quantity, existing.quantity if existing else 0))
        if qty <= 0:
            continue
        if existing:
            existing.quantity = qty
        else:
            cart.items.append(CartItem(variant_id=v.id, quantity=qty, gift_wrap=it.gift_wrap))
    db.commit()
    return _cart_response(db, user, cart)


# ------------------------------------------------------------------ wishlist

@router.get("/wishlist")
def get_wishlist(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    wl = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id))
    if not wl:
        return []
    ids = [i.product_id for i in wl.items]
    prods = db.scalars(select(Product).where(Product.id.in_(ids))).unique().all() if ids else []
    return [product_card(p) for p in prods if is_publicly_visible(p)]


@router.post("/wishlist/{product_id}", status_code=201)
def add_wishlist(product_id: int, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p or not is_publicly_visible(p):
        raise NotFound("Product not found")
    wl = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id))
    if not wl:
        wl = Wishlist(user_id=user.id)
        db.add(wl)
        db.flush()
    if not any(i.product_id == product_id for i in wl.items):
        wl.items.append(WishlistItem(product_id=product_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"ok": True}


@router.delete("/wishlist/{product_id}")
def remove_wishlist(product_id: int, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    wl = db.scalar(select(Wishlist).where(Wishlist.user_id == user.id))
    if wl:
        for i in list(wl.items):
            if i.product_id == product_id:
                wl.items.remove(i)
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ checkout

@router.post("/checkout/quote")
def checkout_quote(body: QuoteIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    cart = _cart(db, user)
    if body.coupon_code is not None:
        cart.coupon_code = body.coupon_code.strip().upper() or None
    db.commit()
    return _cart_response(db, user, cart, body.country_code, body.postal_code, body.display_currency)


@router.post("/checkout/orders", status_code=201, dependencies=[Depends(rate_limit("checkout", 10, 60))])
def place_order(body: CheckoutIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    acc = site_settings.account(db)
    store = site_settings.store(db)
    if store.maintenance_mode or store.store_status != "open":
        raise BusinessRuleError("The store is not accepting orders right now.", code="store_closed")
    if acc.require_email_verification and not user.email_verified_at:
        raise Forbidden("Please verify your email address before placing an order.", code="email_unverified")
    if not body.accept_shipping_terms:
        raise BusinessRuleError("Please confirm you have read the delivery and shipping-fee terms.",
                                code="terms_required")
    inventory.sweep_expired(db)
    if body.address_id:
        a = _own_address(db, user, body.address_id)
        address = {k: getattr(a, k) for k in ("full_name", "phone", "line1", "line2", "city", "state",
                                              "postal_code", "country_code")}
    elif body.address:
        address = body.address.model_dump(exclude={"label", "is_default"})
    else:
        raise BusinessRuleError("A delivery address is required.")
    cart = _cart(db, user)
    coupon = body.coupon_code if body.coupon_code is not None else cart.coupon_code
    quote = build_quote(db, [CartLineInput(i.variant_id, i.quantity, i.gift_wrap) for i in cart.items],
                        country=address["country_code"], postal_code=address["postal_code"],
                        coupon_code=coupon, user=user, display_currency=body.display_currency)
    if quote.coupon and not quote.coupon["valid"]:
        raise BusinessRuleError(quote.coupon["message"] or "Coupon is not valid.", code="invalid_coupon")
    if quote.destination["is_international"] and not body.accept_customs_terms:
        raise BusinessRuleError("Please acknowledge that import duties and taxes may be payable on delivery.",
                                code="customs_terms_required")
    if not quote.can_checkout:
        raise BusinessRuleError("Your order cannot be placed yet.", code="checkout_blocked",
                                details=quote.blocking_issues)
    pay = site_settings.payment(db)
    order = order_svc.create_order(db, user, quote, address, note=body.note, coupon_code=coupon,
                                   is_test=pay.provider == "mock" or pay.mode == "test")
    cart.items.clear()
    cart.coupon_code = None
    db.commit()
    return order_out(order)


# ------------------------------------------------------------------ orders

@router.get("/orders")
def my_orders(page: int = Query(1, ge=1), user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    base = select(Order).where(Order.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(Order.created_at.desc()).offset((page - 1) * 20).limit(20)).all()
    return {"items": [order_out(o) for o in rows], "total": total, "page": page, "pages": (total + 19) // 20}


@router.get("/orders/{order_number}")
def my_order(order_number: str, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    o = order_svc.order_for_customer(db, user, order_number)
    ships = db.scalars(select(Shipment).where(Shipment.order_id == o.id).order_by(Shipment.id)).all()
    out = order_out(o, ships)
    acc = site_settings.account(db)
    now = _now()
    out["can_cancel"] = o.fulfillment_status in ("unfulfilled", "processing")
    out["can_pay"] = o.payment_status in ("pending", "failed") and o.fulfillment_status != "cancelled"
    out["can_return"] = bool(o.fulfillment_status == "delivered" and o.delivered_at
                             and now <= o.delivered_at + timedelta(days=acc.return_window_days))
    out["can_claim"] = bool((o.fulfillment_status == "delivered" and o.delivered_at
                             and now <= o.delivered_at + timedelta(hours=acc.damage_claim_window_hours))
                            or o.fulfillment_status == "dispatched")
    out["returns"] = [return_out(r) for r in db.scalars(select(Return).where(Return.order_id == o.id)).all()]
    out["claims"] = [claim_out(c) for c in db.scalars(select(DamageClaim).where(DamageClaim.order_id == o.id)).all()]
    return out


@router.post("/orders/{order_number}/cancel")
def cancel_my_order(order_number: str, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    o = order_svc.order_for_customer(db, user, order_number)
    o = db.scalar(select(Order).where(Order.id == o.id).with_for_update().execution_options(populate_existing=True))
    order_svc.cancel_order(db, o, reason="Cancelled by customer", by_customer=True)
    db.commit()
    return order_out(o)


# ------------------------------------------------------------------ returns

@router.post("/orders/{order_number}/returns", status_code=201)
def request_return(order_number: str, body: ReturnIn, user: User = Depends(get_current_customer),
                   db: Session = Depends(get_db)):
    o = order_svc.order_for_customer(db, user, order_number)
    acc = site_settings.account(db)
    if o.fulfillment_status != "delivered" or not o.delivered_at:
        raise BusinessRuleError("Returns can be requested after delivery.")
    if _now() > o.delivered_at + timedelta(days=acc.return_window_days):
        raise BusinessRuleError(f"The {acc.return_window_days}-day return window has closed.")
    items_by_id = {i.id: i for i in o.items}
    open_returns = db.scalars(select(Return).where(Return.order_id == o.id,
                                                   Return.status.in_(("requested", "approved", "received")))).all()
    pending = {}
    for r in open_returns:
        for ri in r.items:
            pending[ri.order_item_id] = pending.get(ri.order_item_id, 0) + ri.quantity
    ret = Return(order_id=o.id, user_id=user.id, reason=body.reason, status="requested")
    for it in body.items:
        oi = items_by_id.get(it.order_item_id)
        if not oi:
            raise BusinessRuleError("Item does not belong to this order.")
        if it.quantity > oi.quantity - oi.returned_quantity - pending.get(oi.id, 0):
            raise BusinessRuleError(f"Return quantity for {oi.product_name} exceeds eligible quantity.")
        ret.items.append(ReturnItem(order_item_id=oi.id, quantity=it.quantity))
    db.add(ret)
    db.commit()
    return return_out(ret)


# ------------------------------------------------------------------ damage / lost claims

@router.post("/orders/{order_number}/claims", status_code=201, dependencies=[Depends(rate_limit("claims", 5, 300))])
def submit_claim(order_number: str, description: str = Form(min_length=10, max_length=4000),
                 claim_type: str = Form("damaged", pattern="^(damaged|lost|wrong_item)$"),
                 order_item_id: int | None = Form(None), files: list[UploadFile] = File(default=[]),
                 user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    from app.integrations.storage import private_storage
    o = order_svc.order_for_customer(db, user, order_number)
    acc = site_settings.account(db)
    if claim_type == "lost":
        if o.fulfillment_status != "dispatched":
            raise BusinessRuleError("Lost-parcel reports apply to dispatched orders that have not been delivered.")
    else:
        if o.fulfillment_status != "delivered" or not o.delivered_at:
            raise BusinessRuleError("Damage reports can be submitted after delivery.")
        if _now() > o.delivered_at + timedelta(hours=acc.damage_claim_window_hours):
            raise BusinessRuleError(f"Damage must be reported within {acc.damage_claim_window_hours} hours of delivery.")
        if not files:
            raise BusinessRuleError("Please attach at least one photo of the damage and packaging.")
    if order_item_id and order_item_id not in {i.id for i in o.items}:
        raise BusinessRuleError("Item does not belong to this order.")
    if len(files) > 6:
        raise BusinessRuleError("Attach up to 6 photos.")
    keys = []
    for f in files:
        data, ctype, ext = read_image(f, max_mb=8)
        key = private_storage.save(data, f"claims/{o.order_number}", ext)
        keys.append(key)
        db.add(UploadMetadata(storage_provider="private_local", storage_key=key, content_type=ctype,
                              size_bytes=len(data), visibility="private", purpose="damage_evidence",
                              owner_user_id=user.id, original_filename=(f.filename or "")[:255]))
    claim = DamageClaim(order_id=o.id, user_id=user.id, order_item_id=order_item_id, claim_type=claim_type,
                        description=description, evidence_keys=keys, status="submitted")
    db.add(claim)
    db.commit()
    return claim_out(claim)


@router.get("/claims")
def my_claims(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    rows = db.scalars(select(DamageClaim).where(DamageClaim.user_id == user.id).order_by(DamageClaim.id.desc())).all()
    orders = {o.id: o.order_number for o in db.scalars(select(Order).where(Order.id.in_([c.order_id for c in rows]))).all()} if rows else {}
    return [claim_out(c) | {"order_number": orders.get(c.order_id)} for c in rows]


@router.get("/returns")
def my_returns(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    rows = db.scalars(select(Return).where(Return.user_id == user.id).order_by(Return.id.desc())).all()
    orders = {o.id: o.order_number for o in db.scalars(select(Order).where(Order.id.in_([r.order_id for r in rows]))).all()} if rows else {}
    return [return_out(r) | {"order_number": orders.get(r.order_id)} for r in rows]


# ------------------------------------------------------------------ support

@router.get("/tickets")
def my_tickets(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    rows = db.scalars(select(SupportTicket).where(SupportTicket.user_id == user.id)
                      .order_by(SupportTicket.updated_at.desc())).all()
    return [ticket_out(t) for t in rows]


@router.post("/tickets", status_code=201, dependencies=[Depends(rate_limit("tickets", 5, 300))])
def open_ticket(body: TicketIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    if body.order_number:
        order_svc.order_for_customer(db, user, body.order_number)
    t = SupportTicket(user_id=user.id, email=user.email, name=user.full_name, subject=body.subject,
                      order_number=body.order_number, status="open")
    t.messages.append(SupportMessage(author_user_id=user.id, is_staff=False, body=body.message))
    db.add(t)
    db.commit()
    return ticket_out(t)


@router.post("/tickets/{ticket_id}/messages", status_code=201)
def reply_ticket(ticket_id: int, body: MessageIn, user: User = Depends(get_current_customer),
                 db: Session = Depends(get_db)):
    t = db.scalar(select(SupportTicket).where(SupportTicket.id == ticket_id, SupportTicket.user_id == user.id))
    if not t:
        raise NotFound("Ticket not found")
    if t.status == "closed":
        raise BusinessRuleError("This conversation is closed. Please open a new request.")
    t.messages.append(SupportMessage(author_user_id=user.id, is_staff=False, body=body.body))
    t.status = "open"
    db.commit()
    return ticket_out(t)


# ------------------------------------------------------------------ reviews (verified purchasers only)

@router.post("/reviews", status_code=201)
def write_review(body: ReviewIn, user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    o = order_svc.order_for_customer(db, user, body.order_number)
    if o.fulfillment_status != "delivered":
        raise BusinessRuleError("You can review items after they are delivered.")
    if not db.scalar(select(OrderItem).where(OrderItem.order_id == o.id, OrderItem.product_id == body.product_id)):
        raise BusinessRuleError("This product is not part of the order.")
    r = ProductReview(product_id=body.product_id, user_id=user.id, order_id=o.id, rating=body.rating,
                      title=body.title, body=body.body, display_name=body.display_name or user.full_name.split(" ")[0],
                      is_approved=False)
    db.add(r)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise BusinessRuleError("You have already reviewed this item for this order.")
    return {"ok": True, "message": "Thank you. Your review will appear once it has been checked."}
