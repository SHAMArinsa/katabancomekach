from app.core.config import settings
from app.integrations.payments.base import PaymentProvider
from app.integrations.payments.mock import MockPaymentProvider

_mock = MockPaymentProvider()


def get_payment_provider(name: str | None = None) -> PaymentProvider:
    """Resolve the adapter. The admin-selected provider must also be enabled by server env."""
    name = name or settings.PAYMENT_PROVIDER
    if name == "razorpay":
        from app.integrations.payments.razorpay import RazorpayProvider
        return RazorpayProvider()
    if name == "mock":
        if settings.is_production and not settings.ALLOW_MOCK_IN_PRODUCTION:
            raise RuntimeError("Mock payments disabled in production")
        return _mock
    raise RuntimeError(f"Unknown payment provider {name}")


def mock_provider() -> MockPaymentProvider:
    return _mock
