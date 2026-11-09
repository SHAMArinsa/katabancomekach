import threading

from sqlalchemy import select

from tests.conftest import IN_ADDRESS, admin_token, auth, make_product, pay, place_order, register


def _inv(db, vid):
    from app.models import Inventory
    db.expire_all()
    return db.scalar(select(Inventory).where(Inventory.variant_id == vid))


def test_reservation_then_deduction_after_payment(client, db):
    v = make_product(db, stock=5)
    token = register(client)
    o = place_order(client, token, v.id, qty=2).json()
    inv = _inv(db, v.id)
    assert (inv.on_hand, inv.reserved) == (5, 2)
    pay(client, token, o["order_number"], "success")
    inv = _inv(db, v.id)
    assert (inv.on_hand, inv.reserved) == (3, 0)
    o = client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(token)).json()
    assert o["payment_status"] == "paid" and o["fulfillment_status"] == "processing"


def test_frontend_redirect_alone_never_marks_paid(client, db):
    v = make_product(db)
    token = register(client)
    o = place_order(client, token, v.id).json()
    po = client.post("/api/v1/payments/create", json={"order_number": o["order_number"]}, headers=auth(token)).json()
    r = client.post("/api/v1/payments/verify", json={"provider_order_id": po["provider_order_id"],
                                                     "provider_payment_id": "mock_pay_fake", "signature": "deadbeef"},
                    headers=auth(token))
    assert r.status_code == 401
    o = client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(token)).json()
    assert o["payment_status"] == "pending"


def test_verify_with_valid_signature(client, db):
    v = make_product(db)
    token = register(client)
    o = place_order(client, token, v.id).json()
    res = pay(client, token, o["order_number"], "success", send_webhook=False)
    r = client.post("/api/v1/payments/verify", json={"provider_order_id": res["provider_order_id"],
                                                     "provider_payment_id": res["provider_payment_id"],
                                                     "signature": res["signature"]}, headers=auth(token))
    assert r.status_code == 200 and r.json()["payment_status"] == "paid"
    # verifying again is idempotent
    r = client.post("/api/v1/payments/verify", json={"provider_order_id": res["provider_order_id"],
                                                     "provider_payment_id": res["provider_payment_id"],
                                                     "signature": res["signature"]}, headers=auth(token))
    assert r.json()["payment_status"] == "paid"
    assert _inv(db, v.id).on_hand == 9


def test_duplicate_webhooks_processed_once(client, db):
    v = make_product(db, stock=5)
    token = register(client)
    o = place_order(client, token, v.id).json()
    res = pay(client, token, o["order_number"], "success", duplicate_webhook=True)
    assert [w["status"] for w in res["webhooks"]] == ["processed", "duplicate"]
    assert _inv(db, v.id).on_hand == 4
    from app.models import PaymentEvent
    assert db.query(PaymentEvent).count() == 1


def test_invalid_webhook_signature_rejected(client, db):
    r = client.post("/api/v1/webhooks/payments/mock", content=b'{"id":"x","event":"payment.captured"}',
                    headers={"x-mock-signature": "bad", "content-type": "application/json"})
    assert r.status_code == 401


def test_amount_mismatch_never_marks_paid(client, db):
    v = make_product(db)
    token = register(client)
    o = place_order(client, token, v.id).json()
    pay(client, token, o["order_number"], "success", tamper_amount=True)
    t = admin_token(client)
    o = client.get(f"/api/v1/admin/orders/{o['order_number']}", headers=auth(t)).json()
    assert o["payment_status"] == "pending"
    assert o["requires_attention"] and "mismatch" in o["attention_reason"].lower()


def test_failed_payment_then_retry(client, db):
    v = make_product(db)
    token = register(client)
    o = place_order(client, token, v.id).json()
    pay(client, token, o["order_number"], "failure")
    d = client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(token)).json()
    assert d["payment_status"] == "failed" and d["can_pay"]
    assert _inv(db, v.id).reserved == 1  # stock still held until expiry
    pay(client, token, o["order_number"], "success")
    d = client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(token)).json()
    assert d["payment_status"] == "paid"


def test_expired_reservation_releases_stock(client, db):
    from datetime import datetime, timedelta, timezone

    from app.models import InventoryReservation
    from app.services.inventory import sweep_expired
    v = make_product(db, stock=1)
    token = register(client)
    o = place_order(client, token, v.id).json()
    db.query(InventoryReservation).update({"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)})
    db.commit()
    assert sweep_expired(db) == 1
    assert _inv(db, v.id).reserved == 0
    d = client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(token)).json()
    assert d["fulfillment_status"] == "cancelled" and d["payment_status"] == "failed"
    r = client.post("/api/v1/payments/create", json={"order_number": o["order_number"]}, headers=auth(token))
    assert r.status_code == 422


def test_no_overselling_under_concurrency(client, db):
    from fastapi.testclient import TestClient

    from app.main import app
    v = make_product(db, stock=1)
    tokens = [register(client, email=f"c{i}@example.com") for i in range(4)]
    for tk in tokens:
        assert client.post("/api/v1/customer/cart/items", json={"variant_id": v.id, "quantity": 1},
                           headers=auth(tk)).status_code == 201
    results = []

    def go(tk):
        with TestClient(app) as c:
            r = c.post("/api/v1/customer/checkout/orders", json={"address": IN_ADDRESS, "accept_shipping_terms": True},
                       headers=auth(tk))
            results.append(r.status_code)

    threads = [threading.Thread(target=go, args=(tk,)) for tk in tokens]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results).count(201) == 1, results
    inv = _inv(db, v.id)
    assert inv.reserved == 1 and inv.on_hand == 1


def test_dispatch_requires_verified_payment(client, db):
    v = make_product(db)
    token = register(client)
    o = place_order(client, token, v.id).json()
    t = admin_token(client)
    from app.models import ShippingProvider
    mock = db.query(ShippingProvider).filter_by(code="mock").one()
    r = client.post(f"/api/v1/admin/orders/{o['order_number']}/shipments", json={"provider_id": mock.id}, headers=auth(t))
    assert r.status_code == 422 and r.json()["error"]["code"] == "payment_not_verified"
    r = client.post(f"/api/v1/admin/orders/{o['order_number']}/fulfillment", json={"status": "dispatched"}, headers=auth(t))
    assert r.status_code == 422


def test_full_fulfilment_and_shipping_fee_collection(client, db):
    v = make_product(db, price="800")
    token = register(client)
    o = place_order(client, token, v.id).json()
    assert o["shipping_fee_status"] == "pending_collection"
    pay(client, token, o["order_number"])
    t = admin_token(client)
    from app.models import ShippingProvider
    manual = db.query(ShippingProvider).filter_by(code="manual").one()
    mock = db.query(ShippingProvider).filter_by(code="mock").one()
    num = o["order_number"]
    # incompatible courier (cannot collect from recipient) is refused
    r = client.post(f"/api/v1/admin/orders/{num}/shipments", json={"provider_id": manual.id, "tracking_number": "T1"},
                    headers=auth(t))
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsupported_courier"
    assert client.post(f"/api/v1/admin/orders/{num}/fulfillment", json={"status": "packed"}, headers=auth(t)).status_code == 200
    r = client.post(f"/api/v1/admin/orders/{num}/shipments", json={"provider_id": mock.id}, headers=auth(t))
    assert r.status_code == 201
    d = client.post(f"/api/v1/admin/orders/{num}/fulfillment", json={"status": "dispatched"}, headers=auth(t)).json()
    sid = d["shipments"][0]["id"]
    assert d["fulfillment_status"] == "dispatched" and d["shipments"][0]["tracking_number"].startswith("MOCK")
    d = client.post(f"/api/v1/admin/orders/{num}/shipments/{sid}/events", json={"status": "delivered"}, headers=auth(t)).json()
    assert d["fulfillment_status"] == "delivered"
    # payment and shipping-fee statuses are independent
    assert d["payment_status"] == "paid" and d["shipping_fee_status"] == "pending_collection"
    d = client.post(f"/api/v1/admin/orders/{num}/shipping-fee", json={"status": "collected", "collected_amount": "150"},
                    headers=auth(t)).json()
    assert d["shipping_fee_status"] == "collected" and d["shipping_fee_collection"]["collected_amount"] == "150.00"
    r = client.post(f"/api/v1/admin/orders/{num}/shipping-fee", json={"status": "pending_collection"}, headers=auth(t))
    assert r.status_code == 422  # invalid transition
    # guest tracking hides PII
    tr = client.get("/api/v1/public/track", params={"order_number": num, "email": "buyer@example.com"}).json()
    assert tr["fulfillment_status"] == "delivered" and "shipping_address" not in tr


def test_cancel_paid_order_refunds_and_restocks(client, db):
    v = make_product(db, stock=5)
    token = register(client)
    o = place_order(client, token, v.id, qty=2).json()
    pay(client, token, o["order_number"])
    assert _inv(db, v.id).on_hand == 3
    r = client.post(f"/api/v1/customer/orders/{o['order_number']}/cancel", headers=auth(token))
    assert r.status_code == 200
    d = r.json()
    assert d["fulfillment_status"] == "cancelled" and d["payment_status"] == "refunded"
    assert _inv(db, v.id).on_hand == 5


def test_cancel_unpaid_releases_reservation(client, db):
    v = make_product(db, stock=5)
    token = register(client)
    o = place_order(client, token, v.id, qty=2).json()
    client.post(f"/api/v1/customer/orders/{o['order_number']}/cancel", headers=auth(token))
    inv = _inv(db, v.id)
    assert (inv.on_hand, inv.reserved) == (5, 0)


def test_partial_refund_idempotent(client, db):
    v = make_product(db, price="3000")
    token = register(client)
    o = place_order(client, token, v.id).json()
    pay(client, token, o["order_number"])
    t = admin_token(client)
    body = {"amount": "500", "reason": "Goodwill", "idempotency_key": "rf-1"}
    d = client.post(f"/api/v1/admin/orders/{o['order_number']}/refunds", json=body, headers=auth(t)).json()
    d = client.post(f"/api/v1/admin/orders/{o['order_number']}/refunds", json=body, headers=auth(t)).json()
    assert d["payment_status"] == "partially_refunded" and len(d["refunds"]) == 1 and d["refunded_total"] == "500.00"
    r = client.post(f"/api/v1/admin/orders/{o['order_number']}/refunds", json={"amount": "2600", "reason": "x"},
                    headers=auth(t))
    assert r.status_code == 422  # exceeds refundable balance


def test_customer_data_isolation(client, db):
    v = make_product(db)
    a = register(client, email="alice@example.com")
    o = place_order(client, a, v.id).json()
    b = register(client, email="bob@example.com")
    assert client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(b)).status_code == 404
    assert client.post("/api/v1/payments/create", json={"order_number": o["order_number"]}, headers=auth(b)).status_code == 404
    assert client.post(f"/api/v1/customer/orders/{o['order_number']}/cancel", headers=auth(b)).status_code == 404
    assert client.get("/api/v1/customer/orders", headers=auth(b)).json()["total"] == 0
    addr = client.post("/api/v1/customer/addresses", json=IN_ADDRESS, headers=auth(a)).json()
    assert client.delete(f"/api/v1/customer/addresses/{addr['id']}", headers=auth(b)).status_code == 404


def test_coupon_usage_limit(client, db):
    v = make_product(db, price="1000", stock=20)
    token = register(client)
    o = place_order(client, token, v.id, coupon="WELCOME10").json()
    assert o["discount"] == "100.00"
    pay(client, token, o["order_number"])
    client.post("/api/v1/customer/cart/items", json={"variant_id": v.id, "quantity": 1}, headers=auth(token))
    r = client.post("/api/v1/customer/checkout/orders", json={"address": IN_ADDRESS, "accept_shipping_terms": True,
                                                              "coupon_code": "WELCOME10"}, headers=auth(token))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_coupon"


def test_return_and_damage_claim_flow(client, db):
    import io

    from PIL import Image
    v = make_product(db, price="2500", stock=5)
    token = register(client)
    o = place_order(client, token, v.id, qty=2).json()
    num = o["order_number"]
    pay(client, token, num)
    t = admin_token(client)
    from app.models import ShippingProvider
    mock = db.query(ShippingProvider).filter_by(code="mock").one()
    client.post(f"/api/v1/admin/orders/{num}/shipments", json={"provider_id": mock.id}, headers=auth(t))
    assert client.post(f"/api/v1/admin/orders/{num}/fulfillment", json={"status": "packed"}, headers=auth(t)).status_code == 200
    assert client.post(f"/api/v1/admin/orders/{num}/fulfillment", json={"status": "dispatched"}, headers=auth(t)).status_code == 200
    client.post(f"/api/v1/admin/orders/{num}/fulfillment", json={"status": "delivered"}, headers=auth(t))
    d = client.get(f"/api/v1/customer/orders/{num}", headers=auth(token)).json()
    assert d["can_return"] and d["can_claim"], (d["fulfillment_status"], d["payment_status"], d["delivered_at"])
    item_id = d["items"][0]["id"]
    r = client.post(f"/api/v1/customer/orders/{num}/returns", json={"reason": "Changed my mind",
                                                                    "items": [{"order_item_id": item_id, "quantity": 1}]},
                    headers=auth(token))
    assert r.status_code == 201
    rid = r.json()["id"]
    for status in ("approved", "received"):
        assert client.post(f"/api/v1/admin/returns/{rid}", json={"status": status, "restock": True},
                           headers=auth(t)).status_code == 200
    r = client.post(f"/api/v1/admin/returns/{rid}", json={"status": "refunded"}, headers=auth(t))
    assert r.status_code == 200
    od = client.get(f"/api/v1/admin/orders/{num}", headers=auth(t)).json()
    assert od["payment_status"] == "partially_refunded" and od["refunded_total"] == "2500.00"
    assert _inv(db, v.id).on_hand == 4  # 5 - 2 sold + 1 restocked
    # damage claim with photo evidence (stored privately)
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), "red").save(buf, "JPEG")
    r = client.post(f"/api/v1/customer/orders/{num}/claims",
                    data={"description": "Arrived with a cracked rim", "claim_type": "damaged"},
                    files=[("files", ("crack.jpg", buf.getvalue(), "image/jpeg"))], headers=auth(token))
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    img = client.get(f"/api/v1/admin/claims/{cid}/evidence/0", headers=auth(t))
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert client.get(f"/api/v1/admin/claims/{cid}/evidence/0").status_code == 401
    r = client.post(f"/api/v1/admin/claims/{cid}", json={"status": "approved_refund", "refund_amount": "500"},
                    headers=auth(t))
    assert r.status_code == 200
    od = client.get(f"/api/v1/admin/orders/{num}", headers=auth(t)).json()
    assert od["refunded_total"] == "3000.00"


def test_dashboard_counts(client, db):
    v = make_product(db, price="1000")
    token = register(client)
    o = place_order(client, token, v.id).json()
    pay(client, token, o["order_number"])
    t = admin_token(client)
    d = client.get("/api/v1/admin/dashboard", headers=auth(t)).json()
    assert d["orders"]["paid"] == 1 and d["products"]["published"] == 1
    assert d["sales"]["test_mode_gross"] == "1000.00"  # mock payments are never reported as real revenue
    assert d["sales"]["gross"] == "0.00"
