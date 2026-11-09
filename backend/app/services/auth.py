import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError, BusinessRuleError, Forbidden, Unauthorized
from app.core.security import (create_access_token, hash_password, hash_token, needs_rehash, new_opaque_token,
                               verify_password, verify_totp)
from app.models import RefreshToken, User, UserToken
from app.services import site_settings
from app.services.notifications import frontend_link, notify

COOKIE = {"customer": "gl_rt_customer", "admin": "gl_rt_admin"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def validate_password(db: Session, password: str) -> None:
    acc = site_settings.account(db)
    if len(password) < acc.password_min_length:
        raise BusinessRuleError(f"Password must be at least {acc.password_min_length} characters.",
                                code="weak_password")
    if acc.password_require_mixed and not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        raise BusinessRuleError("Password must include letters and numbers.", code="weak_password")
    if len(password) > 128:
        raise BusinessRuleError("Password is too long.", code="weak_password")


def issue_one_time_token(db: Session, user: User, purpose: str, hours: int) -> str:
    raw = new_opaque_token()
    db.execute(update(UserToken).where(UserToken.user_id == user.id, UserToken.purpose == purpose,
                                       UserToken.used_at.is_(None)).values(used_at=_now()))
    db.add(UserToken(user_id=user.id, purpose=purpose, token_hash=hash_token(raw),
                     expires_at=_now() + timedelta(hours=hours)))
    return raw


def consume_one_time_token(db: Session, raw: str, purpose: str) -> User:
    tok = db.scalar(select(UserToken).where(UserToken.token_hash == hash_token(raw or ""),
                                            UserToken.purpose == purpose).with_for_update())
    if not tok or tok.used_at or tok.expires_at < _now():
        raise BusinessRuleError("This link is invalid or has expired.", code="invalid_token")
    tok.used_at = _now()
    return db.get(User, tok.user_id)


def send_verification(db: Session, user: User) -> str | None:
    """Sends the link. Returns it only in local development with console email, so the UI can offer it."""
    raw = issue_one_time_token(db, user, "verify_email", 48)
    link = frontend_link(f"/verify-email?token={raw}")
    notify(db, "verify_email", user.email, {"name": user.full_name, "link": link})
    if settings.APP_ENV == "development" and settings.EMAIL_PROVIDER == "console":
        return f"/verify-email?token={raw}"
    return None


def send_password_reset(db: Session, user: User, scope: str = "customer") -> None:
    raw = issue_one_time_token(db, user, "password_reset", 1)
    path = "/admin/reset-password" if scope == "admin" else "/reset-password"
    notify(db, "password_reset", user.email, {"name": user.full_name, "link": frontend_link(f"{path}?token={raw}")})


def authenticate(db: Session, email: str, password: str, scope: str, mfa_code: str | None = None) -> User:
    acc = site_settings.account(db)
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    generic = Unauthorized("Incorrect email or password", code="invalid_credentials")
    if user is None:
        verify_password(password, "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$invalidinvalidinvalidinvalid")
        raise generic
    if user.locked_until and user.locked_until > _now():
        raise AppError("Too many failed attempts. Try again later.", code="account_locked", status_code=423)
    if not verify_password(password, user.password_hash):
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= acc.max_failed_logins:
            user.locked_until = _now() + timedelta(minutes=acc.lockout_minutes)
            user.failed_login_count = 0
        db.commit()
        raise generic
    if not user.is_active or user.deleted_at:
        raise generic
    if scope == "admin":
        if not user.is_staff:
            raise generic  # do not reveal that the account exists as a customer
        if user.mfa_enabled:
            if not mfa_code:
                raise AppError("Enter your authenticator code", code="mfa_required", status_code=401)
            if not verify_totp(user.mfa_secret or "", mfa_code):
                raise Unauthorized("Invalid authenticator code", code="invalid_mfa")
    else:
        if user.is_staff:
            raise Forbidden("Staff accounts must use the admin portal.", code="staff_account")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = _now()
    return user


def _set_cookie(response: Response, scope: str, raw: str, expires: datetime) -> None:
    response.set_cookie(COOKIE[scope], raw, httponly=True, secure=settings.COOKIE_SECURE,
                        samesite=settings.COOKIE_SAMESITE, domain=settings.COOKIE_DOMAIN,
                        path="/api/v1/auth", expires=int(expires.timestamp()))


def clear_cookie(response: Response, scope: str) -> None:
    response.delete_cookie(COOKIE[scope], path="/api/v1/auth", domain=settings.COOKIE_DOMAIN)


def start_session(db: Session, user: User, scope: str, response: Response, request: Request,
                  family_id: str | None = None) -> str:
    raw = new_opaque_token()
    expires = _now() + timedelta(days=settings.REFRESH_TOKEN_DAYS if scope == "customer" else 1)
    db.add(RefreshToken(user_id=user.id, token_hash=hash_token(raw), scope=scope,
                        family_id=family_id or secrets.token_hex(16), expires_at=expires,
                        user_agent=(request.headers.get("user-agent") or "")[:255]))
    _set_cookie(response, scope, raw, expires)
    extra = {"perms": sorted(user.permission_codes)} if scope == "admin" else None
    return create_access_token(user.id, scope, extra)


def rotate(db: Session, request: Request, response: Response, scope: str) -> tuple[User, str]:
    raw = request.cookies.get(COOKIE[scope])
    if not raw:
        raise Unauthorized("No session", code="no_session")
    tok = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)).with_for_update()
                  .execution_options(populate_existing=True))
    if not tok or tok.scope != scope:
        clear_cookie(response, scope)
        raise Unauthorized("Invalid session", code="no_session")
    if tok.revoked_at is not None:
        # Reuse of a rotated token: assume theft, revoke the whole family.
        db.execute(update(RefreshToken).where(RefreshToken.family_id == tok.family_id,
                                              RefreshToken.revoked_at.is_(None)).values(revoked_at=_now()))
        db.commit()
        clear_cookie(response, scope)
        raise Unauthorized("Session expired", code="no_session")
    if tok.expires_at < _now():
        clear_cookie(response, scope)
        raise Unauthorized("Session expired", code="no_session")
    user = db.get(User, tok.user_id)
    if not user or not user.is_active or user.deleted_at or (scope == "admin" and not user.is_staff):
        raise Unauthorized("Account unavailable", code="no_session")
    tok.revoked_at = _now()
    access = start_session(db, user, scope, response, request, family_id=tok.family_id)
    return user, access


def logout(db: Session, request: Request, response: Response, scope: str) -> None:
    raw = request.cookies.get(COOKIE[scope])
    if raw:
        tok = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
        if tok:
            db.execute(update(RefreshToken).where(RefreshToken.family_id == tok.family_id,
                                                  RefreshToken.revoked_at.is_(None)).values(revoked_at=_now()))
    clear_cookie(response, scope)


def revoke_all(db: Session, user: User) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now()))


def require_csrf_header(request: Request) -> None:
    """Cookie-authenticated endpoints require a custom header. Browsers can't send it cross-origin
    without a CORS preflight, which our strict CORS policy rejects for unknown origins."""
    if request.headers.get("x-requested-with", "").lower() != "fetch":
        raise Forbidden("Missing CSRF header", code="csrf")
