from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ProviderOrder:
    provider_order_id: str
    amount_minor: int
    currency: str
    checkout: dict = field(default_factory=dict)  # public params only (never secrets)


@dataclass
class ProviderPayment:
    provider_payment_id: str
    provider_order_id: str
    status: str  # created | authorized | captured | failed | refunded
    amount_minor: int
    currency: str
    method: str = "online"
    error: str | None = None


@dataclass
class WebhookEvent:
    event_id: str
    event_type: str  # payment.authorized | payment.captured | payment.failed | refund.processed | other
    provider_order_id: str | None
    provider_payment_id: str | None
    amount_minor: int | None
    currency: str | None
    method: str | None = None
    error: str | None = None


@dataclass
class ProviderRefund:
    provider_refund_id: str
    status: str  # processed | pending | failed


class PaymentProvider(ABC):
    name: str
    is_test: bool = True

    @abstractmethod
    def create_order(self, amount_minor: int, currency: str, receipt: str, notes: dict) -> ProviderOrder: ...

    @abstractmethod
    def verify_checkout_signature(self, provider_order_id: str, provider_payment_id: str, signature: str) -> bool: ...

    @abstractmethod
    def fetch_payment(self, provider_payment_id: str) -> ProviderPayment: ...

    @abstractmethod
    def verify_webhook(self, body: bytes, signature: str | None) -> bool: ...

    @abstractmethod
    def parse_webhook(self, payload: dict) -> WebhookEvent: ...

    @abstractmethod
    def refund(self, provider_payment_id: str, amount_minor: int, idempotency_key: str, notes: dict) -> ProviderRefund: ...
