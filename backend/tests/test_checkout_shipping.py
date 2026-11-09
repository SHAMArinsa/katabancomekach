from decimal import Decimal

from tests.conftest import IN_ADDRESS, US_ADDRESS, admin_token, auth, make_product, place_order, register


def quote(client, variant_id, qty, country="IN", **kw):
    r = client.post("/api/v1/shipping/quote", json={"items": [{"variant_id": variant_id, "quantity": qty}],
                                                    "country_code": country, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_domestic_free_delivery_at_exactly_2000(client, db):
    v = make_product(db, price="1000")
    q = quote(client, v.id, 2)
    assert q["subtotal"] == "2000.00"
    assert q["shipping"]["free_delivery"] is True
    assert q["shipping"]["fee_payer"] == "store"
    assert q["shipping"]["fee_collection_status"] == "not_applicable"


def test_domestic_recipient_paid_below_2000(client, db):
    v = make_product(db, price="1999.99")
    q = quote(client, v.id, 1)
    s = q["shipping"]
    assert s["free_delivery"] is False and s["fee_payer"] == "recipient"
    assert s["fee_collection_status"] == "pending_collection"
    assert s["fee_charged_online"] == "0.00"  # shipping is never added to the online charge
    assert q["total"] == "1999.99"
    assert s["amount_to_free_delivery"] == "0.01"
    assert Decimal(s["estimated_fee"]) > 0


def test_international_free_at_10000_and_paid_below(client, db):
    v = make_product(db, price="5000")
    assert quote(client, v.id, 2, "US")["shipping"]["free_delivery"] is True
    q = quote(client, v.id, 1, "US")
    assert q["shipping"]["free_delivery"] is False
    assert q["shipping"]["threshold"] == "10000.00"
    assert q["shipping"]["customs_disclosure"]
    assert q["tax"] == "0.00"  # exports are zero-rated in seed tax rules


def test_threshold_basis_after_discount(client, db):
    v = make_product(db, price="2000")
    q = quote(client, v.id, 1, coupon_code="WELCOME10")
    assert q["discount"] == "200.00"
    assert q["shipping"]["eligible_subtotal"] == "1800.00"
    assert q["shipping"]["free_delivery"] is False


def test_admin_can_change_thresholds(client, db):
    v = make_product(db, price="1500")
    t = admin_token(client)
    r = client.patch("/api/v1/admin/settings/shipping", json={"domestic_free_threshold": "1500"}, headers=auth(t))
    assert r.status_code == 200
    assert quote(client, v.id, 1)["shipping"]["free_delivery"] is True
    r = client.get("/api/v1/admin/audit-logs", params={"action": "settings.update"}, headers=auth(t)).json()
    entry = r["items"][0]
    assert entry["entity_id"] == "shipping" and entry["after"]["domestic_free_threshold"] == "1500"
    assert entry["before"]["domestic_free_threshold"] == "2000"
    assert client.get("/api/v1/public/settings").json()["shipping"]["domestic_free_threshold"] == "1500.00"


def test_invalid_settings_rejected(client):
    t = admin_token(client)
    r = client.patch("/api/v1/admin/settings/shipping", json={"domestic_free_threshold": "-5"}, headers=auth(t))
    assert r.status_code == 422
    r = client.patch("/api/v1/admin/settings/shipping", json={"evil": "__import__('os')"}, headers=auth(t))
    assert r.status_code == 422


def test_live_payment_mode_blocked_without_deployment_flag(client):
    t = admin_token(client)
    r = client.patch("/api/v1/admin/settings/payment", json={"mode": "live"}, headers=auth(t))
    assert r.status_code == 422


def test_unsupported_destination_blocked(client, db):
    v = make_product(db, price="20000")
    q = quote(client, v.id, 1, "JP")
    assert q["can_checkout"] is False and q["destination"]["supported"] is False
    q = quote(client, v.id, 1, "ZZ")
    assert q["can_checkout"] is False


def test_domestic_only_product_blocked_internationally(client, db):
    v = make_product(db, price="20000", ships_internationally=False)
    assert quote(client, v.id, 1, "US")["can_checkout"] is False
    assert quote(client, v.id, 1, "IN")["can_checkout"] is True


def test_courier_without_recipient_paid_blocks_below_threshold(client, db):
    from app.models import ShippingProvider, ShippingZone
    manual = db.query(ShippingProvider).filter_by(code="manual").one()
    z = db.query(ShippingZone).filter_by(is_domestic=True).one()
    z.provider_id = manual.id
    db.commit()
    v = make_product(db, price="500")
    q = quote(client, v.id, 1)
    assert q["can_checkout"] is False and q["shipping"]["arrangement_supported"] is False
    assert quote(client, v.id, 4)["can_checkout"] is True  # free delivery needs no fee collection


def test_no_cod_anywhere(client, db):
    v = make_product(db)
    q = quote(client, v.id, 1)
    assert q["payment"]["cod_available"] is False and "cod" not in q["payment"]["methods"]
    token = register(client)
    client.post("/api/v1/customer/cart/items", json={"variant_id": v.id, "quantity": 1}, headers=auth(token))
    r = client.post("/api/v1/customer/checkout/orders", json={"address": IN_ADDRESS, "accept_shipping_terms": True,
                                                              "payment_method": "cod"}, headers=auth(token))
    assert r.status_code == 422
    t = admin_token(client)
    r = client.patch("/api/v1/admin/settings/payment", json={"enabled_methods": ["cod"]}, headers=auth(t))
    assert r.status_code == 422


def test_db_constraint_forbids_cod(db):
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE orders SET payment_method='cod'"))  # no rows yet: force an insert instead
        db.execute(text("""INSERT INTO orders (order_number,user_id,email,is_international,destination_country,
            base_currency,display_currency,exchange_rate,subtotal_amount,discount_amount,gift_wrap_amount,tax_amount,
            prices_include_tax,total_amount,eligible_subtotal,free_delivery_threshold,free_delivery,payment_method,
            payment_status,shipping_fee_status,fulfillment_status,shipping_terms,requires_attention,is_test)
            VALUES ('X',1,'x',false,'IN','INR','INR',1,1,0,0,0,true,1,1,2000,false,'cod','pending','pending_collection',
            'unfulfilled','{}',false,true)"""))
    db.rollback()


def test_currency_conversion_and_rounding(client, db):
    from app.models import ExchangeRate
    from datetime import datetime, timezone
    db.add(ExchangeRate(quote_currency="USD", rate=Decimal("0.0119"), source="test", effective_at=datetime.now(timezone.utc)))
    db.commit()
    v = make_product(db, price="1234.50")
    q = quote(client, v.id, 1, display_currency="USD")
    # 1234.50 * 0.0119 = 14.69055 -> 14.69 (ROUND_HALF_UP)
    assert q["display"]["currency"] == "USD" and q["display"]["total"] == "14.69"
    assert q["total"] == "1234.50" and q["currency"] == "INR"
    from app.services.money import q as rq
    assert str(rq(Decimal("2.345"))) == "2.35" and str(rq(Decimal("2.345"), "half_even")) == "2.34"


def test_gst_included_in_price(client, db):
    v = make_product(db, price="1180")
    q = quote(client, v.id, 1)
    assert q["tax"] == "180.00" and q["total"] == "1180.00" and q["prices_include_tax"] is True


def test_checkout_requires_verified_email_and_terms(client, db):
    v = make_product(db)
    token = register(client, verify=False)
    r = place_order(client, token, v.id)
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_unverified"


def test_international_checkout_requires_customs_ack(client, db):
    v = make_product(db, price="12000")
    token = register(client)
    r = place_order(client, token, v.id, address=US_ADDRESS)
    assert r.json()["error"]["code"] == "customs_terms_required"
    r = client.post("/api/v1/customer/checkout/orders", json={"address": US_ADDRESS, "accept_shipping_terms": True,
                                                              "accept_customs_terms": True}, headers=auth(token))
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["is_international"] and o["free_delivery"] and o["customs_disclosure"]
    assert o["shipping_fee_status"] == "not_applicable"


def test_order_snapshots_survive_price_change(client, db):
    v = make_product(db, price="2500")
    token = register(client)
    o = place_order(client, token, v.id).json()
    t = admin_token(client)
    client.patch(f"/api/v1/admin/products/{v.product_id}", json={"price": "9999"}, headers=auth(t))
    o2 = client.get(f"/api/v1/customer/orders/{o['order_number']}", headers=auth(token)).json()
    assert o2["items"][0]["unit_price"] == "2500.00" and o2["total"] == "2500.00"


def test_cannot_buy_more_than_stock(client, db):
    v = make_product(db, stock=2)
    token = register(client)
    r = client.post("/api/v1/customer/cart/items", json={"variant_id": v.id, "quantity": 3}, headers=auth(token))
    assert r.status_code == 422 and r.json()["error"]["code"] == "insufficient_stock"


def test_cannot_add_draft_product(client, db):
    v = make_product(db, status="draft")
    token = register(client)
    r = client.post("/api/v1/customer/cart/items", json={"variant_id": v.id, "quantity": 1}, headers=auth(token))
    assert r.status_code == 422
