"""Test setup. Uses a separate database (TEST_DATABASE_URL, default glass_ecom_test on the same server)
and the mock payment/shipping providers only. Live payment credentials are explicitly blanked."""
import os
from decimal import Decimal

os.environ["APP_ENV"] = "test"
os.environ["PAYMENT_PROVIDER"] = "mock"
os.environ["RAZORPAY_KEY_ID"] = ""
os.environ["RAZORPAY_KEY_SECRET"] = ""
os.environ["RAZORPAY_WEBHOOK_SECRET"] = ""
os.environ["SHIPPING_PROVIDER"] = "mock"
os.environ["STORAGE_PROVIDER"] = "local"
os.environ["EMAIL_PROVIDER"] = "console"
os.environ["LOCAL_UPLOAD_DIR"] = "./.test_uploads"
os.environ["PRIVATE_UPLOAD_DIR"] = "./.test_private"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789abcdef0123456789"


if os.environ.get("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
else:
    # Derive from backend/.env DATABASE_URL by swapping the database name for <name>_test
    from pathlib import Path
    env_file = Path(__file__).resolve().parents[1] / ".env"
    url = os.environ.get("DATABASE_URL", "")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    if not url:
        url = "postgresql+psycopg://postgres:password@localhost:5432/glass_store"
    base, _, name = url.rpartition("/")
    name = name.split("?")[0]
    os.environ["DATABASE_URL"] = f"{base}/{name}_test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()


def _ensure_database():
    url = make_url(os.environ["DATABASE_URL"])
    admin_url = url.set(database="postgres")
    eng = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        if not c.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": url.database}):
            c.execute(text(f'CREATE DATABASE "{url.database}"'))
    eng.dispose()


_ensure_database()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

_cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
_cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
command.upgrade(_cfg, "head")

from app.core.rate_limit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (Category, Inventory, Product, ProductVariant, Role, User)  # noqa: E402
from scripts import seed  # noqa: E402

TABLES = [t.name for t in reversed(Base.metadata.sorted_tables)]


@pytest.fixture(autouse=True)
def clean_db():
    with engine.begin() as c:
        c.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in TABLES) + " RESTART IDENTITY CASCADE"))
    db = SessionLocal()
    seed.seed_rbac(db)
    seed.seed_money(db)
    seed.seed_shipping(db)
    seed.seed_catalog_structure(db)
    seed.seed_content(db)
    db.commit()
    db.close()
    limiter.reset()
    yield


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture
def client():
    with TestClient(app) as c:
        c.headers.update({"X-Requested-With": "fetch"})
        yield c


def make_product(db, *, name="Test Vase", price="1000", stock=10, status="published", category_slug="bud-vases",
                 fragility="fragile", ships_internationally=True, sale_price=None, weight=500) -> ProductVariant:
    from app.services.text import slugify
    cat = db.query(Category).filter_by(slug=category_slug).one()
    p = Product(name=name, slug=slugify(name), sku="SKU-" + slugify(name).upper()[:20], category_id=cat.id,
                price=Decimal(price), status=status, fragility=fragility, ships_internationally=ships_internationally,
                sale_price=Decimal(sale_price) if sale_price else None, package_weight_grams=weight, tax_class="standard")
    v = ProductVariant(sku=p.sku, name="Default", is_default=True)
    p.variants.append(v)
    db.add(p)
    db.flush()
    v.inventory = Inventory(variant_id=v.id, on_hand=stock, reserved=0)
    db.commit()
    return v


def register(client, email="buyer@example.com", password="Password12345", verify=True) -> str:
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password, "full_name": "Test Buyer",
                                                   "accept_terms": True})
    assert r.status_code == 201, r.text
    if verify:
        s = SessionLocal()
        u = s.query(User).filter_by(email=email).one()
        from datetime import datetime, timezone
        u.email_verified_at = datetime.now(timezone.utc)
        s.commit()
        s.close()
    return r.json()["access_token"]


def make_admin(role="Super Admin", email="admin@example.com", password="AdminPass12345") -> None:
    s = SessionLocal()
    r = s.query(Role).filter_by(name=role).one()
    s.add(User(email=email, full_name="Admin", password_hash=hash_password(password), is_staff=True, roles=[r]))
    s.commit()
    s.close()


def admin_token(client, role="Super Admin", email="admin@example.com") -> str:
    make_admin(role, email)
    r = client.post("/api/v1/auth/admin/login", json={"email": email, "password": "AdminPass12345"})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


IN_ADDRESS = {"full_name": "Asha Rao", "phone": "+919800000000", "line1": "12 Park Street", "city": "Kolkata",
              "state": "WB", "postal_code": "700016", "country_code": "IN"}
US_ADDRESS = {"full_name": "Sam Lee", "phone": "+12125550100", "line1": "1 Main St", "city": "New York",
              "state": "NY", "postal_code": "10001", "country_code": "US"}


def place_order(client, token, variant_id, qty=1, address=None, coupon=None, customs=False):
    r = client.post("/api/v1/customer/cart/items", json={"variant_id": variant_id, "quantity": qty}, headers=auth(token))
    assert r.status_code == 201, r.text
    body = {"address": address or IN_ADDRESS, "accept_shipping_terms": True, "accept_customs_terms": customs}
    if coupon:
        body["coupon_code"] = coupon
    return client.post("/api/v1/customer/checkout/orders", json=body, headers=auth(token))


def pay(client, token, order_number, outcome="success", **kw):
    r = client.post("/api/v1/payments/create", json={"order_number": order_number}, headers=auth(token))
    assert r.status_code == 200, r.text
    po = r.json()["provider_order_id"]
    r = client.post("/api/v1/payments/mock/complete", json={"provider_order_id": po, "outcome": outcome, **kw},
                    headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()
