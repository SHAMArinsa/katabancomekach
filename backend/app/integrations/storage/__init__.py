"""Storage adapters.

- local: public media in LOCAL_UPLOAD_DIR (served at /media), private files in PRIVATE_UPLOAD_DIR
  (never served statically — only through authorised API endpoints).
- vercel_blob: public media uploaded server-side from FastAPI to Vercel Blob over its HTTP API.
  The write token stays on the server. Private customer documents are NOT sent to Blob; they
  stay in PRIVATE_UPLOAD_DIR (use a Render persistent disk in production).

The Vercel Blob HTTP calls mirror what the official @vercel/blob SDK does, but this adapter has
NOT been verified against a real Blob store from this codebase. See docs/DEPLOYMENT.md.
"""
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

import httpx

from app.core.config import settings


@dataclass
class StoredFile:
    key: str
    url: str | None


def _safe_key(prefix: str, ext: str) -> str:
    return f"{prefix.strip('/')}/{secrets.token_hex(12)}{ext}"


class LocalStorage:
    provider = "local"

    def save_public(self, data: bytes, prefix: str, ext: str, content_type: str) -> StoredFile:
        key = _safe_key(prefix, ext)
        path = settings.local_upload_path / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return StoredFile(key, f"{settings.PUBLIC_API_URL.rstrip('/')}/media/{key}")

    def delete_public(self, key: str, url: str | None = None) -> None:
        path = (settings.local_upload_path / key).resolve()
        if str(path).startswith(str(settings.local_upload_path)) and path.exists():
            path.unlink()


class VercelBlobStorage:
    provider = "vercel_blob"
    API = "https://blob.vercel-storage.com"

    def _headers(self, content_type: str | None = None) -> dict:
        if not settings.BLOB_READ_WRITE_TOKEN:
            raise RuntimeError("BLOB_READ_WRITE_TOKEN is not configured")
        h = {"authorization": f"Bearer {settings.BLOB_READ_WRITE_TOKEN}", "x-api-version": "7"}
        if content_type:
            h["x-content-type"] = content_type
        return h

    def save_public(self, data: bytes, prefix: str, ext: str, content_type: str) -> StoredFile:
        key = _safe_key(prefix, ext)
        r = httpx.put(f"{self.API}/{key}", content=data, headers=self._headers(content_type), timeout=60)
        r.raise_for_status()
        body = r.json()
        return StoredFile(body.get("pathname", key), body["url"])

    def delete_public(self, key: str, url: str | None = None) -> None:
        if not url:
            return
        r = httpx.post(f"{self.API}/delete", json={"urls": [url]}, headers=self._headers(), timeout=30)
        r.raise_for_status()


class PrivateStorage:
    """Private files (damage-claim evidence). Never publicly addressable."""

    def save(self, data: bytes, prefix: str, ext: str) -> str:
        key = _safe_key(prefix, ext)
        path = settings.private_upload_path / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def read(self, key: str) -> bytes:
        path = (settings.private_upload_path / key).resolve()
        if not str(path).startswith(str(settings.private_upload_path)) or not path.exists():
            raise FileNotFoundError(key)
        return path.read_bytes()


def get_public_storage():
    return VercelBlobStorage() if settings.STORAGE_PROVIDER == "vercel_blob" else LocalStorage()


private_storage = PrivateStorage()


def ensure_dirs() -> None:
    os.makedirs(settings.local_upload_path, exist_ok=True)
    os.makedirs(settings.private_upload_path, exist_ok=True)


def media_root() -> Path:
    return settings.local_upload_path
