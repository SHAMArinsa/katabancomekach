"""Status vocabularies and allowed transitions.

Product payment, shipping-fee collection and fulfillment are tracked
independently. Each has its own column, CHECK constraint and transition map.
"""

PAYMENT_STATUSES = ("pending", "authorized", "paid", "failed", "partially_refunded", "refunded")
SHIPPING_FEE_STATUSES = ("not_applicable", "pending_collection", "collected", "collection_failed", "waived", "disputed")
FULFILLMENT_STATUSES = ("unfulfilled", "processing", "packed", "dispatched", "delivered", "cancelled", "returned")

PAYMENT_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"authorized", "paid", "failed"},
    "authorized": {"paid", "failed"},
    "failed": {"pending", "authorized", "paid"},  # a retried attempt may still succeed
    "paid": {"partially_refunded", "refunded"},
    "partially_refunded": {"partially_refunded", "refunded"},
    "refunded": set(),
}

SHIPPING_FEE_TRANSITIONS: dict[str, set[str]] = {
    "not_applicable": set(),
    "pending_collection": {"collected", "collection_failed", "waived", "disputed"},
    "collection_failed": {"collected", "waived", "disputed", "pending_collection"},
    "disputed": {"collected", "waived", "collection_failed"},
    "collected": {"disputed"},
    "waived": set(),
}

FULFILLMENT_TRANSITIONS: dict[str, set[str]] = {
    "unfulfilled": {"processing", "cancelled"},
    "processing": {"packed", "cancelled", "unfulfilled"},
    "packed": {"dispatched", "processing", "cancelled"},
    "dispatched": {"delivered", "returned"},
    "delivered": {"returned"},
    "cancelled": set(),
    "returned": set(),
}

PRODUCT_STATUSES = ("draft", "published", "archived")
CATEGORY_STATUSES = ("published", "hidden", "archived")
FRAGILITY_LEVELS = ("standard", "fragile", "highly_fragile")
RETURN_STATUSES = ("requested", "approved", "rejected", "received", "refunded", "closed")
CLAIM_STATUSES = ("submitted", "under_review", "approved_refund", "approved_replacement", "rejected", "resolved")
TICKET_STATUSES = ("open", "pending_customer", "resolved", "closed")
REFUND_STATUSES = ("pending", "processed", "failed")
SHIPMENT_STATUSES = ("created", "in_transit", "out_for_delivery", "delivered", "exception", "returned", "lost")


def check_in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({quoted})"
