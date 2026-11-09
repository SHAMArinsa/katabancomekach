"""Password hashing (Argon2id), JWT access tokens, opaque refresh tokens, TOTP for admin MFA."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError, Exception):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except Exception:
        return False


def create_access_token(user_id: int, scope: str, extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "scope": scope,  # "customer" | "admin"
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)).timestamp()),
        "type": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), token.encode(), hashlib.sha256).hexdigest()


# ---- TOTP (RFC 6238) for optional admin MFA -------------------------------------------------

def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _totp_at(secret: str, counter: int) -> str:
    padded = secret + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{code:06d}"


def totp_now(secret: str) -> str:
    return _totp_at(secret, int(time.time()) // 30)


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    if not code or not code.isdigit():
        return False
    counter = int(time.time()) // 30
    return any(hmac.compare_digest(_totp_at(secret, counter + d), code) for d in range(-window, window + 1))


def totp_uri(secret: str, email: str, issuer: str) -> str:
    from urllib.parse import quote
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}"
