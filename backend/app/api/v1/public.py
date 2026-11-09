from datetime import datetime, timezone
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_optional_customer, request_ip
from app.core.errors import NotFound
from app.core.rate_limit import rate_limit
from app.db.session import get_db
from app.models import (Category, CmsPage, Collection, ConsentRecord, ContentBlock, Currency, DestinationEligibility,
                        ExchangeRate, NewsletterSubscriber, Order, Product, ProductCollection, ProductReview,
                        Shipment, SupportMessage, SupportTicket, User)
from app.schemas.common import ConsentIn, NewsletterIn, TicketIn
from app.schemas.serializers import category_out, product_card, product_detail, shipment_out
from app.services import site_settings
from app.services.catalog import category_visible, is_publicly_visible, on_sale_clause, public_products_query

router = APIRouter(prefix="/public", tags=["public"])


def _now():
    return datetime.now(timezone.utc)


def _active_window(model):
    t = _now()
    return and_(or_(model.starts_at.is_(None), model.starts_at <= t), or_(model.ends_at.is_(None), model.ends_at >= t))


def _demo_accounts(db: Session) -> dict | None:
    """Expose demo logins on the sign-in pages — development only, and only if they exist."""
    if settings.APP_ENV != "development":
        return None
    from app.core.demo import DEMO_ADMIN, DEMO_CUSTOMER
    emails = set(db.scalars(select(User.email).where(User.email.in_([DEMO_ADMIN[0], DEMO_CUSTOMER[0]]))).all())
    if not emails:
        return None
    return {"admin": {"email": DEMO_ADMIN[0], "password": DEMO_ADMIN[1]} if DEMO_ADMIN[0] in emails else None,
            "customer": {"email": DEMO_CUSTOMER[0], "password": DEMO_CUSTOMER[1]} if DEMO_CUSTOMER[0] in emails else None}


@router.get("/settings")
def public_settings(db: Session = Depends(get_db)):
    """Non-secret, customer-facing configuration (brand, thresholds, policies summary)."""
    store = site_settings.store(db)
    ship = site_settings.shipping(db)
    pricing = site_settings.pricing(db)
    pay = site_settings.payment(db)
    acc = site_settings.account(db)
    content = site_settings.content(db)
    priv = site_settings.get_section(db, "privacy")
    return {
        "store": store.model_dump(mode="json"),
        "shipping": {"domestic_country": ship.domestic_country,
                     "domestic_free_threshold": f"{ship.domestic_free_threshold:.2f}",
                     "international_free_threshold": f"{ship.international_free_threshold:.2f}",
                     "threshold_basis": ship.threshold_basis, "international_enabled": ship.international_enabled,
                     "recipient_paid_note": ship.recipient_paid_note, "customs_disclosure": ship.customs_disclosure,
                     "insurance_available": ship.insurance_available, "insurance_note": ship.insurance_note},
        "pricing": {"base_currency": "INR", "display_currencies": pricing.display_currencies,
                    "prices_include_tax": pricing.prices_include_tax,
                    "show_compare_at_price": pricing.show_compare_at_price},
        "payment": {"methods": pay.enabled_methods, "provider": pay.provider, "mode": pay.mode,
                    "cod_available": False, "instructions": pay.payment_instructions,
                    "failure_message": pay.failure_message},
        "account": {"registration_enabled": acc.registration_enabled,
                    "require_email_verification": acc.require_email_verification,
                    "password_min_length": acc.password_min_length,
                    "password_require_mixed": acc.password_require_mixed,
                    "return_window_days": acc.return_window_days,
                    "damage_claim_window_hours": acc.damage_claim_window_hours,
                    "support_email": acc.support_email, "support_phone": acc.support_phone},
        "content": content.model_dump(mode="json"),
        "privacy": {"cookie_banner_enabled": priv.cookie_banner_enabled,  # type: ignore[attr-defined]
                    "analytics_enabled": priv.analytics_enabled,  # type: ignore[attr-defined]
                    "analytics_provider": priv.analytics_provider,  # type: ignore[attr-defined]
                    "analytics_site_id": priv.analytics_site_id},  # type: ignore[attr-defined]
        "environment": {"payments_test_mode": pay.mode != "live", "app_env": settings.APP_ENV,
                        "demo_accounts": _demo_accounts(db)},
    }


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    roots = db.scalars(select(Category).where(Category.parent_id.is_(None), Category.status == "published")
                       .order_by(Category.position, Category.name)).all()
    return [category_out(c, with_children=True) for c in roots]


@router.get("/categories/{slug}")
def category(slug: str, db: Session = Depends(get_db)):
    c = db.scalar(select(Category).where(Category.slug == slug))
    if not c or not category_visible(c):
        raise NotFound("Category not found")
    out = category_out(c, with_children=True)
    out["parent"] = category_out(c.parent) if c.parent else None
    return out


@router.get("/collections")
def collections(kind: str | None = None, db: Session = Depends(get_db)):
    q = select(Collection).where(Collection.is_visible.is_(True), _active_window(Collection))
    if kind:
        q = q.where(Collection.kind == kind)
    rows = db.scalars(q.order_by(Collection.position, Collection.name)).all()
    return [{"id": c.id, "name": c.name, "slug": c.slug, "kind": c.kind, "description": c.description,
             "image_url": c.image_url} for c in rows]


@router.get("/collections/{slug}")
def collection(slug: str, db: Session = Depends(get_db)):
    c = db.scalar(select(Collection).where(Collection.slug == slug, Collection.is_visible.is_(True),
                                           _active_window(Collection)))
    if not c:
        raise NotFound("Collection not found")
    return {"id": c.id, "name": c.name, "slug": c.slug, "kind": c.kind, "description": c.description,
            "image_url": c.image_url}


def _descendant_ids(db: Session, root: Category) -> list[int]:
    ids, frontier = [root.id], [root]
    while frontier:
        nxt = []
        for c in frontier:
            kids = [k for k in c.children if k.status == "published"]
            ids += [k.id for k in kids]
            nxt += kids
        frontier = nxt
    return ids


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/products")
def products(db: Session = Depends(get_db), q: str | None = Query(None, max_length=100),
             category: str | None = None, collection: str | None = None,
             collection_kind: str | None = Query(None, pattern="^(featured|gift|seasonal|designer|premium)$"),
             glass_type: str | None = None, color: str | None = None,
             min_price: float | None = Query(None, ge=0), max_price: float | None = Query(None, ge=0),
             on_sale: bool = False, new: bool = False, bestseller: bool = False, featured: bool = False,
             in_stock: bool = False, sort: str = Query("featured", pattern="^(featured|newest|price_asc|price_desc|name)$"),
             page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=60)):
    effective = case((on_sale_clause(), Product.sale_price), else_=Product.price)
    stmt = public_products_query()
    if q:
        terms = [t for t in q.split() if t][:6]
        for t in terms:
            pat = _like(t)
            stmt = stmt.where(or_(Product.name.ilike(pat, escape="\\"), Product.sku.ilike(pat, escape="\\"),
                                  Product.search_keywords.ilike(pat, escape="\\"),
                                  Product.glass_type.ilike(pat, escape="\\"),
                                  Product.short_description.ilike(pat, escape="\\"),
                                  Category.name.ilike(pat, escape="\\")))
    if category:
        cat = db.scalar(select(Category).where(Category.slug == category))
        if not cat or not category_visible(cat):
            raise NotFound("Category not found")
        stmt = stmt.where(Product.category_id.in_(_descendant_ids(db, cat)))
    if collection:
        stmt = stmt.where(Product.id.in_(select(ProductCollection.product_id).join(
            Collection, Collection.id == ProductCollection.collection_id).where(Collection.slug == collection)))
    if collection_kind:
        stmt = stmt.where(Product.id.in_(select(ProductCollection.product_id).join(
            Collection, Collection.id == ProductCollection.collection_id).where(
            Collection.kind == collection_kind, Collection.is_visible.is_(True), _active_window(Collection))))
    if glass_type:
        stmt = stmt.where(Product.glass_type.ilike(glass_type))
    if color:
        stmt = stmt.where(Product.color.ilike(color))
    if min_price is not None:
        stmt = stmt.where(effective >= min_price)
    if max_price is not None:
        stmt = stmt.where(effective <= max_price)
    if on_sale:
        stmt = stmt.where(or_(on_sale_clause(), Product.compare_at_price > Product.price))
    if new:
        stmt = stmt.where(Product.is_new_arrival.is_(True))
    if bestseller:
        stmt = stmt.where(Product.is_bestseller.is_(True))
    if featured:
        stmt = stmt.where(Product.is_featured.is_(True))
    if in_stock:
        from app.models import Inventory, ProductVariant
        stmt = stmt.where(Product.id.in_(select(ProductVariant.product_id).join(
            Inventory, Inventory.variant_id == ProductVariant.id).where(
            ProductVariant.is_active.is_(True), Inventory.on_hand - Inventory.reserved > 0)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = {"featured": [Product.is_featured.desc(), Product.is_bestseller.desc(), Product.published_at.desc()],
             "newest": [Product.published_at.desc().nulls_last(), Product.id.desc()],
             "price_asc": [effective.asc()], "price_desc": [effective.desc()], "name": [Product.name.asc()]}[sort]
    rows = db.scalars(stmt.order_by(*order, Product.id).offset((page - 1) * page_size).limit(page_size)).unique().all()
    facets_q = public_products_query().with_only_columns(Product.glass_type, Product.color).distinct()
    facets = db.execute(facets_q).all()
    return {"items": [product_card(p) for p in rows], "total": total, "page": page, "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
            "facets": {"glass_types": sorted({f[0] for f in facets if f[0]}),
                       "colors": sorted({f[1] for f in facets if f[1]})}}


@router.get("/products/{slug}")
def product(slug: str, db: Session = Depends(get_db)):
    p = db.scalar(select(Product).where(Product.slug == slug))
    if not p or not is_publicly_visible(p):
        raise NotFound("Product not found")
    out = product_detail(p)
    related_q = public_products_query().where(Product.id != p.id)
    if p.category_id:
        related_q = related_q.where(Product.category_id == p.category_id)
    related = db.scalars(related_q.order_by(Product.is_bestseller.desc(), Product.id.desc()).limit(4)).unique().all()
    out["related"] = [product_card(r) for r in related]
    reviews = db.scalars(select(ProductReview).where(ProductReview.product_id == p.id,
                                                     ProductReview.is_approved.is_(True))
                         .order_by(ProductReview.created_at.desc()).limit(20)).all()
    out["reviews"] = [{"rating": r.rating, "title": r.title, "body": r.body,
                       "display_name": r.display_name or "Verified buyer", "verified_purchase": True,
                       "created_at": r.created_at.isoformat()} for r in reviews]
    out["rating"] = ({"average": round(sum(r.rating for r in reviews) / len(reviews), 1), "count": len(reviews)}
                     if reviews else None)
    if p.category:
        out["breadcrumbs"] = ([{"name": p.category.parent.name, "slug": p.category.parent.slug}]
                              if p.category.parent else []) + [{"name": p.category.name, "slug": p.category.slug}]
    return out


@router.get("/home")
def home(db: Session = Depends(get_db)):
    blocks = db.scalars(select(ContentBlock).where(ContentBlock.is_visible.is_(True), _active_window(ContentBlock))
                        .order_by(ContentBlock.placement, ContentBlock.position)).all()
    by_place: dict[str, list] = {}
    for b in blocks:
        by_place.setdefault(b.placement, []).append(
            {"id": b.id, "title": b.title, "subtitle": b.subtitle, "body": b.body, "image_url": b.image_url,
             "link_url": b.link_url, "link_label": b.link_label, "data": b.data})

    def pick(flag, limit=8):
        return [product_card(p) for p in db.scalars(public_products_query().where(flag.is_(True))
                                                    .order_by(Product.published_at.desc().nulls_last())
                                                    .limit(limit)).unique().all()]
    cats = db.scalars(select(Category).where(Category.parent_id.is_(None), Category.status == "published")
                      .order_by(Category.position).limit(8)).all()
    cols = db.scalars(select(Collection).where(Collection.is_visible.is_(True), _active_window(Collection))
                      .order_by(Collection.position).limit(6)).all()
    reviews = db.scalars(select(ProductReview).where(ProductReview.is_approved.is_(True), ProductReview.rating >= 4)
                         .order_by(ProductReview.created_at.desc()).limit(6)).all()
    content = site_settings.content(db)
    return {
        "sections": [s for s in content.home_sections if s not in content.hidden_home_sections],
        "blocks": by_place,
        "featured_categories": [category_out(c) for c in cats],
        "new_arrivals": pick(Product.is_new_arrival),
        "bestsellers": pick(Product.is_bestseller),
        "featured": pick(Product.is_featured),
        "collections": [{"name": c.name, "slug": c.slug, "kind": c.kind, "description": c.description,
                         "image_url": c.image_url} for c in cols],
        "reviews": [{"rating": r.rating, "title": r.title, "body": r.body,
                     "display_name": r.display_name or "Verified buyer"} for r in reviews],
    }


@router.get("/pages/{slug}")
def page(slug: str, db: Session = Depends(get_db)):
    p = db.scalar(select(CmsPage).where(CmsPage.slug == slug, CmsPage.is_published.is_(True)))
    if not p:
        raise NotFound("Page not found")
    return {"slug": p.slug, "title": p.title, "body": p.body, "seo_title": p.seo_title or p.title,
            "seo_description": p.seo_description, "updated_at": p.updated_at.isoformat()}


@router.get("/faqs")
def faqs(db: Session = Depends(get_db)):
    rows = db.scalars(select(ContentBlock).where(ContentBlock.placement == "faq", ContentBlock.is_visible.is_(True))
                      .order_by(ContentBlock.position)).all()
    return [{"id": r.id, "question": r.title, "answer": r.body, "group": r.data.get("group", "General")} for r in rows]


@router.get("/destinations")
def destinations(db: Session = Depends(get_db)):
    rows = db.scalars(select(DestinationEligibility).order_by(DestinationEligibility.country_name)).all()
    return [{"country_code": r.country_code, "country_name": r.country_name, "enabled": r.is_enabled,
             "postal_code_regex": r.postal_code_regex, "allows_fragile": r.allows_fragile,
             "reason": r.restriction_reason if not r.is_enabled else None} for r in rows]


@router.get("/currencies")
def currencies(db: Session = Depends(get_db)):
    out = []
    for c in db.scalars(select(Currency).where(Currency.is_enabled.is_(True)).order_by(Currency.code)).all():
        rate = db.scalar(select(ExchangeRate).where(ExchangeRate.quote_currency == c.code)
                         .order_by(ExchangeRate.effective_at.desc()).limit(1))
        if c.is_base or rate:
            out.append({"code": c.code, "symbol": c.symbol, "name": c.name, "decimals": c.decimals,
                        "rate": "1" if c.is_base else str(rate.rate),
                        "as_of": None if c.is_base else rate.effective_at.isoformat()})
    return out


@router.get("/track", dependencies=[Depends(rate_limit("track", 20, 60))])
def track(order_number: str = Query(max_length=24), email: str = Query(max_length=255), db: Session = Depends(get_db)):
    """Guest-safe tracking: requires order number + email, returns no address/PII."""
    o = db.scalar(select(Order).where(Order.order_number == order_number.strip().upper()))
    if not o or o.email.lower() != email.strip().lower():
        raise NotFound("We could not find an order with those details.")
    ships = db.scalars(select(Shipment).where(Shipment.order_id == o.id).order_by(Shipment.id)).all()
    return {"order_number": o.order_number, "created_at": o.created_at.isoformat(),
            "payment_status": o.payment_status, "fulfillment_status": o.fulfillment_status,
            "shipping_fee_status": o.shipping_fee_status, "free_delivery": o.free_delivery,
            "destination_country": o.destination_country,
            "shipments": [shipment_out(s) | {"customs_data": None} for s in ships]}


@router.post("/newsletter", dependencies=[Depends(rate_limit("newsletter", 5, 60))])
def newsletter(body: NewsletterIn, request: Request, db: Session = Depends(get_db)):
    if not body.consent:
        from app.core.errors import BusinessRuleError
        raise BusinessRuleError("Please confirm you would like to receive emails.")
    sub = db.scalar(select(NewsletterSubscriber).where(NewsletterSubscriber.email == body.email.lower()))
    if sub:
        sub.is_active = True
    else:
        db.add(NewsletterSubscriber(email=body.email.lower()))
    db.add(ConsentRecord(email=body.email.lower(), consent_type="marketing", granted=True,
                         ip_address=request_ip(request)))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"ok": True}


@router.post("/consent")
def consent(body: ConsentIn, request: Request, user: User | None = Depends(get_optional_customer),
            db: Session = Depends(get_db)):
    db.add(ConsentRecord(user_id=user.id if user else None, consent_type="cookies", granted=True,
                         details=body.model_dump(), ip_address=request_ip(request)))
    db.commit()
    return {"ok": True}


@router.post("/contact", status_code=201, dependencies=[Depends(rate_limit("contact", 5, 300))])
def contact(body: TicketIn, user: User | None = Depends(get_optional_customer), db: Session = Depends(get_db)):
    from app.core.errors import BusinessRuleError
    email = user.email if user else body.email
    if not email:
        raise BusinessRuleError("Email is required.")
    t = SupportTicket(user_id=user.id if user else None, email=email, name=body.name or (user.full_name if user else ""),
                      subject=body.subject, order_number=body.order_number, status="open")
    t.messages.append(SupportMessage(author_user_id=user.id if user else None, is_staff=False, body=body.message))
    db.add(t)
    db.commit()
    return {"ok": True, "ticket_id": t.id}


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap(db: Session = Depends(get_db)):
    base = settings.FRONTEND_URL.rstrip("/")
    urls = [f"{base}/", f"{base}/shop", f"{base}/new-arrivals", f"{base}/bestsellers", f"{base}/sale",
            f"{base}/gifts", f"{base}/collections", f"{base}/about", f"{base}/contact", f"{base}/faq"]
    for c in db.scalars(select(Category).where(Category.status == "published")).all():
        if category_visible(c):
            urls.append(f"{base}/categories/{c.slug}")
    for p in db.scalars(public_products_query()).unique().all():
        urls.append(f"{base}/products/{p.slug}")
    for pg in db.scalars(select(CmsPage).where(CmsPage.is_published.is_(True))).all():
        urls.append(f"{base}/{pg.slug}")
    body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    body += "".join(f"  <url><loc>{escape(u)}</loc></url>\n" for u in dict.fromkeys(urls))
    body += "</urlset>\n"
    return Response(body, media_type="application/xml")
