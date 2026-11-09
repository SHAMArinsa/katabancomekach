"""Templated customer notifications. Templates use {placeholder} substitution only."""
import string

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import logger
from app.integrations.email import get_email_sender
from app.models import EmailTemplate, NotificationLog, Order
from app.services import site_settings

DEFAULT_TEMPLATES: dict[str, tuple[str, str]] = {
    "verify_email": ("Confirm your email — {brand}",
                     "Hello {name},\n\nPlease confirm your email address:\n{link}\n\nThis link expires in 48 hours."),
    "password_reset": ("Reset your password — {brand}",
                       "Hello {name},\n\nReset your password using this link (valid for 1 hour):\n{link}\n\n"
                       "If you did not request this, you can ignore this email."),
    "order_confirmation": ("Order {order_number} confirmed — {brand}",
                           "Hello {name},\n\nThank you. We have received your payment of {total} for order "
                           "{order_number}.\n\nDelivery: {shipping_note}\n\nTrack your order: {link}"),
    "payment_failed": ("Payment not completed for {order_number}",
                       "Hello {name},\n\nYour payment for order {order_number} was not completed. No amount was "
                       "captured. You can retry from your account: {link}"),
    "order_dispatched": ("Order {order_number} is on its way",
                         "Hello {name},\n\nYour order has been dispatched with {courier}. Tracking number: "
                         "{tracking_number}.\n{shipping_note}\n\nTrack: {link}"),
    "order_delivered": ("Order {order_number} delivered",
                        "Hello {name},\n\nYour order has been delivered. If anything arrived damaged, please report "
                        "it within the claim window from your account: {link}"),
    "order_cancelled": ("Order {order_number} cancelled",
                        "Hello {name},\n\nOrder {order_number} has been cancelled. {detail}"),
    "refund_processed": ("Refund for {order_number}",
                         "Hello {name},\n\nA refund of {amount} has been issued for order {order_number}. It may take "
                         "5–10 business days to appear."),
    "return_update": ("Update on your return for {order_number}",
                      "Hello {name},\n\nYour return request is now: {status}. {detail}"),
}


class _SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def render(template: str, ctx: dict) -> str:
    # Only plain {name} fields are substituted; attribute/index access is stripped.
    out = []
    for literal, field, _spec, _conv in string.Formatter().parse(template):
        out.append(literal)
        if field is not None:
            out.append(str(ctx.get(field, "{" + field + "}")) if field.isidentifier() else "")
    return "".join(out)


def notify(db: Session, key: str, to: str, ctx: dict, order: Order | None = None, pref: str | None = None) -> None:
    notif = site_settings.get_section(db, "notifications")
    store = site_settings.store(db)
    if pref and not getattr(notif, pref, True):
        db.add(NotificationLog(template_key=key, recipient=to, subject="", status="skipped",
                               order_id=order.id if order else None))
        return
    tpl = db.get(EmailTemplate, key)
    if tpl is not None and not tpl.is_enabled:
        return
    subject_t, body_t = (tpl.subject, tpl.body) if tpl else DEFAULT_TEMPLATES[key]
    ctx = {"brand": store.brand_name, **ctx}
    subject, body = render(subject_t, ctx), render(body_t, ctx)
    status, error = "sent", None
    try:
        get_email_sender().send(to, subject, body, notif.sender_name)  # type: ignore[attr-defined]
    except Exception as e:  # never break business flow because email failed
        status, error = "failed", str(e)[:500]
        logger.warning(f"email send failed: {e}")
    db.add(NotificationLog(template_key=key, recipient=to, subject=subject[:255], status=status, error=error,
                           order_id=order.id if order else None))


def frontend_link(path: str) -> str:
    return settings.FRONTEND_URL.rstrip("/") + path
