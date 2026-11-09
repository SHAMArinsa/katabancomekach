"""Mock payment gateway for local development and automated tests.

Mock transactions are ALWAYS flagged is_test=True and are never represented
as real payments. Signatures use HMAC-SHA256 like a real gateway so the same
verification code paths are exercised.
"""
import hashlib
import hmac
import json
import secrets
import threading

from app.core.config import settings
from app.integrations.payments.base import (PaymentProvider, ProviderOrder, ProviderPayment, ProviderRefund,
                                            WebhookEvent)

_lock = threading.Lock()
_orders: dict[str, dict] = {}
_payments: dict[str, ProviderPayment] = {}


def _key() -> bytes:
    return hmac.new(settings.SECRET_KEY.encode(), b"mock-payment-gateway", hashlib.sha256).digest()


class MockPaymentProvider(PaymentProvider):
    name = "mock"
    is_test = True

    def create_order(self, amount_minor: int, currency: str, receipt: str, notes: dict) -> ProviderOrder:
        oid = "mock_order_" + secrets.token_hex(8)
        with _lock:
            _orders[oid] = {"amount_minor": amount_minor, "currency": currency, "receipt": receipt}
        return ProviderOrder(oid, amount_minor, currency, checkout={"mock": True, "test_mode": True})

    def sign(self, provider_order_id: str, provider_payment_id: str) -> str:
        msg = f"{provider_order_id}|{provider_payment_id}".encode()
        return hmac.new(_key(), msg, hashlib.sha256).hexdigest()

    def verify_checkout_signature(self, provider_order_id: str, provider_payment_id: str, signature: str) -> bool:
        return hmac.compare_digest(self.sign(provider_order_id, provider_payment_id), signature or "")

    # --- simulation helpers (dev/test only) ---
    def simulate(self, provider_order_id: str, outcome: str, amount_minor: int | None = None,
                 currency: str | None = None) -> tuple[ProviderPayment, str]:
        with _lock:
            order = _orders.get(provider_order_id)
        pid = "mock_pay_" + secrets.token_hex(8)
        amt = amount_minor if amount_minor is not None else (order["amount_minor"] if order else 0)
        cur = currency or (order["currency"] if order else "INR")
        status = "captured" if outcome == "success" else "failed"
        payment = ProviderPayment(pid, provider_order_id, status, amt, cur, method="card",
                                  error=None if status == "captured" else "Card declined (simulated)")
        with _lock:
            _payments[pid] = payment
        return payment, self.sign(provider_order_id, pid)

    def webhook_body(self, payment: ProviderPayment, event_id: str | None = None) -> tuple[bytes, str]:
        payload = {
            "id": event_id or ("mock_evt_" + secrets.token_hex(8)),
            "event": "payment.captured" if payment.status == "captured" else "payment.failed",
            "payment": {"id": payment.provider_payment_id, "order_id": payment.provider_order_id,
                        "amount": payment.amount_minor, "currency": payment.currency, "method": payment.method,
                        "error": payment.error},
        }
        body = json.dumps(payload).encode()
        return body, hmac.new(_key(), body, hashlib.sha256).hexdigest()

    def fetch_payment(self, provider_payment_id: str) -> ProviderPayment:
        with _lock:
            p = _payments.get(provider_payment_id)
        if not p:
            raise LookupError("Unknown mock payment")
        return p

    def verify_webhook(self, body: bytes, signature: str | None) -> bool:
        expected = hmac.new(_key(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature or "")

    def parse_webhook(self, payload: dict) -> WebhookEvent:
        p = payload.get("payment") or {}
        return WebhookEvent(event_id=str(payload.get("id")), event_type=str(payload.get("event")),
                            provider_order_id=p.get("order_id"), provider_payment_id=p.get("id"),
                            amount_minor=p.get("amount"), currency=p.get("currency"), method=p.get("method"),
                            error=p.get("error"))

    def refund(self, provider_payment_id: str, amount_minor: int, idempotency_key: str, notes: dict) -> ProviderRefund:
        return ProviderRefund("mock_rfnd_" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:12], "processed")
