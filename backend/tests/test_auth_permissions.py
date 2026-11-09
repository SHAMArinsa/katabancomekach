from tests.conftest import admin_token, auth, make_product, register


def test_register_login_refresh_logout(client):
    token = register(client, verify=False)
    assert client.get("/api/v1/auth/me", headers=auth(token)).json()["email"] == "buyer@example.com"
    r = client.post("/api/v1/auth/login", json={"email": "buyer@example.com", "password": "wrong-password1"})
    assert r.status_code == 401
    r = client.post("/api/v1/auth/login", json={"email": "BUYER@example.com", "password": "Password12345"})
    assert r.status_code == 200
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200 and r.json()["access_token"]
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_refresh_requires_csrf_header(client):
    register(client)
    r = client.post("/api/v1/auth/refresh", headers={"X-Requested-With": ""})
    assert r.status_code == 403


def test_refresh_token_reuse_revokes_family(client):
    register(client)
    old = client.cookies.get("gl_rt_customer")
    assert client.post("/api/v1/auth/refresh").status_code == 200
    client.cookies.set("gl_rt_customer", old, path="/api/v1/auth")
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_weak_password_and_duplicate_email(client):
    r = client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": "short", "full_name": "A",
                                                   "accept_terms": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "weak_password"
    register(client, email="a@example.com")
    r = client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": "Password12345",
                                                   "full_name": "A", "accept_terms": True})
    assert r.status_code == 409


def test_password_reset_flow(client):
    from app.integrations.email import console_outbox
    register(client)
    client.post("/api/v1/auth/forgot-password", json={"email": "buyer@example.com"})
    link = [m for m in console_outbox() if "Reset" in m["subject"]][-1]["body"]
    token = link.split("token=")[1].split()[0]
    r = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "NewPassword123"})
    assert r.status_code == 200
    assert client.post("/api/v1/auth/login", json={"email": "buyer@example.com", "password": "NewPassword123"}).status_code == 200
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "password": "Another123456"}).status_code == 422


def test_customer_token_cannot_access_admin(client):
    token = register(client)
    assert client.get("/api/v1/admin/dashboard", headers=auth(token)).status_code == 401


def test_admin_token_cannot_access_customer_routes(client):
    t = admin_token(client)
    assert client.get("/api/v1/customer/cart", headers=auth(t)).status_code == 401


def test_staff_cannot_login_to_storefront(client):
    admin_token(client)
    r = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "AdminPass12345"})
    assert r.status_code == 403


def test_customer_cannot_login_to_admin(client):
    register(client)
    r = client.post("/api/v1/auth/admin/login", json={"email": "buyer@example.com", "password": "Password12345"})
    assert r.status_code == 401


def test_role_based_permissions(client):
    t = admin_token(client, role="Inventory Manager", email="inv@example.com")
    assert client.get("/api/v1/admin/inventory", headers=auth(t)).status_code == 200
    r = client.patch("/api/v1/admin/settings/shipping", json={"domestic_free_threshold": "1"}, headers=auth(t))
    assert r.status_code == 403
    assert client.get("/api/v1/admin/staff", headers=auth(t)).status_code == 403
    r = client.post("/api/v1/admin/products", json={"name": "X", "sku": "X1", "price": "10"}, headers=auth(t))
    assert r.status_code == 403


def test_product_manager_cannot_change_payment_settings(client):
    t = admin_token(client, role="Product Manager", email="pm@example.com")
    r = client.patch("/api/v1/admin/settings/payment", json={"mode": "test"}, headers=auth(t))
    assert r.status_code == 403


def test_support_manager_without_pii_sees_masked_emails(client, db):
    register(client, email="private.person@example.com")
    from app.models import Permission, Role
    role = Role(name="Read-only support", permissions=[db.query(Permission).filter_by(code="customers.read").one()])
    db.add(role)
    db.commit()
    from tests.conftest import make_admin
    make_admin("Read-only support", "ro@example.com")
    t = client.post("/api/v1/auth/admin/login", json={"email": "ro@example.com", "password": "AdminPass12345"}).json()["access_token"]
    items = client.get("/api/v1/admin/customers", headers=auth(t)).json()["items"]
    assert items and "private.person@example.com" not in items[0]["email"]


def test_account_lockout(client):
    register(client)
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"email": "buyer@example.com", "password": "nope-nope-1"})
    r = client.post("/api/v1/auth/login", json={"email": "buyer@example.com", "password": "Password12345"})
    assert r.status_code == 423


def test_admin_mfa(client):
    from app.core.security import totp_now
    t = admin_token(client)
    secret = client.post("/api/v1/admin/me/mfa/setup", headers=auth(t)).json()["secret"]
    assert client.post("/api/v1/admin/me/mfa/enable", json={"code": totp_now(secret)}, headers=auth(t)).status_code == 200
    r = client.post("/api/v1/auth/admin/login", json={"email": "admin@example.com", "password": "AdminPass12345"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_required"
    r = client.post("/api/v1/auth/admin/login", json={"email": "admin@example.com", "password": "AdminPass12345",
                                                      "mfa_code": totp_now(secret)})
    assert r.status_code == 200


def test_restricted_customer_blocked(client, db):
    token = register(client)
    t = admin_token(client)
    from app.models import User
    uid = db.query(User).filter_by(email="buyer@example.com").one().id
    r = client.post(f"/api/v1/admin/customers/{uid}/restrict", json={"restricted": True, "reason": "Fraud review"},
                    headers=auth(t))
    assert r.status_code == 200
    assert client.get("/api/v1/customer/cart", headers=auth(token)).status_code == 403
