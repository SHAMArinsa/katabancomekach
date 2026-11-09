from tests.conftest import admin_token, auth, make_product


def test_only_published_products_visible(client, db):
    make_product(db, name="Visible Vase")
    make_product(db, name="Draft Vase", status="draft")
    names = [p["name"] for p in client.get("/api/v1/public/products").json()["items"]]
    assert "Visible Vase" in names and "Draft Vase" not in names
    assert client.get("/api/v1/public/products/draft-vase").status_code == 404


def test_hidden_category_hides_products(client, db):
    make_product(db, name="Hidden Cat Vase")
    from app.models import Category
    c = db.query(Category).filter_by(slug="bud-vases").one()
    c.status = "hidden"
    db.commit()
    assert client.get("/api/v1/public/products/hidden-cat-vase").status_code == 404


def test_search_filter_sort(client, db):
    make_product(db, name="Amber Bud Vase", price="500")
    make_product(db, name="Clear Tall Vase", price="3000", category_slug="statement-vases")
    r = client.get("/api/v1/public/products", params={"q": "amber"}).json()
    assert [p["name"] for p in r["items"]] == ["Amber Bud Vase"]
    r = client.get("/api/v1/public/products", params={"category": "vases-flower-arrangements", "sort": "price_desc"}).json()
    assert [p["name"] for p in r["items"]] == ["Clear Tall Vase", "Amber Bud Vase"]
    r = client.get("/api/v1/public/products", params={"min_price": 1000}).json()
    assert [p["name"] for p in r["items"]] == ["Clear Tall Vase"]
    r = client.get("/api/v1/public/products", params={"q": "100%_"}).json()
    assert r["total"] == 0


def test_sale_price_applied(client, db):
    make_product(db, name="Sale Vase", price="2000", sale_price="1500")
    p = client.get("/api/v1/public/products/sale-vase").json()
    assert p["price"] == "1500.00" and p["compare_at_price"] == "2000.00" and p["on_sale"]


def test_admin_product_crud_and_publish(client):
    t = admin_token(client)
    cats = client.get("/api/v1/admin/categories", headers=auth(t)).json()
    cid = next(c["id"] for c in cats if c["slug"] == "bud-vases")
    r = client.post("/api/v1/admin/products", json={"name": "New Piece", "sku": "NP-1", "price": "1200.00",
                                                    "initial_stock": 7, "category_id": cid}, headers=auth(t))
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert r.json()["status"] == "draft"
    assert client.get("/api/v1/public/products/new-piece").status_code == 404
    r = client.post(f"/api/v1/admin/products/{pid}/status", json={"status": "published"}, headers=auth(t))
    assert r.status_code == 200
    assert client.get("/api/v1/public/products/new-piece").json()["available_quantity"] == 7
    r = client.patch(f"/api/v1/admin/products/{pid}", json={"price": "1350.00"}, headers=auth(t))
    assert r.json()["base_price"] == "1350.00"
    logs = client.get("/api/v1/admin/audit-logs", params={"action": "product.update"}, headers=auth(t)).json()
    assert logs["total"] == 1


def test_publish_requires_category(client):
    t = admin_token(client)
    pid = client.post("/api/v1/admin/products", json={"name": "No Cat", "sku": "NC-1", "price": "10"},
                      headers=auth(t)).json()["id"]
    r = client.post(f"/api/v1/admin/products/{pid}/status", json={"status": "published"}, headers=auth(t))
    assert r.status_code == 422


def test_category_with_products_cannot_be_deleted(client, db):
    make_product(db)
    t = admin_token(client)
    from app.models import Category
    cid = db.query(Category).filter_by(slug="bud-vases").one().id
    r = client.delete(f"/api/v1/admin/categories/{cid}", headers=auth(t))
    assert r.status_code == 422 and r.json()["error"]["code"] == "category_in_use"


def test_image_upload_validation(client, db):
    import io

    from PIL import Image
    v = make_product(db)
    t = admin_token(client)
    r = client.post(f"/api/v1/admin/products/{v.product_id}/images", files={"file": ("x.png", b"<svg onload=alert(1)>", "image/png")},
                    headers=auth(t))
    assert r.status_code == 422
    buf = io.BytesIO()
    Image.new("RGB", (20, 20), "white").save(buf, "PNG")
    r = client.post(f"/api/v1/admin/products/{v.product_id}/images", files={"file": ("ok.png", buf.getvalue(), "image/png")},
                    headers=auth(t))
    assert r.status_code == 201 and r.json()["images"][0]["url"].endswith(".png")


def test_csv_import_dry_run_and_commit(client):
    t = admin_token(client)
    csv_text = ("sku,name,price,category_slug,status,stock\n"
                "IMP-1,Imported Bowl,999.00,bowls-serving-dishes,published,5\n"
                "IMP-2,Bad Row,abc,bowls-serving-dishes,draft,1\n")
    r = client.post("/api/v1/admin/products-import", files={"file": ("p.csv", csv_text, "text/csv")},
                    data={"dry_run": "true"}, headers=auth(t))
    assert r.json()["valid"] is False and r.json()["errors"][0]["row"] == 3
    good = "sku,name,price,category_slug,status,stock\nIMP-1,Imported Bowl,999.00,bowls-serving-dishes,published,5\n"
    r = client.post("/api/v1/admin/products-import", files={"file": ("p.csv", good, "text/csv")},
                    data={"dry_run": "false"}, headers=auth(t))
    assert r.json()["created"] == 1
    assert client.get("/api/v1/public/products/imported-bowl").json()["price"] == "999.00"
    r = client.get("/api/v1/admin/products-export", params={"format": "xlsx"}, headers=auth(t))
    assert r.status_code == 200 and r.content[:2] == b"PK"
