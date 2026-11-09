import csv
import io
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import request_ip, require
from app.core.errors import BusinessRuleError, Conflict, NotFound
from app.db.session import get_db
from app.integrations.storage import get_public_storage
from app.models import (Category, Collection, Inventory, OrderItem, Product, ProductAttribute, ProductImage,
                        ProductVariant, UploadMetadata, User)
from app.schemas.admin import (CategoryIn, CategoryPatch, CollectionIn, ImagePatch, ImageUrlIn, ProductCreate,
                               ProductPatch, ReorderIn, StatusIn, VariantIn, VariantPatch)
from app.schemas.serializers import category_out, product_card, product_detail
from app.services import inventory as inv_svc
from app.services import site_settings
from app.services.audit import audit
from app.services.catalog import product_available_qty
from app.services.text import slugify, unique_slug
from app.services.uploads import read_image

router = APIRouter(tags=["admin-catalog"])


def _now():
    return datetime.now(timezone.utc)


def _product(db: Session, product_id: int) -> Product:
    p = db.get(Product, product_id)
    if not p or p.deleted_at:
        raise NotFound("Product not found")
    return p


def _snapshot(p: Product) -> dict:
    return {"name": p.name, "sku": p.sku, "price": p.price, "compare_at_price": p.compare_at_price,
            "sale_price": p.sale_price, "status": p.status, "category_id": p.category_id}


# ======================================================================= products

@router.get("/products")
def list_products(db: Session = Depends(get_db), _: User = Depends(require("products.read")),
                  q: str | None = Query(None, max_length=100), status: str | None = None,
                  category_id: int | None = None, stock: str | None = Query(None, pattern="^(low|out)$"),
                  page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)):
    stmt = select(Product).where(Product.deleted_at.is_(None))
    if q:
        pat = f"%{q}%"
        stmt = stmt.where(or_(Product.name.ilike(pat), Product.sku.ilike(pat), Product.slug.ilike(pat)))
    if status:
        stmt = stmt.where(Product.status == status)
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    rows = db.scalars(stmt.order_by(Product.updated_at.desc())).unique().all()
    if stock:
        def state(p):
            a = product_available_qty(p)
            return "out" if a <= 0 else ("low" if a <= p.low_stock_threshold else "ok")
        rows = [p for p in rows if state(p) == stock]
    total = len(rows)
    rows = rows[(page - 1) * page_size: page * page_size]
    items = []
    for p in rows:
        c = product_card(p)
        c.update({"status": p.status, "available": product_available_qty(p),
                  "on_hand": sum((v.inventory.on_hand if v.inventory else 0) for v in p.variants),
                  "low_stock_threshold": p.low_stock_threshold, "updated_at": p.updated_at.isoformat()})
        items.append(c)
    return {"items": items, "total": total, "page": page, "pages": (total + page_size - 1) // page_size}


@router.get("/products/{product_id}")
def get_product(product_id: int, db: Session = Depends(get_db), _: User = Depends(require("products.read"))):
    return product_detail(_product(db, product_id), admin=True)


def _apply_product_fields(db: Session, p: Product, data: dict) -> None:
    collection_ids = data.pop("collection_ids", None)
    attributes = data.pop("attributes", None)
    if "category_id" in data and data["category_id"] is not None and not db.get(Category, data["category_id"]):
        raise BusinessRuleError("Category does not exist")
    if "slug" in data and data["slug"]:
        data["slug"] = unique_slug(db, Product, data["slug"], exclude_id=p.id)
    for k, v in data.items():
        setattr(p, k, v)
    if p.compare_at_price is not None and p.compare_at_price <= 0:
        p.compare_at_price = None
    if p.sale_price is not None and p.sale_price >= p.price:
        raise BusinessRuleError("Sale price must be lower than the regular price.")
    if p.sale_starts_at and p.sale_ends_at and p.sale_ends_at <= p.sale_starts_at:
        raise BusinessRuleError("Sale end must be after sale start.")
    if collection_ids is not None:
        p.collections = list(db.scalars(select(Collection).where(Collection.id.in_(collection_ids))).all())
    if attributes is not None:
        p.attributes.clear()
        db.flush()
        for i, a in enumerate(attributes[:30]):
            name, value = str(a.get("name", "")).strip()[:80], str(a.get("value", "")).strip()[:255]
            if name and value:
                p.attributes.append(ProductAttribute(name=name, value=value, position=i))


@router.post("/products", status_code=201)
def create_product(body: ProductCreate, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(require("products.write"))):
    data = body.model_dump(exclude_unset=True)
    initial = data.pop("initial_stock", 0)
    status = data.pop("status", None) or site_settings.catalog(db).default_product_status
    if status == "published" and "products.publish" not in admin.permission_codes:
        status = "draft"
    if db.scalar(select(Product.id).where(Product.sku == body.sku)) or \
            db.scalar(select(ProductVariant.id).where(ProductVariant.sku == body.sku)):
        raise Conflict("SKU already exists")
    p = Product(name=body.name, sku=body.sku, price=body.price,
                slug=unique_slug(db, Product, body.slug or body.name), status=status,
                low_stock_threshold=site_settings.catalog(db).default_low_stock_threshold)
    db.add(p)
    data.pop("slug", None)
    _apply_product_fields(db, p, data)
    if status == "published":
        p.published_at = _now()
    v = ProductVariant(sku=body.sku, name="Default", is_default=True, position=0)
    p.variants.append(v)
    db.flush()
    v.inventory = Inventory(variant_id=v.id, on_hand=0, reserved=0)
    db.flush()
    if initial:
        inv_svc.adjust(db, v.id, set_to=initial, reason="restock", note="Initial stock", actor=admin)
    audit(db, admin, "product.create", "product", p.id, after=_snapshot(p), ip=request_ip(request))
    db.commit()
    return product_detail(p, admin=True)


@router.patch("/products/{product_id}")
def update_product(product_id: int, body: ProductPatch, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    before = _snapshot(p)
    data = body.model_dump(exclude_unset=True)
    if "sku" in data and data["sku"] != p.sku:
        if db.scalar(select(Product.id).where(Product.sku == data["sku"], Product.id != p.id)):
            raise Conflict("SKU already exists")
        dv = next((v for v in p.variants if v.is_default), None)
        if dv and dv.sku == p.sku:
            if db.scalar(select(ProductVariant.id).where(ProductVariant.sku == data["sku"], ProductVariant.id != dv.id)):
                raise Conflict("SKU already exists")
            dv.sku = data["sku"]
    if data.get("price") is None and "price" in data:
        raise BusinessRuleError("Price is required")
    _apply_product_fields(db, p, data)
    after = _snapshot(p)
    if before != after:
        audit(db, admin, "product.update", "product", p.id, before=before, after=after, ip=request_ip(request))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("Slug or SKU already in use")
    return product_detail(p, admin=True)


@router.post("/products/{product_id}/status")
def set_product_status(product_id: int, body: StatusIn, request: Request, db: Session = Depends(get_db),
                       admin: User = Depends(require("products.publish"))):
    p = _product(db, product_id)
    if body.status == "published":
        problems = []
        if p.price is None or p.price <= 0:
            problems.append("Set a price above zero.")
        if not any(v.is_active for v in p.variants):
            problems.append("At least one active variant is required.")
        if not p.category_id:
            problems.append("Assign a category.")
        if problems:
            raise BusinessRuleError("Product cannot be published yet.", details=problems)
        p.published_at = p.published_at or _now()
    old = p.status
    p.status = body.status
    audit(db, admin, "product.status", "product", p.id, before={"status": old}, after={"status": body.status},
          ip=request_ip(request))
    db.commit()
    return product_detail(p, admin=True)


@router.delete("/products/{product_id}")
def delete_product(product_id: int, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(require("products.publish"))):
    p = _product(db, product_id)
    has_orders = db.scalar(select(func.count()).select_from(OrderItem).where(OrderItem.product_id == p.id))
    reserved = sum((v.inventory.reserved if v.inventory else 0) for v in p.variants)
    if reserved:
        raise BusinessRuleError("This product has stock reserved by pending orders. Try again later.")
    if has_orders:
        p.status = "archived"
        p.deleted_at = _now()
        action, result = "product.archive_delete", "archived"
    else:
        storage = get_public_storage()
        for img in p.images:
            if img.storage_key:
                try:
                    storage.delete_public(img.storage_key, img.url)
                except Exception:
                    pass
        db.delete(p)
        action, result = "product.delete", "deleted"
    audit(db, admin, action, "product", product_id, before={"name": p.name, "sku": p.sku}, ip=request_ip(request))
    db.commit()
    return {"ok": True, "result": result,
            "message": "Product has order history, so it was archived and hidden instead of erased." if result == "archived" else None}


# ---------------------------------------------------------------- images

@router.post("/products/{product_id}/images", status_code=201)
def upload_image(product_id: int, file: UploadFile = File(...), alt_text: str = Form("", max_length=255),
                 db: Session = Depends(get_db), admin: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    if len(p.images) >= 15:
        raise BusinessRuleError("Up to 15 media items per product.")
    data, ctype, ext = read_image(file)
    storage = get_public_storage()
    stored = storage.save_public(data, f"products/{p.id}", ext, ctype)
    db.add(UploadMetadata(storage_provider=storage.provider, storage_key=stored.key, url=stored.url,
                          content_type=ctype, size_bytes=len(data), visibility="public", purpose="product_image",
                          owner_user_id=admin.id, original_filename=(file.filename or "")[:255]))
    p.images.append(ProductImage(url=stored.url, storage_key=stored.key, alt_text=alt_text or p.name,
                                 position=len(p.images)))
    audit(db, admin, "product.image_add", "product", p.id, after={"url": stored.url})
    db.commit()
    return product_detail(p, admin=True)


@router.post("/products/{product_id}/media-url", status_code=201)
def add_media_url(product_id: int, body: ImageUrlIn, db: Session = Depends(get_db),
                  admin: User = Depends(require("products.write"))):
    """Attach an already-hosted image or video URL (e.g. a video on a CDN)."""
    p = _product(db, product_id)
    if not (body.url.startswith("https://") or body.url.startswith("/")):
        raise BusinessRuleError("Media URL must be https:// or a site-relative path.")
    p.images.append(ProductImage(url=body.url, alt_text=body.alt_text or p.name, media_type=body.media_type,
                                 position=len(p.images)))
    db.commit()
    return product_detail(p, admin=True)


@router.patch("/products/{product_id}/images/{image_id}")
def update_image(product_id: int, image_id: int, body: ImagePatch, db: Session = Depends(get_db),
                 _: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise NotFound("Image not found")
    if body.alt_text is not None:
        img.alt_text = body.alt_text
    db.commit()
    return product_detail(p, admin=True)


@router.post("/products/{product_id}/images/{image_id}/replace")
def replace_image(product_id: int, image_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                  admin: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise NotFound("Image not found")
    data, ctype, ext = read_image(file)
    storage = get_public_storage()
    stored = storage.save_public(data, f"products/{p.id}", ext, ctype)
    old_key, old_url = img.storage_key, img.url
    img.url, img.storage_key, img.media_type = stored.url, stored.key, "image"
    db.add(UploadMetadata(storage_provider=storage.provider, storage_key=stored.key, url=stored.url,
                          content_type=ctype, size_bytes=len(data), purpose="product_image", owner_user_id=admin.id))
    db.commit()
    if old_key:  # delete the old file only after the DB points at the new one
        try:
            storage.delete_public(old_key, old_url)
        except Exception:
            pass
    return product_detail(p, admin=True)


@router.post("/products/{product_id}/images/reorder")
def reorder_images(product_id: int, body: ReorderIn, db: Session = Depends(get_db),
                   _: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    pos = {iid: i for i, iid in enumerate(body.ids)}
    for img in p.images:
        img.position = pos.get(img.id, len(pos) + img.position)
    db.commit()
    db.refresh(p)
    return product_detail(p, admin=True)


@router.delete("/products/{product_id}/images/{image_id}")
def delete_image(product_id: int, image_id: int, db: Session = Depends(get_db),
                 admin: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    img = next((i for i in p.images if i.id == image_id), None)
    if not img:
        raise NotFound("Image not found")
    key, url = img.storage_key, img.url
    p.images.remove(img)
    for meta in db.scalars(select(UploadMetadata).where(UploadMetadata.storage_key == key)).all() if key else []:
        meta.deleted_at = _now()
    audit(db, admin, "product.image_remove", "product", p.id, before={"url": url})
    db.commit()
    if key:
        try:
            get_public_storage().delete_public(key, url)
        except Exception:
            pass
    return product_detail(p, admin=True)


# ---------------------------------------------------------------- variants

@router.post("/products/{product_id}/variants", status_code=201)
def add_variant(product_id: int, body: VariantIn, db: Session = Depends(get_db),
                admin: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    if db.scalar(select(ProductVariant.id).where(ProductVariant.sku == body.sku)):
        raise Conflict("Variant SKU already exists")
    v = ProductVariant(sku=body.sku, name=body.name, options=body.options, price_override=body.price_override,
                       is_active=body.is_active, position=body.position, is_default=False)
    p.variants.append(v)
    db.flush()
    v.inventory = Inventory(variant_id=v.id, on_hand=0, reserved=0)
    db.flush()
    if body.initial_stock:
        inv_svc.adjust(db, v.id, set_to=body.initial_stock, reason="restock", note="Initial stock", actor=admin)
    db.commit()
    return product_detail(p, admin=True)


@router.patch("/products/{product_id}/variants/{variant_id}")
def update_variant(product_id: int, variant_id: int, body: VariantPatch, db: Session = Depends(get_db),
                   _: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    v = next((x for x in p.variants if x.id == variant_id), None)
    if not v:
        raise NotFound("Variant not found")
    data = body.model_dump(exclude_unset=True)
    if data.pop("clear_price_override", False):
        v.price_override = None
    if data.get("is_default"):
        for x in p.variants:
            x.is_default = False
    if data.get("sku") and data["sku"] != v.sku and db.scalar(select(ProductVariant.id).where(ProductVariant.sku == data["sku"])):
        raise Conflict("Variant SKU already exists")
    for k, val in data.items():
        setattr(v, k, val)
    if v.is_default and not v.is_active:
        raise BusinessRuleError("The default variant must stay active. Make another variant default first.")
    db.commit()
    return product_detail(p, admin=True)


@router.delete("/products/{product_id}/variants/{variant_id}")
def delete_variant(product_id: int, variant_id: int, db: Session = Depends(get_db),
                   _: User = Depends(require("products.write"))):
    p = _product(db, product_id)
    v = next((x for x in p.variants if x.id == variant_id), None)
    if not v:
        raise NotFound("Variant not found")
    if v.is_default:
        raise BusinessRuleError("The default variant cannot be removed.")
    used = db.scalar(select(func.count()).select_from(OrderItem).where(OrderItem.variant_id == v.id))
    if used or (v.inventory and v.inventory.reserved):
        v.is_active = False  # keep history intact
    else:
        p.variants.remove(v)
    db.commit()
    return product_detail(p, admin=True)


# ---------------------------------------------------------------- import / export

EXPORT_FIELDS = ["sku", "name", "slug", "status", "category_slug", "price", "compare_at_price", "sale_price",
                 "stock", "short_description", "description", "glass_type", "material", "color", "finish",
                 "dimensions", "capacity", "weight_grams", "package_weight_grams", "fragility", "care_instructions",
                 "tax_class", "hs_code", "country_of_origin", "ships_internationally", "is_featured",
                 "is_bestseller", "is_new_arrival", "search_keywords", "seo_title", "seo_description"]


def _export_rows(db: Session):
    for p in db.scalars(select(Product).where(Product.deleted_at.is_(None)).order_by(Product.id)).unique().all():
        dv = next((v for v in p.variants if v.is_default), None)
        yield [p.sku, p.name, p.slug, p.status, p.category.slug if p.category else "", p.price,
               p.compare_at_price or "", p.sale_price or "", dv.inventory.on_hand if dv and dv.inventory else 0,
               p.short_description, p.description, p.glass_type or "", p.material or "", p.color or "",
               p.finish or "", p.dimensions or "", p.capacity or "", p.weight_grams or "",
               p.package_weight_grams or "", p.fragility, p.care_instructions, p.tax_class, p.hs_code or "",
               p.country_of_origin, p.ships_internationally, p.is_featured, p.is_bestseller, p.is_new_arrival,
               p.search_keywords, p.seo_title or "", p.seo_description or ""]


def _csv_safe(v):
    """Neutralise spreadsheet formula injection in exported text cells."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") and not s.replace(".", "", 1).lstrip("-").isdigit() else s


@router.get("/products-export")
def export_products(format: str = Query("csv", pattern="^(csv|xlsx)$"), db: Session = Depends(get_db),
                    admin: User = Depends(require("products.read"))):
    audit(db, admin, "product.export", "product", None, after={"format": format})
    db.commit()
    if format == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Products"
        ws.append(EXPORT_FIELDS)
        for row in _export_rows(db):
            ws.append([_csv_safe(c) if isinstance(c, str) else (str(c) if isinstance(c, Decimal) else c) for c in row])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": "attachment; filename=products.xlsx"})
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_FIELDS)
    for row in _export_rows(db):
        w.writerow([_csv_safe(c) for c in row])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=products.csv"})


def _parse_rows(file: UploadFile) -> list[dict]:
    raw = file.file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise BusinessRuleError("Import file too large (max 10 MB).")
    name = (file.filename or "").lower()
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h or "").strip() for h in rows[0]]
        return [{headers[i]: ("" if c is None else str(c)) for i, c in enumerate(r) if i < len(headers)}
                for r in rows[1:] if any(c not in (None, "") for c in r)]
    if name.endswith(".csv"):
        text = raw.decode("utf-8-sig")
        return list(csv.DictReader(io.StringIO(text)))
    raise BusinessRuleError("Upload a .csv or .xlsx file.")


def _b(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "y")


def _dec(v: str, field: str) -> Decimal | None:
    v = str(v or "").strip().lstrip("'")
    if not v:
        return None
    try:
        d = Decimal(v)
    except InvalidOperation:
        raise ValueError(f"{field} is not a number")
    if d < 0:
        raise ValueError(f"{field} cannot be negative")
    return d.quantize(Decimal("0.01"))


@router.post("/products-import")
def import_products(file: UploadFile = File(...), dry_run: bool = Form(True), db: Session = Depends(get_db),
                    admin: User = Depends(require("products.write"))):
    """Upsert by SKU. Validates every row first; with dry_run=true nothing is saved."""
    rows = _parse_rows(file)
    if len(rows) > 5000:
        raise BusinessRuleError("Import up to 5000 rows at a time.")
    cats = {c.slug: c.id for c in db.scalars(select(Category)).all()}
    errors, created, updated = [], 0, 0
    can_publish = "products.publish" in admin.permission_codes
    for idx, r in enumerate(rows, start=2):
        sp = db.begin_nested()
        try:
            sku = (r.get("sku") or "").strip()
            name = (r.get("name") or "").strip()
            if not sku or not name:
                raise ValueError("sku and name are required")
            price = _dec(r.get("price"), "price")
            if price is None:
                raise ValueError("price is required")
            cat_slug = (r.get("category_slug") or "").strip()
            if cat_slug and cat_slug not in cats:
                raise ValueError(f"unknown category_slug '{cat_slug}'")
            status = (r.get("status") or "draft").strip()
            if status not in ("draft", "published", "archived"):
                raise ValueError("status must be draft/published/archived")
            if status == "published" and not can_publish:
                status = "draft"
            fragility = (r.get("fragility") or "fragile").strip()
            if fragility not in ("standard", "fragile", "highly_fragile"):
                raise ValueError("invalid fragility")
            stock_raw = str(r.get("stock") or "").strip()
            stock = int(float(stock_raw)) if stock_raw else None
            if stock is not None and stock < 0:
                raise ValueError("stock cannot be negative")
            sale = _dec(r.get("sale_price"), "sale_price")
            if sale is not None and sale >= price:
                raise ValueError("sale_price must be below price")
            p = db.scalar(select(Product).where(Product.sku == sku))
            if p is None:
                p = Product(sku=sku, name=name, price=price, slug=unique_slug(db, Product, r.get("slug") or name),
                            status=status)
                db.add(p)
                v = ProductVariant(sku=sku, name="Default", is_default=True)
                p.variants.append(v)
                db.flush()
                v.inventory = Inventory(variant_id=v.id, on_hand=0, reserved=0)
                created += 1
            else:
                updated += 1
            p.name, p.price, p.status = name, price, status
            p.category_id = cats.get(cat_slug) if cat_slug else p.category_id
            p.compare_at_price = _dec(r.get("compare_at_price"), "compare_at_price")
            p.sale_price = sale
            for f in ("short_description", "description", "glass_type", "material", "color", "finish", "dimensions",
                      "capacity", "care_instructions", "search_keywords", "seo_title", "seo_description", "hs_code"):
                if f in r and r[f] is not None:
                    setattr(p, f, str(r[f]).strip().lstrip("'") or (None if f in ("hs_code", "seo_title", "seo_description") else ""))
            for f in ("weight_grams", "package_weight_grams"):
                if str(r.get(f) or "").strip():
                    setattr(p, f, int(float(r[f])))
            p.fragility = fragility
            if r.get("tax_class"):
                p.tax_class = r["tax_class"].strip()
            if r.get("country_of_origin"):
                p.country_of_origin = r["country_of_origin"].strip().upper()[:2]
            for f in ("ships_internationally", "is_featured", "is_bestseller", "is_new_arrival"):
                if f in r and str(r[f]).strip():
                    setattr(p, f, _b(r[f]))
            if status == "published" and not p.published_at:
                p.published_at = _now()
            db.flush()
            if stock is not None:
                dv = next(v for v in p.variants if v.is_default)
                inv_svc.adjust(db, dv.id, set_to=max(stock, dv.inventory.reserved if dv.inventory else 0),
                               reason="adjustment", note="Catalog import", actor=admin)
            sp.commit()
        except (ValueError, BusinessRuleError, IntegrityError) as e:
            sp.rollback()
            msg = getattr(e, "message", None) or ("duplicate SKU or slug" if isinstance(e, IntegrityError) else str(e))
            errors.append({"row": idx, "sku": r.get("sku"), "error": msg})
    if errors or dry_run:
        db.rollback()
        return {"dry_run": dry_run, "valid": not errors, "errors": errors[:200], "would_create": created,
                "would_update": updated, "rows": len(rows)}
    audit(db, admin, "product.import", "product", None, after={"created": created, "updated": updated})
    db.commit()
    return {"dry_run": False, "valid": True, "created": created, "updated": updated, "rows": len(rows), "errors": []}


# ======================================================================= categories

def _category(db: Session, cid: int) -> Category:
    c = db.get(Category, cid)
    if not c:
        raise NotFound("Category not found")
    return c


def _cat_admin(db: Session, c: Category) -> dict:
    d = category_out(c)
    d["product_count"] = db.scalar(select(func.count()).select_from(Product).where(
        Product.category_id == c.id, Product.deleted_at.is_(None))) or 0
    d["children_count"] = len(c.children)
    return d


@router.get("/categories")
def list_categories(db: Session = Depends(get_db), _: User = Depends(require("products.read"))):
    rows = db.scalars(select(Category).order_by(Category.parent_id.nulls_first(), Category.position, Category.name)).all()
    return [_cat_admin(db, c) for c in rows]


@router.post("/categories", status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db), admin: User = Depends(require("categories.write"))):
    if body.parent_id:
        _category(db, body.parent_id)
    c = Category(**body.model_dump(exclude={"slug"}), slug=unique_slug(db, Category, body.slug or body.name))
    db.add(c)
    db.flush()
    audit(db, admin, "category.create", "category", c.id, after={"name": c.name})
    db.commit()
    return _cat_admin(db, c)


@router.patch("/categories/{cid}")
def update_category(cid: int, body: CategoryPatch, db: Session = Depends(get_db),
                    admin: User = Depends(require("categories.write"))):
    c = _category(db, cid)
    data = body.model_dump(exclude_unset=True)
    if "parent_id" in data and data["parent_id"] is not None:
        parent = _category(db, data["parent_id"])
        node = parent
        while node is not None:
            if node.id == c.id:
                raise BusinessRuleError("A category cannot be moved inside itself.")
            node = node.parent
    if data.get("slug"):
        data["slug"] = unique_slug(db, Category, data["slug"], exclude_id=c.id)
    before = category_out(c)
    for k, v in data.items():
        setattr(c, k, v)
    audit(db, admin, "category.update", "category", c.id, before=before, after=category_out(c))
    db.commit()
    return _cat_admin(db, c)


@router.post("/categories/reorder")
def reorder_categories(body: ReorderIn, db: Session = Depends(get_db), _: User = Depends(require("categories.write"))):
    for i, cid in enumerate(body.ids):
        c = db.get(Category, cid)
        if c:
            c.position = i
    db.commit()
    return {"ok": True}


@router.delete("/categories/{cid}")
def delete_category(cid: int, db: Session = Depends(get_db), admin: User = Depends(require("categories.write"))):
    c = _category(db, cid)
    n_products = db.scalar(select(func.count()).select_from(Product).where(Product.category_id == c.id)) or 0
    if n_products:
        raise BusinessRuleError(f"{n_products} products are assigned to this category. Reassign them or archive "
                                "the category instead.", code="category_in_use")
    if c.children:
        raise BusinessRuleError("This category has subcategories. Move or delete them first.", code="category_in_use")
    audit(db, admin, "category.delete", "category", c.id, before={"name": c.name, "slug": c.slug})
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.post("/categories/{cid}/reassign")
def reassign_products(cid: int, target_id: int = Query(...), db: Session = Depends(get_db),
                      admin: User = Depends(require("categories.write"))):
    _category(db, cid)
    _category(db, target_id)
    rows = db.scalars(select(Product).where(Product.category_id == cid)).unique().all()
    for p in rows:
        p.category_id = target_id
    audit(db, admin, "category.reassign", "category", cid, after={"target": target_id, "count": len(rows)})
    db.commit()
    return {"ok": True, "moved": len(rows)}


@router.post("/uploads/image", status_code=201)
def upload_content_image(file: UploadFile = File(...), purpose: str = Form("content", pattern="^(content|category_image|brand)$"),
                         db: Session = Depends(get_db), admin: User = Depends(require("content.write"))):
    data, ctype, ext = read_image(file)
    storage = get_public_storage()
    stored = storage.save_public(data, purpose, ext, ctype)
    db.add(UploadMetadata(storage_provider=storage.provider, storage_key=stored.key, url=stored.url,
                          content_type=ctype, size_bytes=len(data), purpose=purpose, owner_user_id=admin.id,
                          original_filename=(file.filename or "")[:255]))
    db.commit()
    return {"url": stored.url, "key": stored.key}


# ======================================================================= collections

def _col_out(db: Session, c: Collection) -> dict:
    from app.models import ProductCollection
    return {"id": c.id, "name": c.name, "slug": c.slug, "kind": c.kind, "description": c.description,
            "image_url": c.image_url, "is_visible": c.is_visible, "position": c.position,
            "starts_at": c.starts_at.isoformat() if c.starts_at else None,
            "ends_at": c.ends_at.isoformat() if c.ends_at else None,
            "product_count": db.scalar(select(func.count()).select_from(ProductCollection)
                                       .where(ProductCollection.collection_id == c.id)) or 0}


@router.get("/collections")
def list_collections(db: Session = Depends(get_db), _: User = Depends(require("products.read"))):
    return [_col_out(db, c) for c in db.scalars(select(Collection).order_by(Collection.position)).all()]


@router.post("/collections", status_code=201)
def create_collection(body: CollectionIn, db: Session = Depends(get_db), admin: User = Depends(require("categories.write"))):
    c = Collection(**body.model_dump(exclude={"slug"}), slug=unique_slug(db, Collection, body.slug or body.name))
    db.add(c)
    db.flush()
    audit(db, admin, "collection.create", "collection", c.id, after={"name": c.name})
    db.commit()
    return _col_out(db, c)


@router.put("/collections/{col_id}")
def update_collection(col_id: int, body: CollectionIn, db: Session = Depends(get_db),
                      admin: User = Depends(require("categories.write"))):
    c = db.get(Collection, col_id)
    if not c:
        raise NotFound("Collection not found")
    for k, v in body.model_dump(exclude={"slug"}).items():
        setattr(c, k, v)
    if body.slug and body.slug != c.slug:
        c.slug = unique_slug(db, Collection, body.slug, exclude_id=c.id)
    audit(db, admin, "collection.update", "collection", c.id, after={"name": c.name})
    db.commit()
    return _col_out(db, c)


@router.delete("/collections/{col_id}")
def delete_collection(col_id: int, db: Session = Depends(get_db), admin: User = Depends(require("categories.write"))):
    c = db.get(Collection, col_id)
    if not c:
        raise NotFound("Collection not found")
    audit(db, admin, "collection.delete", "collection", c.id, before={"name": c.name})
    db.delete(c)
    db.commit()
    return {"ok": True}
