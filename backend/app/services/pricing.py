"""Server-side quote engine.

Every financial amount shown at checkout or saved on an order is computed here.
The frontend never supplies prices, discounts, taxes or shipping decisions.

Rules enforced:
 * product amount is always paid online (no product COD)
 * free delivery when eligible merchandise subtotal >= threshold
   (domestic default ₹2,000, international default ₹10,000 — admin-configurable)
 * below threshold: shipping fee is collected by the courier from the recipient,
   only where the configured courier supports that on prepaid orders
 * unsupported destinations / courier arrangements block checkout
 * international orders carry a customs/duties disclosure
"""
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (Coupon, CouponRedemption, DestinationEligibility, Product, ProductVariant, ShippingZone,
                        TaxRule, User)
from app.services import site_settings
from app.services.catalog import compare_at, purchasable_problem, sale_active, unit_price
from app.services.money import BASE_CURRENCY, convert, latest_rate, q

ZERO = Decimal("0")


@dataclass
class CartLineInput:
    variant_id: int
    quantity: int
    gift_wrap: bool = False


@dataclass
class QuoteLine:
    variant_id: int
    product_id: int
    product_name: str
    product_slug: str
    variant_name: str
    sku: str
    image_url: str | None
    unit_price: Decimal
    compare_at_price: Decimal | None
    on_sale: bool
    quantity: int
    gift_wrap: bool
    gift_wrap_amount: Decimal
    line_subtotal: Decimal
    discount: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    line_total: Decimal
    available: int
    fragility: str
    weight_grams: int
    hs_code: str | None
    country_of_origin: str | None
    issue: str | None = None


@dataclass
class Quote:
    currency: str
    lines: list[QuoteLine]
    subtotal: Decimal
    discount: Decimal
    gift_wrap: Decimal
    tax: Decimal
    prices_include_tax: bool
    total: Decimal
    destination: dict
    shipping: dict
    coupon: dict | None
    payment: dict
    display: dict
    blocking_issues: list[str] = field(default_factory=list)

    @property
    def can_checkout(self) -> bool:
        return not self.blocking_issues and bool(self.lines)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["can_checkout"] = self.can_checkout
        return d


def _now() -> datetime:
    return datetime.now(timezone.utc)


def tax_rate_for(db: Session, tax_class: str, country: str, domestic_country: str) -> tuple[Decimal, str]:
    key = country if country == domestic_country else "*"
    rule = db.scalar(select(TaxRule).where(TaxRule.tax_class == tax_class, TaxRule.country_code == key,
                                           TaxRule.is_active.is_(True)))
    if not rule and key != country:
        rule = db.scalar(select(TaxRule).where(TaxRule.tax_class == tax_class, TaxRule.country_code == country,
                                               TaxRule.is_active.is_(True)))
    return (Decimal(rule.rate_percent), rule.label) if rule else (ZERO, "Tax")


def evaluate_coupon(db: Session, code: str | None, user: User | None, merch_subtotal: Decimal,
                    eligible_lines_subtotal: Decimal, is_international: bool,
                    max_discount_percent: Decimal) -> tuple[Coupon | None, Decimal, str | None]:
    if not code:
        return None, ZERO, None
    c = db.scalar(select(Coupon).where(Coupon.code == code.strip().upper()))
    now = _now()
    if not c or not c.is_active:
        return None, ZERO, "This code is not valid."
    if c.starts_at and now < c.starts_at:
        return None, ZERO, "This code is not active yet."
    if c.ends_at and now > c.ends_at:
        return None, ZERO, "This code has expired."
    if c.domestic_only and is_international:
        return None, ZERO, "This code is valid for domestic orders only."
    if merch_subtotal < c.min_order_amount:
        return None, ZERO, f"Minimum order of ₹{c.min_order_amount:,.0f} required for this code."
    active = CouponRedemption.status.in_(("reserved", "used"))
    if c.usage_limit is not None:
        used = db.scalar(select(func.count()).select_from(CouponRedemption)
                         .where(CouponRedemption.coupon_id == c.id, active)) or 0
        if used >= c.usage_limit:
            return None, ZERO, "This code has reached its usage limit."
    if c.per_customer_limit is not None and user is not None:
        used = db.scalar(select(func.count()).select_from(CouponRedemption)
                         .where(CouponRedemption.coupon_id == c.id, CouponRedemption.user_id == user.id,
                                active)) or 0
        if used >= c.per_customer_limit:
            return None, ZERO, "You have already used this code."
    if eligible_lines_subtotal <= 0:
        return None, ZERO, "This code does not apply to sale items."
    if c.discount_type == "percent":
        disc = eligible_lines_subtotal * Decimal(c.value) / 100
    else:
        disc = Decimal(c.value)
    if c.max_discount_amount is not None:
        disc = min(disc, Decimal(c.max_discount_amount))
    disc = min(disc, eligible_lines_subtotal, merch_subtotal * max_discount_percent / 100)
    return c, q(disc), None


def check_destination(db: Session, country: str, postal_code: str | None, lines: list[QuoteLine],
                      products: dict[int, Product], ship: "site_settings.ShippingSettings") -> dict:
    country = (country or "").upper()
    is_intl = country != ship.domestic_country
    reasons: list[str] = []
    dest = db.scalar(select(DestinationEligibility).where(DestinationEligibility.country_code == country))
    zone = None
    if not dest or not dest.is_enabled:
        reasons.append(dest.restriction_reason if dest and dest.restriction_reason
                       else f"We do not currently ship to this destination ({country or 'unknown'}).")
    else:
        if is_intl and not ship.international_enabled:
            reasons.append("International shipping is currently unavailable.")
        if postal_code and dest.postal_code_regex and not re.fullmatch(dest.postal_code_regex, postal_code.strip()):
            reasons.append("Please enter a valid postal code for the destination country.")
        zones = db.scalars(select(ShippingZone).where(ShippingZone.is_active.is_(True))).all()
        zone = next((z for z in zones if country in (z.country_codes or [])), None)
        if zone is None:
            zone = next((z for z in zones if not z.is_domestic and "*" in (z.country_codes or [])), None) if is_intl else None
        if zone is None or zone.provider is None or not zone.provider.is_active:
            reasons.append("No courier currently services this destination.")
        elif is_intl and not zone.provider.supports_international:
            reasons.append("The configured courier does not ship internationally to this destination.")
        for ln in lines:
            p = products.get(ln.product_id)
            if not p:
                continue
            if is_intl and not p.ships_internationally:
                reasons.append(f"“{p.name}” ships within {ship.domestic_country} only.")
            if country in (p.blocked_countries or []):
                reasons.append(f"“{p.name}” cannot be shipped to {country}.")
            if p.fragility != "standard":
                if is_intl and not (ship.fragile_international_allowed and dest.allows_fragile):
                    reasons.append(f"“{p.name}” is fragile and cannot be shipped to {country}.")
                if zone is not None and zone.provider is not None and not zone.provider.supports_fragile:
                    reasons.append(f"The courier for this destination cannot carry fragile items like “{p.name}”.")
    return {"country": country, "is_international": is_intl, "supported": not reasons,
            "reasons": list(dict.fromkeys(reasons)), "zone": zone,
            "customs_note": dest.customs_note if dest else None}


def estimate_fee(zone: ShippingZone | None, weight_grams: int, any_fragile: bool) -> Decimal | None:
    if not zone or not zone.rates:
        return None
    rate = next((r for r in zone.rates if weight_grams <= r.max_weight_grams), zone.rates[-1])
    return q(Decimal(rate.fee) + (Decimal(rate.fragile_surcharge) if any_fragile else ZERO))


def build_quote(db: Session, items: list[CartLineInput], country: str | None = None,
                postal_code: str | None = None, coupon_code: str | None = None,
                user: User | None = None, display_currency: str = BASE_CURRENCY) -> Quote:
    ship = site_settings.shipping(db)
    pricing = site_settings.pricing(db)
    pay = site_settings.payment(db)
    rounding = pricing.rounding
    country = (country or ship.domestic_country).upper()
    blocking: list[str] = []

    # merge duplicate lines
    merged: dict[tuple[int, bool], int] = {}
    for it in items:
        merged[(it.variant_id, it.gift_wrap)] = merged.get((it.variant_id, it.gift_wrap), 0) + it.quantity

    variants = {v.id: v for v in db.scalars(select(ProductVariant).where(
        ProductVariant.id.in_([k[0] for k in merged]))).all()} if merged else {}
    products: dict[int, Product] = {v.product_id: v.product for v in variants.values()}

    lines: list[QuoteLine] = []
    for (vid, gift), qty in merged.items():
        v = variants.get(vid)
        if v is None:
            blocking.append("An item in your bag is no longer available.")
            continue
        p = v.product
        issue = purchasable_problem(p, v, qty)
        if issue:
            blocking.append(f"{p.name}: {issue}")
        price = unit_price(p, v)
        gw = q(Decimal(p.gift_wrap_price) * qty) if gift and p.gift_wrap_available else ZERO
        if gift and not p.gift_wrap_available:
            issue = issue or "Gift packaging is not available for this item."
            blocking.append(f"{p.name}: gift packaging unavailable.")
        img = p.images[0].url if p.images else None
        lines.append(QuoteLine(
            variant_id=v.id, product_id=p.id, product_name=p.name, product_slug=p.slug,
            variant_name="" if v.is_default else v.name, sku=v.sku, image_url=img,
            unit_price=q(price), compare_at_price=compare_at(p, v), on_sale=sale_active(p) and v.price_override is None,
            quantity=qty, gift_wrap=gift and p.gift_wrap_available, gift_wrap_amount=gw,
            line_subtotal=q(price * qty), discount=ZERO, tax_rate=ZERO, tax_amount=ZERO, line_total=ZERO,
            available=v.inventory.available if v.inventory else 0, fragility=p.fragility,
            weight_grams=(p.package_weight_grams or p.weight_grams or ship.default_package_weight_grams) * qty,
            hs_code=p.hs_code, country_of_origin=p.country_of_origin, issue=issue))

    subtotal = q(sum((ln.line_subtotal for ln in lines), ZERO))
    gift_total = q(sum((ln.gift_wrap_amount for ln in lines), ZERO))

    destination = check_destination(db, country, postal_code, lines, products, ship)
    is_intl = destination["is_international"]
    blocking.extend(destination["reasons"])

    # ---- coupon ----
    coupon_eligible = [ln for ln in lines if pricing.allow_coupon_with_sale_items or not ln.on_sale]
    coupon_info = None
    discount = ZERO
    if coupon_code:
        coupon, discount, err = evaluate_coupon(
            db, coupon_code, user, subtotal, sum((ln.line_subtotal for ln in coupon_eligible), ZERO),
            is_intl, pricing.max_discount_percent)
        coupon_info = {"code": coupon_code.strip().upper(), "valid": coupon is not None,
                       "message": err or (coupon.description if coupon else None), "discount": discount}
        if coupon and discount > 0:
            base = sum((ln.line_subtotal for ln in coupon_eligible), ZERO)
            remaining = discount
            for i, ln in enumerate(coupon_eligible):
                share = remaining if i == len(coupon_eligible) - 1 else q(discount * ln.line_subtotal / base, rounding)
                share = min(share, ln.line_subtotal)
                ln.discount = share
                remaining -= share

    # ---- tax ----
    tax_total = ZERO
    for ln in lines:
        p = products[ln.product_id]
        rate, _label = tax_rate_for(db, p.tax_class, country, ship.domestic_country)
        net = ln.line_subtotal - ln.discount
        if pricing.prices_include_tax:
            tax = q(net * rate / (100 + rate), rounding) if rate else ZERO
            ln.line_total = q(net + ln.gift_wrap_amount)
        else:
            tax = q(net * rate / 100, rounding) if rate else ZERO
            ln.line_total = q(net + tax + ln.gift_wrap_amount)
        ln.tax_rate = rate
        ln.tax_amount = tax
        tax_total += tax

    discount = q(sum((ln.discount for ln in lines), ZERO))
    total = q(sum((ln.line_total for ln in lines), ZERO))

    if lines and subtotal < pricing.min_order_amount:
        blocking.append(f"Minimum order value is ₹{pricing.min_order_amount:,.0f}.")

    # ---- delivery eligibility ----
    eligible = subtotal - discount if ship.threshold_basis == "after_discount" else subtotal
    eligible = q(eligible)
    threshold = q(ship.international_free_threshold if is_intl else ship.domestic_free_threshold)
    free = eligible >= threshold
    zone = destination.pop("zone")
    provider = zone.provider if zone else None
    weight = sum((ln.weight_grams for ln in lines), 0)
    any_fragile = any(ln.fragility != "standard" for ln in lines)
    est_fee = None if free else estimate_fee(zone, weight, any_fragile)
    arrangement_supported = True
    arrangement_note = None
    if not free and lines and provider is not None and not provider.supports_recipient_paid_shipping:
        arrangement_supported = False
        arrangement_note = ("Our courier for this destination cannot collect the shipping charge from the "
                            f"recipient. Add ₹{(threshold - eligible):,.2f} more to qualify for free delivery.")
        blocking.append(arrangement_note)

    shipping = {
        "free_delivery": free,
        "threshold": threshold,
        "threshold_basis": ship.threshold_basis,
        "eligible_subtotal": eligible,
        "amount_to_free_delivery": max(ZERO, q(threshold - eligible)),
        "fee_payer": "store" if free else "recipient",
        "fee_collection_status": "not_applicable" if free else "pending_collection",
        "estimated_fee": est_fee,
        "fee_charged_online": ZERO,
        "arrangement_supported": arrangement_supported,
        "arrangement_note": arrangement_note,
        "note": ("Complimentary delivery — no shipping charge is payable." if free else ship.recipient_paid_note),
        "customs_disclosure": (ship.customs_disclosure + (f" {destination['customs_note']}" if destination.get("customs_note") else ""))
        if is_intl else None,
        "provider": provider.name if provider else None,
        "estimated_days": [zone.estimated_days_min, zone.estimated_days_max] if zone else None,
        "insurance_available": ship.insurance_available and bool(provider and provider.supports_insurance),
        "total_weight_grams": weight,
        "contains_fragile": any_fragile,
    }

    payment = {"methods": pay.enabled_methods, "cod_available": False, "provider": pay.provider,
               "mode": pay.mode, "instructions": pay.payment_instructions,
               "amount_due_online": total, "currency": BASE_CURRENCY}

    # ---- display currency ----
    display = {"currency": BASE_CURRENCY, "rate": Decimal(1), "total": total, "subtotal": subtotal,
               "threshold": threshold, "note": None}
    if display_currency and display_currency != BASE_CURRENCY:
        try:
            rate = latest_rate(db, display_currency)
            display = {"currency": display_currency, "rate": rate,
                       "total": convert(db, total, display_currency, rounding),
                       "subtotal": convert(db, subtotal, display_currency, rounding),
                       "threshold": convert(db, threshold, display_currency, rounding),
                       "note": f"Approximate amount in {display_currency}. You will be charged in INR; your bank "
                               "may apply its own conversion rate and fees."}
        except Exception:
            display["note"] = f"{display_currency} display is unavailable; amounts shown in INR."

    if not lines:
        blocking.append("Your bag is empty.")

    return Quote(currency=BASE_CURRENCY, lines=lines, subtotal=subtotal, discount=discount, gift_wrap=gift_total,
                 tax=q(tax_total), prices_include_tax=pricing.prices_include_tax, total=total,
                 destination=destination, shipping=shipping, coupon=coupon_info, payment=payment, display=display,
                 blocking_issues=list(dict.fromkeys(blocking)))
