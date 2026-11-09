"""Business settings, shipping configuration, currencies, tax, coupons and website content."""
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings as env
from app.core.deps import get_current_admin, request_ip, require
from app.core.errors import BusinessRuleError, Conflict, Forbidden, NotFound
from app.db.session import get_db
from app.models import (CmsPage, ContentBlock, Coupon, CouponRedemption, Currency, DestinationEligibility,
                        EmailTemplate, ExchangeRate, ShippingProvider, ShippingRate, ShippingZone, SiteSetting,
                        TaxRule, User)
from app.schemas.admin import (CmsPageIn, ContentBlockIn, CouponIn, CurrencyIn, DestinationIn, EmailTemplateIn,
                               ExchangeRateIn, ShippingProviderIn, TaxRuleIn, ZoneIn)
from app.schemas.serializers import m
from app.schemas.settings import PAYMENT_SECTIONS, SECTIONS
from app.services import site_settings
from app.services.audit import audit
from app.services.notifications import DEFAULT_TEMPLATES

router = APIRouter(tags=["admin-config"])


def _now():
    return datetime.now(timezone.utc)


# ======================================================================= business settings

@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    out = {}
    for name in SECTIONS:
        row = db.get(SiteSetting, name)
        out[name] = {"value": site_settings.get_section(db, name).model_dump(mode="json"),
                     "version": row.version if row else 0,
                     "updated_at": row.updated_at.isoformat() if row else None}
    out["_server"] = {"payment_live_allowed": env.PAYMENT_LIVE_ALLOWED,
                      "razorpay_configured": bool(env.RAZORPAY_KEY_ID and env.RAZORPAY_KEY_SECRET),
                      "razorpay_webhook_configured": bool(env.RAZORPAY_WEBHOOK_SECRET),
                      "storage_provider": env.STORAGE_PROVIDER, "email_provider": env.EMAIL_PROVIDER,
                      "smtp_configured": bool(env.SMTP_HOST), "app_env": env.APP_ENV}
    return out


@router.get("/settings/schema")
def settings_schema(_: User = Depends(require("settings.read"))):
    return {name: model.model_json_schema() for name, model in SECTIONS.items()}


@router.patch("/settings/{section}")
def patch_settings(section: str, request: Request, patch: dict = Body(...), db: Session = Depends(get_db),
                   admin: User = Depends(require("settings.write"))):
    if section in PAYMENT_SECTIONS and "settings.payments" not in admin.permission_codes:
        raise Forbidden("Payment settings require the settings.payments permission")
    reason = patch.pop("_reason", None) if isinstance(patch, dict) else None
    new = site_settings.update_section(db, section, patch, admin, ip=request_ip(request), reason=reason)
    return new.model_dump(mode="json")


# Back-compat with the spec'd PATCH /admin/settings (body: {section: {...}})
@router.patch("/settings")
def patch_settings_bulk(request: Request, body: dict = Body(...), db: Session = Depends(get_db),
                        admin: User = Depends(require("settings.write"))):
    out = {}
    for section, patch in body.items():
        if section in PAYMENT_SECTIONS and "settings.payments" not in admin.permission_codes:
            raise Forbidden("Payment settings require the settings.payments permission")
        if not isinstance(patch, dict):
            raise BusinessRuleError(f"Section {section} must be an object")
        out[section] = site_settings.update_section(db, section, patch, admin, ip=request_ip(request)).model_dump(mode="json")
    return out


# ======================================================================= shipping configuration

def _provider_out(p: ShippingProvider) -> dict:
    return {k: getattr(p, k) for k in ("id", "code", "name", "is_active", "supports_domestic",
                                       "supports_international", "supports_recipient_paid_shipping",
                                       "supports_fragile", "supports_insurance", "tracking_url_template", "notes")}


@router.get("/shipping/providers")
def providers(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    return [_provider_out(p) for p in db.scalars(select(ShippingProvider).order_by(ShippingProvider.id)).all()]


@router.post("/shipping/providers", status_code=201)
def create_provider(body: ShippingProviderIn, db: Session = Depends(get_db), admin: User = Depends(require("shipping.write"))):
    p = ShippingProvider(**body.model_dump())
    db.add(p)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("Provider code already exists")
    audit(db, admin, "shipping.provider_create", "shipping_provider", p.id, after=body.model_dump())
    db.commit()
    return _provider_out(p)


@router.put("/shipping/providers/{pid}")
def update_provider(pid: int, body: ShippingProviderIn, db: Session = Depends(get_db),
                    admin: User = Depends(require("shipping.write"))):
    p = db.get(ShippingProvider, pid)
    if not p:
        raise NotFound("Provider not found")
    before = _provider_out(p)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    audit(db, admin, "shipping.provider_update", "shipping_provider", p.id, before=before, after=_provider_out(p))
    db.commit()
    return _provider_out(p)


def _zone_out(z: ShippingZone) -> dict:
    warnings = []
    if z.provider and not z.provider.supports_recipient_paid_shipping:
        warnings.append("Courier cannot collect shipping fees from recipients: orders below the free-delivery "
                        "threshold to this zone will be blocked at checkout.")
    if z.provider is None:
        warnings.append("No courier assigned: destinations in this zone cannot check out.")
    elif not z.is_domestic and not z.provider.supports_international:
        warnings.append("Assigned courier does not support international shipping.")
    return {"id": z.id, "name": z.name, "is_domestic": z.is_domestic, "country_codes": z.country_codes,
            "provider_id": z.provider_id, "provider_name": z.provider.name if z.provider else None,
            "is_active": z.is_active, "estimated_days_min": z.estimated_days_min,
            "estimated_days_max": z.estimated_days_max, "warnings": warnings,
            "rates": [{"id": r.id, "max_weight_grams": r.max_weight_grams, "fee": m(r.fee),
                       "fragile_surcharge": m(r.fragile_surcharge)} for r in z.rates]}


@router.get("/shipping/zones")
def zones(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    return [_zone_out(z) for z in db.scalars(select(ShippingZone).order_by(ShippingZone.id)).all()]


def _save_zone(db: Session, z: ShippingZone, body: ZoneIn) -> None:
    if body.provider_id and not db.get(ShippingProvider, body.provider_id):
        raise BusinessRuleError("Unknown provider")
    for k, v in body.model_dump(exclude={"rates"}).items():
        setattr(z, k, v)
    z.rates.clear()
    db.flush()
    for r in sorted(body.rates, key=lambda r: r.max_weight_grams):
        z.rates.append(ShippingRate(**r.model_dump()))


@router.post("/shipping/zones", status_code=201)
def create_zone(body: ZoneIn, db: Session = Depends(get_db), admin: User = Depends(require("shipping.write"))):
    z = ShippingZone()
    db.add(z)
    _save_zone(db, z, body)
    db.flush()
    audit(db, admin, "shipping.zone_create", "shipping_zone", z.id, after=body.model_dump(mode="json"))
    db.commit()
    db.refresh(z)
    return _zone_out(z)


@router.put("/shipping/zones/{zid}")
def update_zone(zid: int, body: ZoneIn, db: Session = Depends(get_db), admin: User = Depends(require("shipping.write"))):
    z = db.get(ShippingZone, zid)
    if not z:
        raise NotFound("Zone not found")
    _save_zone(db, z, body)
    audit(db, admin, "shipping.zone_update", "shipping_zone", z.id, after=body.model_dump(mode="json"))
    db.commit()
    db.refresh(z)
    return _zone_out(z)


@router.delete("/shipping/zones/{zid}")
def delete_zone(zid: int, db: Session = Depends(get_db), admin: User = Depends(require("shipping.write"))):
    z = db.get(ShippingZone, zid)
    if not z:
        raise NotFound("Zone not found")
    audit(db, admin, "shipping.zone_delete", "shipping_zone", zid, before={"name": z.name})
    db.delete(z)
    db.commit()
    return {"ok": True}


def _dest_out(d: DestinationEligibility) -> dict:
    return {k: getattr(d, k) for k in ("id", "country_code", "country_name", "is_enabled", "allows_fragile",
                                       "currency_code", "postal_code_regex", "customs_note", "restriction_reason")}


@router.get("/shipping/destinations")
def destinations(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    return [_dest_out(d) for d in db.scalars(select(DestinationEligibility).order_by(DestinationEligibility.country_name)).all()]


@router.put("/shipping/destinations")
def upsert_destination(body: DestinationIn, db: Session = Depends(get_db), admin: User = Depends(require("shipping.write"))):
    code = body.country_code.upper()
    d = db.scalar(select(DestinationEligibility).where(DestinationEligibility.country_code == code))
    before = _dest_out(d) if d else None
    if not d:
        d = DestinationEligibility(country_code=code)
        db.add(d)
    for k, v in body.model_dump(exclude={"country_code"}).items():
        setattr(d, k, v)
    db.flush()
    audit(db, admin, "shipping.destination", "destination", code, before=before, after=_dest_out(d))
    db.commit()
    return _dest_out(d)


# ======================================================================= currencies, exchange rates, taxes

@router.get("/currencies")
def currencies(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    out = []
    for c in db.scalars(select(Currency).order_by(Currency.code)).all():
        rate = db.scalar(select(ExchangeRate).where(ExchangeRate.quote_currency == c.code)
                         .order_by(ExchangeRate.effective_at.desc()).limit(1))
        out.append({"code": c.code, "name": c.name, "symbol": c.symbol, "decimals": c.decimals,
                    "is_enabled": c.is_enabled, "is_base": c.is_base,
                    "rate": "1" if c.is_base else (str(rate.rate) if rate else None),
                    "rate_source": rate.source if rate else None,
                    "rate_updated_at": rate.effective_at.isoformat() if rate else None})
    return out


@router.put("/currencies")
def upsert_currency(body: CurrencyIn, db: Session = Depends(get_db), admin: User = Depends(require("settings.write"))):
    code = body.code.upper()
    c = db.get(Currency, code)
    if c and c.is_base and not body.is_enabled:
        raise BusinessRuleError("The base currency cannot be disabled.")
    if not c:
        c = Currency(code=code, is_base=False)
        db.add(c)
    c.name, c.symbol, c.decimals, c.is_enabled = body.name, body.symbol, body.decimals, body.is_enabled
    audit(db, admin, "currency.update", "currency", code, after=body.model_dump())
    db.commit()
    return {"ok": True}


@router.post("/exchange-rates", status_code=201)
def add_rate(body: ExchangeRateIn, db: Session = Depends(get_db), admin: User = Depends(require("settings.write"))):
    code = body.quote_currency.upper()
    c = db.get(Currency, code)
    if not c or c.is_base:
        raise BusinessRuleError("Unknown or base currency")
    db.add(ExchangeRate(quote_currency=code, rate=body.rate, source=body.source, effective_at=_now()))
    audit(db, admin, "exchange_rate.add", "currency", code, after={"rate": body.rate, "source": body.source})
    db.commit()
    return {"ok": True}


@router.get("/tax-rules")
def tax_rules(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    return [{"id": t.id, "tax_class": t.tax_class, "country_code": t.country_code, "rate_percent": str(t.rate_percent),
             "label": t.label, "is_active": t.is_active}
            for t in db.scalars(select(TaxRule).order_by(TaxRule.tax_class, TaxRule.country_code)).all()]


@router.put("/tax-rules")
def upsert_tax(body: TaxRuleIn, db: Session = Depends(get_db), admin: User = Depends(require("settings.write"))):
    cc = body.country_code.upper()
    t = db.scalar(select(TaxRule).where(TaxRule.tax_class == body.tax_class, TaxRule.country_code == cc))
    before = {"rate_percent": t.rate_percent} if t else None
    if not t:
        t = TaxRule(tax_class=body.tax_class, country_code=cc)
        db.add(t)
    t.rate_percent, t.label, t.is_active = body.rate_percent, body.label, body.is_active
    audit(db, admin, "tax_rule.update", "tax_rule", f"{body.tax_class}:{cc}", before=before, after=body.model_dump())
    db.commit()
    return {"ok": True}


# ======================================================================= coupons

def _coupon_out(db: Session, c: Coupon) -> dict:
    used = db.scalar(select(func.count()).select_from(CouponRedemption).where(
        CouponRedemption.coupon_id == c.id, CouponRedemption.status == "used")) or 0
    return {"id": c.id, "code": c.code, "description": c.description, "discount_type": c.discount_type,
            "value": m(c.value), "min_order_amount": m(c.min_order_amount),
            "max_discount_amount": m(c.max_discount_amount),
            "starts_at": c.starts_at.isoformat() if c.starts_at else None,
            "ends_at": c.ends_at.isoformat() if c.ends_at else None, "usage_limit": c.usage_limit,
            "per_customer_limit": c.per_customer_limit, "applies_to_sale_items": c.applies_to_sale_items,
            "domestic_only": c.domestic_only, "is_active": c.is_active, "times_used": used}


@router.get("/coupons")
def coupons(db: Session = Depends(get_db), _: User = Depends(require("coupons.write"))):
    return [_coupon_out(db, c) for c in db.scalars(select(Coupon).order_by(Coupon.id.desc())).all()]


def _save_coupon(c: Coupon, body: CouponIn) -> None:
    if body.discount_type == "percent" and body.value > 100:
        raise BusinessRuleError("Percentage cannot exceed 100.")
    if body.starts_at and body.ends_at and body.ends_at <= body.starts_at:
        raise BusinessRuleError("End date must be after start date.")
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    c.code = body.code.upper()


@router.post("/coupons", status_code=201)
def create_coupon(body: CouponIn, db: Session = Depends(get_db), admin: User = Depends(require("coupons.write"))):
    if db.scalar(select(Coupon).where(Coupon.code == body.code.upper())):
        raise Conflict("Coupon code already exists")
    c = Coupon()
    _save_coupon(c, body)
    db.add(c)
    db.flush()
    audit(db, admin, "coupon.create", "coupon", c.id, after=body.model_dump(mode="json"))
    db.commit()
    return _coupon_out(db, c)


@router.put("/coupons/{cid}")
def update_coupon(cid: int, body: CouponIn, db: Session = Depends(get_db), admin: User = Depends(require("coupons.write"))):
    c = db.get(Coupon, cid)
    if not c:
        raise NotFound("Coupon not found")
    clash = db.scalar(select(Coupon).where(Coupon.code == body.code.upper(), Coupon.id != cid))
    if clash:
        raise Conflict("Coupon code already exists")
    _save_coupon(c, body)
    audit(db, admin, "coupon.update", "coupon", c.id, after=body.model_dump(mode="json"))
    db.commit()
    return _coupon_out(db, c)


@router.delete("/coupons/{cid}")
def delete_coupon(cid: int, db: Session = Depends(get_db), admin: User = Depends(require("coupons.write"))):
    c = db.get(Coupon, cid)
    if not c:
        raise NotFound("Coupon not found")
    used = db.scalar(select(func.count()).select_from(CouponRedemption).where(CouponRedemption.coupon_id == cid)) or 0
    if used:
        c.is_active = False  # keep redemption history
    else:
        db.delete(c)
    audit(db, admin, "coupon.delete", "coupon", cid)
    db.commit()
    return {"ok": True, "deactivated": bool(used)}


# ======================================================================= content

def _block_out(b: ContentBlock) -> dict:
    return {"id": b.id, "placement": b.placement, "title": b.title, "subtitle": b.subtitle, "body": b.body,
            "image_url": b.image_url, "link_url": b.link_url, "link_label": b.link_label, "position": b.position,
            "is_visible": b.is_visible, "starts_at": b.starts_at.isoformat() if b.starts_at else None,
            "ends_at": b.ends_at.isoformat() if b.ends_at else None, "data": b.data}


@router.get("/content/blocks")
def blocks(db: Session = Depends(get_db), _: User = Depends(require("content.write"))):
    return [_block_out(b) for b in db.scalars(select(ContentBlock).order_by(ContentBlock.placement, ContentBlock.position)).all()]


@router.post("/content/blocks", status_code=201)
def create_block(body: ContentBlockIn, db: Session = Depends(get_db), admin: User = Depends(require("content.write"))):
    b = ContentBlock(**body.model_dump())
    db.add(b)
    db.flush()
    audit(db, admin, "content.create", "content_block", b.id, after={"placement": b.placement, "title": b.title})
    db.commit()
    return _block_out(b)


@router.put("/content/blocks/{bid}")
def update_block(bid: int, body: ContentBlockIn, db: Session = Depends(get_db), admin: User = Depends(require("content.write"))):
    b = db.get(ContentBlock, bid)
    if not b:
        raise NotFound("Block not found")
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    audit(db, admin, "content.update", "content_block", b.id, after={"title": b.title, "is_visible": b.is_visible})
    db.commit()
    return _block_out(b)


@router.delete("/content/blocks/{bid}")
def delete_block(bid: int, db: Session = Depends(get_db), admin: User = Depends(require("content.write"))):
    b = db.get(ContentBlock, bid)
    if not b:
        raise NotFound("Block not found")
    audit(db, admin, "content.delete", "content_block", bid, before={"title": b.title})
    db.delete(b)
    db.commit()
    return {"ok": True}


def _page_out(p: CmsPage) -> dict:
    return {"id": p.id, "slug": p.slug, "title": p.title, "body": p.body, "seo_title": p.seo_title,
            "seo_description": p.seo_description, "is_published": p.is_published, "updated_at": p.updated_at.isoformat()}


@router.get("/content/pages")
def pages(db: Session = Depends(get_db), _: User = Depends(require("content.write"))):
    return [_page_out(p) for p in db.scalars(select(CmsPage).order_by(CmsPage.slug)).all()]


@router.put("/content/pages")
def upsert_page(body: CmsPageIn, db: Session = Depends(get_db), admin: User = Depends(require("content.write"))):
    p = db.scalar(select(CmsPage).where(CmsPage.slug == body.slug))
    if not p:
        p = CmsPage(slug=body.slug)
        db.add(p)
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.flush()
    audit(db, admin, "content.page", "cms_page", body.slug, after={"title": body.title})
    db.commit()
    return _page_out(p)


@router.get("/content/email-templates")
def email_templates(db: Session = Depends(get_db), _: User = Depends(require("settings.read"))):
    out = []
    for key, (subj, body) in DEFAULT_TEMPLATES.items():
        t = db.get(EmailTemplate, key)
        out.append({"key": key, "subject": t.subject if t else subj, "body": t.body if t else body,
                    "is_enabled": t.is_enabled if t else True, "customised": t is not None})
    return out


@router.put("/content/email-templates/{key}")
def update_template(key: str, body: EmailTemplateIn, db: Session = Depends(get_db),
                    admin: User = Depends(require("settings.write"))):
    if key not in DEFAULT_TEMPLATES:
        raise NotFound("Unknown template")
    t = db.get(EmailTemplate, key)
    if not t:
        t = EmailTemplate(key=key)
        db.add(t)
    t.subject, t.body, t.is_enabled = body.subject, body.body, body.is_enabled
    audit(db, admin, "email_template.update", "email_template", key)
    db.commit()
    return {"ok": True}
