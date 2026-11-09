"""Idempotent seed: roles/permissions, currencies, tax, destinations, couriers, zones, categories,
collections, sample catalogue (clearly marked as sample data), homepage content and policy pages.

Usage (from backend/):  python -m scripts.seed            # full seed
                         python -m scripts.seed --no-products
"""
import argparse
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.core.permissions import DEFAULT_ROLES, PERMISSIONS
from app.db.session import SessionLocal
from app.models import (Category, CmsPage, Collection, ContentBlock, Coupon, Currency, DestinationEligibility,
                        ExchangeRate, Inventory, InventoryMovement, Permission, Product, ProductAttribute,
                        ProductImage, ProductVariant, Role, ShippingProvider, ShippingRate, ShippingZone, TaxRule)
from app.services.text import slugify

NOW = datetime.now(timezone.utc)


def seed_rbac(db):
    perms = {p.code: p for p in db.scalars(select(Permission)).all()}
    for code, desc in PERMISSIONS.items():
        if code not in perms:
            perms[code] = Permission(code=code, description=desc)
            db.add(perms[code])
    db.flush()
    for name, (desc, codes) in DEFAULT_ROLES.items():
        role = db.scalar(select(Role).where(Role.name == name))
        if not role:
            role = Role(name=name, description=desc, is_system=True)
            db.add(role)
        role.permissions = [perms[c] for c in codes]
        if name == "Super Admin":
            role.permissions = list(perms.values())
    print("  roles & permissions")


def seed_money(db):
    currencies = [("INR", "Indian Rupee", "₹", True, None), ("USD", "US Dollar", "$", False, "0.01190000"),
                  ("EUR", "Euro", "€", False, "0.01100000"), ("GBP", "British Pound", "£", False, "0.00940000"),
                  ("AED", "UAE Dirham", "AED ", False, "0.04370000"), ("SGD", "Singapore Dollar", "S$", False, "0.01600000"),
                  ("AUD", "Australian Dollar", "A$", False, "0.01800000"), ("CAD", "Canadian Dollar", "C$", False, "0.01640000")]
    for code, name, sym, base, rate in currencies:
        c = db.get(Currency, code)
        if not c:
            db.add(Currency(code=code, name=name, symbol=sym, is_base=base, decimals=2, is_enabled=True))
            db.flush()
            if rate:
                # Indicative sample rates — replace with current rates in Admin › Settings › Currencies.
                db.add(ExchangeRate(quote_currency=code, rate=Decimal(rate), source="seed (indicative — update)",
                                    effective_at=NOW))
    for tax_class, cc, rate, label in [("standard", "IN", "18", "GST"), ("standard", "*", "0", "Export (zero-rated)"),
                                       ("reduced", "IN", "12", "GST"), ("reduced", "*", "0", "Export (zero-rated)")]:
        if not db.scalar(select(TaxRule).where(TaxRule.tax_class == tax_class, TaxRule.country_code == cc)):
            db.add(TaxRule(tax_class=tax_class, country_code=cc, rate_percent=Decimal(rate), label=label))
    print("  currencies, sample exchange rates, tax rules")


DESTINATIONS = [
    ("IN", "India", True, r"[1-9][0-9]{5}", None),
    ("US", "United States", True, r"\d{5}(-\d{4})?", "US: shipments above the de minimis value may incur duties."),
    ("GB", "United Kingdom", True, r"[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}", "UK: VAT and handling fees are charged on import."),
    ("AE", "United Arab Emirates", True, None, None),
    ("SG", "Singapore", True, r"\d{6}", "Singapore: GST applies to imported goods."),
    ("AU", "Australia", True, r"\d{4}", None),
    ("CA", "Canada", True, r"[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d", None),
    ("DE", "Germany", True, r"\d{5}", "EU: import VAT is collected on delivery."),
    ("FR", "France", True, r"\d{5}", "EU: import VAT is collected on delivery."),
    ("NL", "Netherlands", True, r"\d{4} ?[A-Za-z]{2}", "EU: import VAT is collected on delivery."),
    ("JP", "Japan", False, r"\d{3}-?\d{4}", None),
    ("BR", "Brazil", False, None, None),
]


def seed_shipping(db):
    for cc, name, enabled, rx, note in DESTINATIONS:
        if not db.scalar(select(DestinationEligibility).where(DestinationEligibility.country_code == cc)):
            db.add(DestinationEligibility(country_code=cc, country_name=name, is_enabled=enabled, postal_code_regex=rx,
                                          customs_note=note, allows_fragile=True,
                                          restriction_reason=None if enabled else f"We do not currently ship to {name}."))
    mock = db.scalar(select(ShippingProvider).where(ShippingProvider.code == "mock"))
    if not mock:
        mock = ShippingProvider(code="mock", name="Mock Courier (test)", supports_domestic=True,
                                supports_international=True, supports_recipient_paid_shipping=True,
                                supports_fragile=True, supports_insurance=True,
                                notes="Local development courier. Simulates tracking and fee collection.")
        db.add(mock)
    manual = db.scalar(select(ShippingProvider).where(ShippingProvider.code == "manual"))
    if not manual:
        manual = ShippingProvider(code="manual", name="Manual courier (prepaid only)", supports_domestic=True,
                                  supports_international=False, supports_recipient_paid_shipping=False,
                                  supports_fragile=True, is_active=True,
                                  tracking_url_template=None,
                                  notes="Example of a courier that cannot collect shipping from the recipient. "
                                        "The system blocks it for orders with recipient-paid shipping.")
        db.add(manual)
    db.flush()
    if not db.scalar(select(ShippingZone)):
        zones = [
            ("India", True, ["IN"], 3, 7, [(1000, "90"), (3000, "150"), (10000, "320"), (30000, "650")], "60"),
            ("International — Gulf & Asia", False, ["AE", "SG"], 6, 12, [(1000, "1400"), (3000, "2600"), (10000, "6200"), (30000, "14000")], "500"),
            ("International — Europe, Americas & Oceania", False, ["US", "GB", "AU", "CA", "DE", "FR", "NL"], 7, 15,
             [(1000, "2200"), (3000, "3900"), (10000, "8900"), (30000, "19500")], "800"),
        ]
        for name, dom, ccs, dmin, dmax, rates, surcharge in zones:
            z = ShippingZone(name=name, is_domestic=dom, country_codes=ccs, provider_id=mock.id,
                             estimated_days_min=dmin, estimated_days_max=dmax)
            for w, fee in rates:
                z.rates.append(ShippingRate(max_weight_grams=w, fee=Decimal(fee), fragile_surcharge=Decimal(surcharge)))
            db.add(z)
    print("  destinations, couriers, zones & indicative rates")


CATEGORIES = [
    ("Vases & Flower Arrangements", "Hand-blown and moulded vases for single stems to generous bouquets.", [
        "Bud Vases", "Statement Vases"]),
    ("Drinking Glasses & Tumblers", "Everyday tumblers to fine stemware.", ["Tumblers", "Stemware"]),
    ("Glass Mugs & Cups", "Double-wall and borosilicate cups for tea and coffee.", []),
    ("Bowls & Serving Dishes", "Serving bowls, salad bowls and dessert dishes.", []),
    ("Plates & Tableware", "Dinner plates, platters and tableware sets.", []),
    ("Jars & Storage", "Airtight jars and canisters for the pantry.", []),
    ("Kitchen Glassware", "Carafes, measuring jugs and oven-safe glass.", []),
    ("Candle Holders & Lanterns", "Votives, hurricane lanterns and candle stands.", []),
    ("Sculptures & Ornaments", "Art glass, paperweights and decorative objects.", []),
    ("Centerpieces", "Table centrepieces for gatherings and celebrations.", []),
    ("Lamps & Lighting", "Glass shades, lamps and lighting accessories.", []),
    ("Bathroom Accessories", "Soap dispensers, tumblers and vanity trays.", []),
    ("Trays & Organizers", "Mirrored and glass trays for every surface.", []),
    ("Gift Sets", "Ready-to-give sets, wrapped by hand.", []),
    ("Designer Collections", "Limited pieces by independent glass artists.", []),
    ("Premium Collections", "Our finest crystal and mouth-blown glass.", []),
    ("Seasonal Collections", "Pieces for festivals and the changing seasons.", []),
    ("New Arrivals & Sale", "The latest arrivals and pieces on offer.", []),
]


def seed_catalog_structure(db):
    for i, (name, desc, children) in enumerate(CATEGORIES):
        slug = slugify(name)
        c = db.scalar(select(Category).where(Category.slug == slug))
        if not c:
            c = Category(name=name, slug=slug, description=desc, position=i, status="published",
                         image_url=f"/images/categories/{slug}.svg")
            db.add(c)
            db.flush()
        for j, child in enumerate(children):
            cs = slugify(child)
            if not db.scalar(select(Category).where(Category.slug == cs)):
                db.add(Category(name=child, slug=cs, parent_id=c.id, position=j, status="published"))
    for i, (name, kind, desc) in enumerate([
        ("The Amber Edit", "featured", "Warm, honeyed glass that glows in afternoon light."),
        ("Gifts Under ₹3,000", "gift", "Considered gifts, wrapped by hand."),
        ("Festive Lights", "seasonal", "Candlelight and colour for the festive season."),
        ("Atelier Series", "designer", "Limited pieces from independent studios."),
        ("Crystal Reserve", "premium", "Our finest lead-free crystal."),
    ]):
        if not db.scalar(select(Collection).where(Collection.slug == slugify(name))):
            db.add(Collection(name=name, slug=slugify(name), kind=kind, description=desc, position=i,
                              image_url=f"/images/collections/{slugify(name)}.svg"))
    db.flush()
    print("  18 categories (+ subcategories) and 5 collections")


# name, category slug, shape, tint, price, compare, sale, stock, glass_type, color, dims, capacity, weight, flags, collections
PRODUCTS = [
    ("Solene Amber Bud Vase", "bud-vases", "budvase", "amber", "1450", None, None, 24, "Soda-lime, mouth-blown", "Amber", "H 18 cm × Ø 7 cm", None, 320, "new feat", ["the-amber-edit", "gifts-under-3-000"]),
    ("Orla Fluted Statement Vase", "statement-vases", "vase", "clear", "4800", "5600", None, 9, "Lead-free crystal", "Clear", "H 32 cm × Ø 14 cm", None, 1650, "best feat", ["crystal-reserve"]),
    ("Maren Smoke Ribbed Vase", "statement-vases", "vase", "smoke", "3900", None, None, 12, "Borosilicate", "Smoke grey", "H 28 cm × Ø 12 cm", None, 1200, "new", []),
    ("Ilse Sage Bottle Vase", "bud-vases", "budvase", "sage", "1650", None, "1320", 30, "Recycled glass", "Sage green", "H 22 cm × Ø 8 cm", None, 380, "sale", []),
    ("Halden Highball Tumblers, Set of 4", "tumblers", "tumbler", "clear", "2400", None, None, 40, "Lead-free crystal", "Clear", "H 14 cm × Ø 7.5 cm", "380 ml", 1100, "best", ["gifts-under-3-000"]),
    ("Rivière Fluted Tumblers, Set of 2", "tumblers", "tumbler", "amber", "1800", None, None, 35, "Soda-lime, pressed", "Amber", "H 10 cm × Ø 8 cm", "300 ml", 620, "new", ["the-amber-edit"]),
    ("Aube Wine Glasses, Set of 2", "stemware", "wine", "clear", "3200", None, None, 18, "Lead-free crystal", "Clear", "H 22 cm × Ø 9 cm", "450 ml", 520, "best feat", ["crystal-reserve"]),
    ("Ciel Coupe Glasses, Set of 2", "stemware", "coupe", "clear", "2900", "3400", None, 14, "Lead-free crystal", "Clear", "H 15 cm × Ø 11 cm", "240 ml", 460, "", []),
    ("Doublewall Espresso Cups, Set of 2", "glass-mugs-cups", "mug", "clear", "1250", None, None, 50, "Borosilicate, double-wall", "Clear", "H 8 cm × Ø 7 cm", "90 ml", 240, "best", ["gifts-under-3-000"]),
    ("Thea Borosilicate Tea Mug", "glass-mugs-cups", "mug", "clear", "950", None, None, 60, "Borosilicate", "Clear", "H 10 cm × Ø 8.5 cm", "350 ml", 260, "", []),
    ("Nori Serving Bowl", "bowls-serving-dishes", "bowl", "sage", "2600", None, None, 15, "Recycled glass", "Sage green", "H 10 cm × Ø 26 cm", "2.4 l", 1400, "feat", []),
    ("Lys Dessert Bowls, Set of 4", "bowls-serving-dishes", "bowl", "clear", "1900", None, "1590", 22, "Soda-lime, pressed", "Clear", "H 6 cm × Ø 12 cm", "300 ml", 900, "sale", []),
    ("Opaline Dinner Plates, Set of 4", "plates-tableware", "plate", "opal", "3600", None, None, 16, "Opal glass", "Milk white", "Ø 27 cm", None, 2600, "", []),
    ("Vela Airtight Storage Jar", "jars-storage", "jar", "clear", "1100", None, None, 45, "Borosilicate", "Clear", "H 18 cm × Ø 11 cm", "1.2 l", 700, "", []),
    ("Pantry Canisters, Set of 3", "jars-storage", "jar", "smoke", "2700", None, None, 20, "Borosilicate", "Smoke grey", "H 12–20 cm", "0.6–1.4 l", 1900, "new", []),
    ("Clair Carafe with Tumbler", "kitchen-glassware", "carafe", "clear", "1750", None, None, 28, "Borosilicate", "Clear", "H 24 cm × Ø 10 cm", "1 l", 650, "best", ["gifts-under-3-000"]),
    ("Lumen Hurricane Lantern", "candle-holders-lanterns", "lantern", "clear", "3400", None, None, 10, "Mouth-blown glass", "Clear", "H 30 cm × Ø 15 cm", None, 1800, "feat", ["festive-lights"]),
    ("Ember Votive Holders, Set of 4", "candle-holders-lanterns", "votive", "amber", "1350", None, None, 36, "Soda-lime, pressed", "Amber", "H 8 cm × Ø 7 cm", None, 700, "new", ["festive-lights", "the-amber-edit", "gifts-under-3-000"]),
    ("Orbe Art-Glass Sculpture", "sculptures-ornaments", "orb", "blue", "6800", None, None, 5, "Hand-sculpted art glass", "Cobalt blue", "H 16 cm × Ø 16 cm", None, 2100, "feat", ["atelier-series"]),
    ("Tide Glass Centerpiece Bowl", "centerpieces", "bowl", "blue", "5400", None, None, 6, "Mouth-blown glass", "Ocean blue", "H 12 cm × Ø 34 cm", None, 2800, "", ["atelier-series"]),
    ("Halo Glass Table Lamp", "lamps-lighting", "lamp", "opal", "7900", None, None, 7, "Opal glass shade", "Milk white", "H 38 cm × Ø 22 cm", None, 3200, "new feat", ["crystal-reserve"]),
    ("Brume Soap Dispenser", "bathroom-accessories", "dispenser", "smoke", "1200", None, None, 32, "Recycled glass", "Smoke grey", "H 17 cm × Ø 8 cm", "350 ml", 420, "", []),
    ("Mirror-Edge Vanity Tray", "trays-organizers", "tray", "clear", "2200", None, None, 18, "Toughened glass", "Clear with brass", "30 × 20 cm", None, 1300, "", []),
    ("Celebration Gift Set", "gift-sets", "giftset", "clear", "4200", None, None, 12, "Lead-free crystal", "Clear", "Two coupes + carafe", None, 1900, "feat best", ["gifts-under-3-000"]),
]


def seed_products(db):
    cats = {c.slug: c for c in db.scalars(select(Category)).all()}
    cols = {c.slug: c for c in db.scalars(select(Collection)).all()}
    created = 0
    for (name, cat, shape, tint, price, compare, sale, stock, gtype, color, dims, cap, weight, flags,
         col_slugs) in PRODUCTS:
        slug = slugify(name)
        if db.scalar(select(Product).where(Product.slug == slug)):
            continue
        sku = "GL-" + "".join(w[0] for w in name.split()[:3]).upper() + f"-{len(slug):03d}{created:02d}"
        fragile = "highly_fragile" if shape in ("wine", "coupe", "orb", "lamp") else "fragile"
        p = Product(
            name=name, slug=slug, sku=sku, category_id=cats[cat].id, status="published", published_at=NOW,
            short_description=f"{gtype} in {color.lower()}, finished by hand.",
            description=(f"{name} is made from {gtype.lower()} and finished by hand, so small variations in tone "
                         "and the occasional seed bubble are part of its character.\n\nSample product created by "
                         "the seed script — replace with your own copy, photography and specifications."),
            glass_type=gtype, material="Glass", color=color, finish="Polished", dimensions=dims, capacity=cap,
            weight_grams=weight, package_weight_grams=int(weight * 1.6) + 300,
            package_length_cm=Decimal("30"), package_width_cm=Decimal("22"), package_height_cm=Decimal("22"),
            fragility=fragile,
            care_instructions="Hand wash in lukewarm water with mild detergent. Avoid sudden temperature changes. "
                              "Dry with a lint-free cloth.",
            price=Decimal(price), compare_at_price=Decimal(compare) if compare else None,
            sale_price=Decimal(sale) if sale else None,
            sale_ends_at=(NOW + timedelta(days=60)) if sale else None,
            tax_class="standard", hs_code="701399", country_of_origin="IN", low_stock_threshold=5,
            gift_wrap_available=True, gift_wrap_price=Decimal("150"), ships_internationally=shape != "lamp",
            search_keywords=f"{shape} {tint} {gtype} {color} glass", is_featured="feat" in flags,
            is_bestseller="best" in flags, is_new_arrival="new" in flags,
            badge="Bestseller" if "best" in flags else ("New" if "new" in flags else ("Sale" if sale else None)),
        )
        p.images = [ProductImage(url=f"/images/products/{shape}-{tint}.svg", alt_text=f"{name} — front view", position=0),
                    ProductImage(url=f"/images/products/{shape}-{tint}-alt.svg", alt_text=f"{name} — detail", position=1)]
        p.attributes = [ProductAttribute(name="Glass type", value=gtype, position=0),
                        ProductAttribute(name="Dishwasher safe", value="No — hand wash recommended", position=1),
                        ProductAttribute(name="Lead-free", value="Yes", position=2)]
        p.collections = [cols[s] for s in col_slugs if s in cols]
        v = ProductVariant(sku=sku, name="Default", is_default=True, position=0)
        p.variants.append(v)
        if shape == "tumbler" and tint == "clear":
            p.variants.append(ProductVariant(sku=sku + "-SMK", name="Smoke", options={"Colour": "Smoke"},
                                             price_override=Decimal(price) + 200, position=1))
        db.add(p)
        db.flush()
        for var in p.variants:
            qty = stock if var.is_default else max(6, stock // 3)
            var.inventory = Inventory(variant_id=var.id, on_hand=qty, reserved=0)
            db.add(InventoryMovement(variant_id=var.id, change=qty, reason="restock", note="Seed stock",
                                     on_hand_after=qty))
        created += 1
    print(f"  {created} sample products")


HOME_BLOCKS = [
    ("hero", "Glass, quietly considered", "Hand-finished vases, stemware and objects that hold the light.",
     "", "/images/hero/hero-main.svg", "/shop", "Shop the collection", 0, {}),
    ("campaign", "The Amber Edit", "Honeyed glass for warm evenings — a seasonal selection.",
     "", "/images/collections/the-amber-edit.svg", "/collections/the-amber-edit", "Discover the edit", 0, {}),
    ("banner", "Complimentary delivery", "On orders over ₹2,000 within India and ₹10,000 worldwide.",
     "", None, "/shipping-policy", "How delivery works", 0, {}),
    ("story", "A house of glass", "Our story",
     "We work with small studios and established glassworks to bring you pieces chosen for clarity, weight and "
     "craft. Each one is inspected before it leaves us.", "/images/hero/story.svg", "/about", "Read our story", 0, {}),
    ("craft", "Mouth-blown", "", "Shaped by breath and hand, so no two pieces are identical.", None, None, None, 0, {"icon": "wind"}),
    ("craft", "Inspected by hand", "", "Every piece is checked for clarity, seams and finish before dispatch.", None, None, None, 1, {"icon": "search-check"}),
    ("craft", "Lead-free crystal", "", "Brilliance without lead — safe for everyday use.", None, None, None, 2, {"icon": "gem"}),
    ("packaging", "Packed to arrive whole", "Fragile-first packaging",
     "Double-boxed with moulded pulp inserts and recyclable paper — no loose fill. If anything arrives damaged, "
     "report it within 48 hours with photos and we will make it right.", "/images/hero/packaging.svg",
     "/shipping-policy", "Delivery & packaging", 0, {}),
    ("faq", "Do you offer cash on delivery?", "",
     "No. Products are paid for online at checkout. For orders below the free-delivery threshold, the courier "
     "collects only the shipping charge from the recipient at delivery.", None, None, None, 0, {"group": "Payment"}),
    ("faq", "When is delivery free?", "",
     "Delivery is complimentary on orders of ₹2,000 or more within India and ₹10,000 or more for international "
     "destinations. Thresholds are calculated on your merchandise subtotal after discounts.", None, None, None, 1,
     {"group": "Delivery"}),
    ("faq", "Will I pay import duties on international orders?", "",
     "Possibly. Import duties, taxes and customs fees are set by the destination country, are not included in "
     "our prices, and are payable by the recipient.", None, None, None, 2, {"group": "Delivery"}),
    ("faq", "What if my glass arrives broken?", "",
     "Report it from your account within 48 hours of delivery with photos of the item and packaging. We will "
     "arrange a replacement or refund once reviewed.", None, None, None, 3, {"group": "Returns"}),
    ("faq", "Can I return an item?", "",
     "Unused items in original packaging can be returned within 7 days of delivery. Request a return from "
     "your order page.", None, None, None, 4, {"group": "Returns"}),
]

PAGES = {
    "about": ("About Us", "## A house of glass\n\nWe started with a simple belief: everyday objects deserve care. "
              "Our pieces come from small studios and established glassworks, chosen for clarity, weight and craft.\n\n"
              "## How we work\n\n- Every piece is inspected by hand before dispatch.\n- We pack fragile-first, "
              "with recyclable materials.\n- We describe each object honestly — including the small variations "
              "that come with handmade glass.\n\n*Replace this text in Admin › Content › Pages.*"),
    "shipping-policy": ("Shipping Policy", "## Delivery charges\n\n- **India:** complimentary delivery on "
                        "merchandise subtotals of ₹2,000 or more.\n- **International:** complimentary delivery on "
                        "merchandise subtotals of ₹10,000 or more.\n\nBelow these thresholds, your product amount is "
                        "paid online and the courier's shipping charge is **collected from the recipient at "
                        "delivery**. This is available only where our courier supports it; otherwise checkout will "
                        "ask you to reach the free-delivery threshold.\n\n## Cash on delivery\n\nProducts are always "
                        "paid for online. Product cash-on-delivery is not offered.\n\n## Dispatch\n\nOrders are "
                        "dispatched only after payment is verified, typically within 2 business days.\n\n## "
                        "International orders\n\nImport duties, taxes and customs fees are set by the destination "
                        "country, are not included in our prices, and are payable by the recipient.\n\n## Fragile "
                        "items\n\nAll glass is packed fragile-first. Some destinations or couriers may not accept "
                        "highly fragile items; these are flagged at checkout."),
    "returns-policy": ("Returns & Refunds", "## Returns\n\nUnused items in their original packaging may be returned "
                       "within 7 days of delivery. Request a return from your order page.\n\n## Damaged in transit\n\n"
                       "Report damage within 48 hours of delivery with photos of the item and packaging. Approved "
                       "claims receive a replacement or refund.\n\n## Refunds\n\nRefunds are issued to the original "
                       "payment method. Shipping fees paid to the courier at delivery are refunded only where the "
                       "return is due to our error or transit damage."),
    "privacy-policy": ("Privacy Policy", "## What we collect\n\nAccount details, delivery addresses, order history and "
                       "payment references (never full card numbers).\n\n## Why\n\nTo fulfil orders, provide support "
                       "and — only with your consent — send news.\n\n## Your rights\n\nYou can update your details, "
                       "withdraw marketing consent and request account deletion from your account.\n\n*Have this "
                       "policy reviewed by a legal professional before launch.*"),
    "terms": ("Terms & Conditions", "## Orders\n\nAn order is confirmed when payment is verified. Prices are in INR "
              "and include applicable taxes unless stated.\n\n## Payment\n\nProducts are paid online in full before "
              "dispatch. Product cash-on-delivery is not offered.\n\n## Delivery\n\nSee our Shipping Policy.\n\n"
              "*Have these terms reviewed by a legal professional before launch.*"),
    "cookie-policy": ("Cookie Policy", "We use strictly necessary cookies to keep you signed in and to run checkout. "
                      "Optional analytics cookies are used only if you allow them in Cookie Preferences."),
}


def seed_content(db):
    if not db.scalar(select(ContentBlock)):
        for placement, title, subtitle, body, img, link, label, pos, data in HOME_BLOCKS:
            db.add(ContentBlock(placement=placement, title=title, subtitle=subtitle, body=body, image_url=img,
                                link_url=link, link_label=label, position=pos, data=data))
    for slug, (title, body) in PAGES.items():
        if not db.scalar(select(CmsPage).where(CmsPage.slug == slug)):
            db.add(CmsPage(slug=slug, title=title, body=body))
    if not db.scalar(select(Coupon).where(Coupon.code == "WELCOME10")):
        db.add(Coupon(code="WELCOME10", description="10% off your first order", discount_type="percent",
                      value=Decimal("10"), max_discount_amount=Decimal("1000"), per_customer_limit=1))
    print("  homepage content, FAQs, policy pages, WELCOME10 coupon")


from app.core.demo import DEMO_ADMIN, DEMO_CUSTOMER  # noqa: E402


def seed_demo_accounts(db):
    """Local development only: a ready-to-use Super Admin and a verified customer."""
    from app.core.config import settings
    from app.core.security import hash_password
    from app.models import User
    if settings.is_production:
        print("  demo accounts skipped (production)")
        return
    super_admin = db.scalar(select(Role).where(Role.name == "Super Admin"))
    for email, pw, name, staff in [(*DEMO_ADMIN, True), (*DEMO_CUSTOMER, False)]:
        if db.scalar(select(User).where(User.email == email)):
            continue
        db.add(User(email=email, full_name=name, password_hash=hash_password(pw), is_staff=staff,
                    email_verified_at=NOW, roles=[super_admin] if staff else []))
    print(f"  demo accounts  admin: {DEMO_ADMIN[0]} / {DEMO_ADMIN[1]}   customer: {DEMO_CUSTOMER[0]} / {DEMO_CUSTOMER[1]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-products", action="store_true", help="Skip sample products")
    ap.add_argument("--demo-accounts", action="store_true", help="Create demo admin + customer logins (development only)")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        print("Seeding…")
        seed_rbac(db)
        seed_money(db)
        seed_shipping(db)
        seed_catalog_structure(db)
        if not args.no_products:
            seed_products(db)
        seed_content(db)
        if args.demo_accounts:
            db.flush()
            seed_demo_accounts(db)
        db.commit()
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
