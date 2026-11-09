import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session


def slugify(value: str, max_len: int = 200) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return (value or "item")[:max_len].strip("-")


def unique_slug(db: Session, model, base: str, exclude_id: int | None = None) -> str:
    base = slugify(base)
    slug, n = base, 2
    while True:
        q = select(model.id).where(model.slug == slug)
        if exclude_id:
            q = q.where(model.id != exclude_id)
        if not db.scalar(q):
            return slug
        slug = f"{base}-{n}"
        n += 1
