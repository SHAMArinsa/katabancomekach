from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import AdminAuditLog, User


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items() if k not in {"password_hash", "mfa_secret"}}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def audit(db: Session, actor: User | None, action: str, entity_type: str, entity_id: Any = None,
          before: dict | None = None, after: dict | None = None, reason: str | None = None,
          ip: str | None = None) -> AdminAuditLog:
    log = AdminAuditLog(
        actor_user_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        before=_clean(before) if before is not None else None,
        after=_clean(after) if after is not None else None,
        reason=reason,
        ip_address=ip,
        created_at=datetime.now(timezone.utc),
    )
    db.add(log)
    return log
