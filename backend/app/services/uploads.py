"""Secure image upload handling: size limit, real-content type check (Pillow), metadata stripping."""
import io

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from app.core.config import settings
from app.core.errors import BusinessRuleError

ALLOWED = {"JPEG": ("image/jpeg", ".jpg"), "PNG": ("image/png", ".png"), "WEBP": ("image/webp", ".webp")}
Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard


def read_image(upload: UploadFile, max_mb: int | None = None) -> tuple[bytes, str, str]:
    """Returns (clean_bytes, content_type, extension). Re-encodes to drop EXIF/GPS and any appended payloads."""
    limit = (max_mb or settings.MAX_UPLOAD_MB) * 1024 * 1024
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise BusinessRuleError(f"File too large (max {max_mb or settings.MAX_UPLOAD_MB} MB).", code="file_too_large")
    if not data:
        raise BusinessRuleError("Empty file.", code="invalid_file")
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()
        img = Image.open(io.BytesIO(data))
        fmt = img.format
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise BusinessRuleError("Only JPEG, PNG or WebP images are accepted.", code="invalid_file")
    if fmt not in ALLOWED:
        raise BusinessRuleError("Only JPEG, PNG or WebP images are accepted.", code="invalid_file")
    content_type, ext = ALLOWED[fmt]
    out = io.BytesIO()
    if fmt == "JPEG":
        img.convert("RGB").save(out, "JPEG", quality=90, optimize=True)
    elif fmt == "PNG":
        img.save(out, "PNG", optimize=True)
    else:
        img.save(out, "WEBP", quality=90)
    return out.getvalue(), content_type, ext
