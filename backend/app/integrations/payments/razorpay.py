"""Razorpay adapter (REST API via httpx).

Status: implemented against Razorpay's documented Orders/Payments/Refunds APIs
and HMAC signature schemes, but NOT verified against a live/test Razorpay
account from this codebase. Verify with Razorpay test keys before going live
(see docs/DEPLOYMENT.md › Payments).
"""
import hashlib
import hmac

import httpx

from app.core.config import settings
from app.integrations.payments.base import (PaymentProvider, ProviderOrder, ProviderPayment, ProviderRefund,
                                            WebhookEvent)

API = "https://api.razorpay.com/v1"


class RazorpayProvider(PaymentProvider):
    name = "razorpay"

    def __init__(self, live: bool = False):
        if not (settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET):
            raise RuntimeError("Razorpay credentials missing")
        self.is_test = settings.RAZORPAY_KEY_ID.startswith("rzp_test_")
        self._auth = (settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET)

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=API, auth=self._auth, timeout=20)

    def create_order(self, amount_minor: int, currency: str, receipt: str, notes: dict) -> ProviderOrder:
        with self._client() as c:
            r = c.post("/orders", json={"amount": amount_minor, "currency": currency, "receipt": receipt[:40],
                                        "notes": {k: str(v)[:250] for k, v in notes.items()}})
            r.raise_for_status()
            data = r.json()
        return ProviderOrder(data["id"], data["amount"], data["currency"],
                             checkout={"key_id": settings.RAZORPAY_KEY_ID})

    def verify_checkout_signature(self, provider_order_id: str, provider_payment_id: str, signature: str) -> bool:
        msg = f"{provider_order_id}|{provider_payment_id}".encode()
        expected = hmac.new(settings.RAZORPAY_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")

    def fetch_payment(self, provider_payment_id: str) -> ProviderPayment:
        with self._client() as c:
            r = c.get(f"/payments/{provider_payment_id}")
            r.raise_for_status()
            p = r.json()
        return ProviderPayment(p["id"], p.get("order_id") or "", p["status"], int(p["amount"]), p["currency"],
                               method=p.get("method") or "online", error=p.get("error_description"))

    def verify_webhook(self, body: bytes, signature: str | None) -> bool:
        if not settings.RAZORPAY_WEBHOOK_SECRET:
            return False
        expected = hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")

    def parse_webhook(self, payload: dict) -> WebhookEvent:
        event = payload.get("event", "")
        entity = ((payload.get("payload") or {}).get("payment") or {}).get("entity") or {}
        refund = ((payload.get("payload") or {}).get("refund") or {}).get("entity") or {}
        # Razorpay sends the unique event id in the X-Razorpay-Event-Id header; the webhook route
        # injects it as payload["_event_id"]. Fall back to a deterministic composite key.
        event_id = payload.get("_event_id") or f"{event}:{entity.get('id') or refund.get('id')}"
        return WebhookEvent(event_id=event_id, event_type=event, provider_order_id=entity.get("order_id"),
                            provider_payment_id=entity.get("id") or refund.get("payment_id"),
                            amount_minor=entity.get("amount") or refund.get("amount"),
                            currency=entity.get("currency") or refund.get("currency"),
                            method=entity.get("method"), error=entity.get("error_description"))

    def refund(self, provider_payment_id: str, amount_minor: int, idempotency_key: str, notes: dict) -> ProviderRefund:
        with self._client() as c:
            r = c.post(f"/payments/{provider_payment_id}/refund",
                       json={"amount": amount_minor, "receipt": idempotency_key[:40],
                             "notes": {k: str(v)[:250] for k, v in notes.items()}})
            r.raise_for_status()
            data = r.json()
        return ProviderRefund(data["id"], "processed" if data.get("status") == "processed" else "pending")
