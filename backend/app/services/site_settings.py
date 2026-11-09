from typing import TypeVar

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import settings as env
from app.core.errors import AppError, BusinessRuleError, NotFound
from app.models import SiteSetting, User
from app.schemas.settings import (SECTIONS, AccountSettings, CatalogSettings, ContentSettings, PaymentSettings,
                                  PricingSettings, ShippingSettings, StoreSettings, _Section)
from app.services.audit import audit

T = TypeVar("T", bound=_Section)


def get_section(db: Session, section: str) -> _Section:
    model = SECTIONS.get(section)
    if not model:
        raise NotFound(f"Unknown settings section '{section}'")
    row = db.get(SiteSetting, section)
    data = row.value if row else {}
    try:
        return model(**data)
    except ValidationError:
        # A stored value no longer matches the schema (e.g. after an upgrade): fall back field-by-field.
        defaults = model().model_dump()
        merged = {k: data.get(k, v) for k, v in defaults.items()}
        try:
            return model(**merged)
        except ValidationError:
            return model()


def store(db: Session) -> StoreSettings: return get_section(db, "store")  # type: ignore[return-value]
def catalog(db: Session) -> CatalogSettings: return get_section(db, "catalog")  # type: ignore[return-value]
def pricing(db: Session) -> PricingSettings: return get_section(db, "pricing")  # type: ignore[return-value]
def shipping(db: Session) -> ShippingSettings: return get_section(db, "shipping")  # type: ignore[return-value]
def payment(db: Session) -> PaymentSettings: return get_section(db, "payment")  # type: ignore[return-value]
def account(db: Session) -> AccountSettings: return get_section(db, "account")  # type: ignore[return-value]
def content(db: Session) -> ContentSettings: return get_section(db, "content")  # type: ignore[return-value]


def _validate_payment_change(new: PaymentSettings) -> None:
    if new.mode == "live" and not env.PAYMENT_LIVE_ALLOWED:
        raise BusinessRuleError("Live payment mode is disabled for this deployment (PAYMENT_LIVE_ALLOWED=false).")
    if new.provider == "razorpay" and not (env.RAZORPAY_KEY_ID and env.RAZORPAY_KEY_SECRET):
        raise BusinessRuleError("Razorpay credentials are not configured on the server.")
    if new.provider == "mock" and new.mode == "live":
        raise BusinessRuleError("The mock provider cannot be used in live mode.")
    if "INR" not in new.supported_currencies:
        raise BusinessRuleError("INR must remain a supported payment currency (base currency).")


def update_section(db: Session, section: str, patch: dict, actor: User, ip: str | None = None,
                   reason: str | None = None) -> _Section:
    model = SECTIONS.get(section)
    if not model:
        raise NotFound(f"Unknown settings section '{section}'")
    current = get_section(db, section)
    merged = {**current.model_dump(mode="json"), **patch}
    try:
        new = model(**merged)
    except ValidationError as e:
        raise AppError("Invalid settings", code="validation_error", status_code=422,
                       details=[{"loc": list(x["loc"]), "msg": x["msg"]} for x in e.errors()])
    if section == "payment":
        _validate_payment_change(new)  # type: ignore[arg-type]
    if section == "shipping" and new.international_free_threshold < 0:  # type: ignore[attr-defined]
        raise BusinessRuleError("Threshold must be non-negative")

    row = db.get(SiteSetting, section)
    before = current.model_dump(mode="json")
    after = new.model_dump(mode="json")
    if row is None:
        row = SiteSetting(section=section, value=after, version=1, updated_by_user_id=actor.id)
        db.add(row)
    else:
        row.value = after
        row.version = (row.version or 1) + 1
        row.updated_by_user_id = actor.id
    changed = {k: {"from": before.get(k), "to": v} for k, v in after.items() if before.get(k) != v}
    audit(db, actor, "settings.update", "site_settings", section,
          before={k: c["from"] for k, c in changed.items()}, after={k: c["to"] for k, c in changed.items()},
          reason=reason, ip=ip)
    db.commit()
    return new
