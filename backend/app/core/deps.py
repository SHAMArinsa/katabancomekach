"""Authentication / authorization dependencies.

Customer and admin tokens carry different scopes and are never interchangeable:
customer routes require scope=customer, admin routes require scope=admin AND a
staff account AND the specific permission.
"""
from datetime import datetime, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User

bearer = HTTPBearer(auto_error=False)


def _user_from_token(db: Session, creds: HTTPAuthorizationCredentials | None, scope: str) -> User:
    if not creds or creds.scheme.lower() != "bearer":
        raise Unauthorized("Authentication required")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Session expired", code="token_expired")
    except jwt.PyJWTError:
        raise Unauthorized("Invalid token")
    if payload.get("type") != "access" or payload.get("scope") != scope:
        raise Unauthorized("Token not valid for this portal")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or user.deleted_at:
        raise Unauthorized("Account unavailable")
    return user


def get_current_customer(db: Session = Depends(get_db),
                         creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    user = _user_from_token(db, creds, "customer")
    if user.restricted_at:
        raise Forbidden("Your account is restricted. Please contact support.", code="account_restricted")
    return user


def get_optional_customer(db: Session = Depends(get_db),
                          creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User | None:
    if not creds:
        return None
    try:
        return _user_from_token(db, creds, "customer")
    except Unauthorized:
        return None


def get_current_admin(db: Session = Depends(get_db),
                      creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> User:
    user = _user_from_token(db, creds, "admin")
    if not user.is_staff:
        raise Forbidden("Staff access only")
    return user


def require(*codes: str):
    """Require ALL of the given permission codes."""
    def dependency(admin: User = Depends(get_current_admin)) -> User:
        missing = [c for c in codes if c not in admin.permission_codes]
        if missing:
            raise Forbidden("You do not have permission for this action", details={"missing": missing})
        return admin
    return dependency


def request_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
