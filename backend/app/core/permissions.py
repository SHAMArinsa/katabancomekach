"""Permission catalogue and default role mapping."""

PERMISSIONS: dict[str, str] = {
    "dashboard.read": "View admin dashboard",
    "products.read": "View products",
    "products.write": "Create/edit products, images, variants",
    "products.publish": "Publish/unpublish/archive/delete products",
    "categories.write": "Manage categories and collections",
    "inventory.read": "View inventory",
    "inventory.write": "Adjust stock and reservations",
    "orders.read": "View orders",
    "orders.write": "Update order fulfillment, shipments, shipping-fee collection",
    "orders.cancel": "Cancel orders",
    "orders.export": "Export order data",
    "payments.read": "View payments",
    "payments.refund": "Issue refunds",
    "customers.read": "Search and view customers",
    "customers.pii": "View full customer contact details and addresses",
    "customers.write": "Restrict accounts, process deletion requests",
    "support.manage": "Manage support tickets, returns and damage claims",
    "coupons.write": "Manage coupons and promotions",
    "content.write": "Manage homepage, pages, FAQs, banners",
    "settings.read": "View business settings",
    "settings.write": "Change business settings",
    "settings.payments": "Change payment settings",
    "shipping.write": "Manage shipping providers, zones, rates, destinations",
    "reviews.moderate": "Moderate product reviews",
    "staff.manage": "Manage staff accounts, roles and permissions",
    "audit.read": "View audit log",
}

DEFAULT_ROLES: dict[str, tuple[str, list[str]]] = {
    "Super Admin": ("Full access including roles, permissions and payment settings", list(PERMISSIONS)),
    "Product Manager": ("Catalog, categories, content and coupons", [
        "dashboard.read", "products.read", "products.write", "products.publish", "categories.write",
        "inventory.read", "coupons.write", "content.write", "reviews.moderate", "settings.read"]),
    "Order Manager": ("Orders, shipments, payments and refunds", [
        "dashboard.read", "orders.read", "orders.write", "orders.cancel", "orders.export", "payments.read",
        "payments.refund", "customers.read", "customers.pii", "inventory.read", "products.read", "support.manage"]),
    "Inventory Manager": ("Stock levels and movements", [
        "dashboard.read", "products.read", "inventory.read", "inventory.write", "orders.read"]),
    "Support Manager": ("Customers, tickets, returns and claims", [
        "dashboard.read", "customers.read", "customers.pii", "orders.read", "support.manage", "products.read"]),
}
