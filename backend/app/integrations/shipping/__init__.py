"""Shipping/courier adapters.

The mock courier works fully offline: it creates tracking numbers, emits
tracking events and lets an admin simulate delivery and recipient-paid fee
collection. A real courier adapter should implement the same interface;
courier capabilities (recipient-paid shipping on prepaid orders, international,
fragile) are configured per provider in the `shipping_providers` table.
"""
import secrets
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class CreatedShipment:
    tracking_number: str
    tracking_url: str | None
    courier_name: str
    is_test: bool


@dataclass
class TrackingUpdate:
    external_id: str
    status: str
    description: str
    location: str | None
    occurred_at: datetime


class ShippingAdapter(ABC):
    code: str

    @abstractmethod
    def create_shipment(self, order_number: str, country: str, postal_code: str, weight_grams: int,
                        recipient_pays_shipping: bool, fragile: bool) -> CreatedShipment: ...

    @abstractmethod
    def fetch_tracking(self, tracking_number: str) -> list[TrackingUpdate]: ...


class MockShippingAdapter(ShippingAdapter):
    code = "mock"

    def create_shipment(self, order_number, country, postal_code, weight_grams, recipient_pays_shipping, fragile):
        tn = "MOCK" + secrets.token_hex(5).upper()
        return CreatedShipment(tn, f"/track?number={tn}", "Mock Courier (test)", True)

    def fetch_tracking(self, tracking_number: str) -> list[TrackingUpdate]:
        return []

    def simulated_event(self, status: str, location: str | None = None) -> TrackingUpdate:
        text = {
            "in_transit": "Shipment picked up and in transit",
            "out_for_delivery": "Out for delivery",
            "delivered": "Delivered to recipient",
            "exception": "Delivery exception reported by courier",
            "returned": "Returned to origin",
            "lost": "Courier reported parcel as lost",
        }.get(status, status)
        return TrackingUpdate("mockevt_" + secrets.token_hex(6), status, text, location,
                              datetime.now(timezone.utc))


class ManualCourierAdapter(ShippingAdapter):
    """For couriers without an API: admins enter tracking numbers manually."""
    code = "manual"

    def create_shipment(self, order_number, country, postal_code, weight_grams, recipient_pays_shipping, fragile):
        raise NotImplementedError("Manual courier: provide tracking number when dispatching")

    def fetch_tracking(self, tracking_number: str) -> list[TrackingUpdate]:
        return []


_ADAPTERS: dict[str, ShippingAdapter] = {"mock": MockShippingAdapter(), "manual": ManualCourierAdapter()}


def get_shipping_adapter(code: str) -> ShippingAdapter:
    return _ADAPTERS.get(code, _ADAPTERS["manual"])
