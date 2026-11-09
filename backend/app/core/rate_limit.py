"""Simple in-process sliding-window rate limiter.

Suitable for a single Render instance. If you scale to several instances,
swap this for a Redis-backed limiter (documented in DEPLOYMENT.md).
"""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import settings
from app.core.errors import AppError


class _Limiter:
    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: int) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window_s:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = _Limiter()


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(name: str, limit: int, window_s: int):
    def dependency(request: Request):
        if not settings.RATE_LIMIT_ENABLED:
            return
        if not limiter.hit(f"{name}:{client_ip(request)}", limit, window_s):
            raise AppError("Too many requests. Please wait and try again.", code="rate_limited", status_code=429)
    return dependency
