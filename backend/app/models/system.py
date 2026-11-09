from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class SiteSetting(Base, TimestampMixin):
    """Business settings, one JSON document per section (validated by Pydantic before saving)."""
    __tablename__ = "site_settings"
    section: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ContentBlock(Base, TimestampMixin):
    """Homepage sections, banners, FAQs, footer links etc."""
    __tablename__ = "content_blocks"
    id: Mapped[int] = mapped_column(primary_key=True)
    placement: Mapped[str] = mapped_column(String(40), index=True)  # hero|banner|campaign|story|craft|packaging|faq|footer_link|category_feature
    title: Mapped[str] = mapped_column(String(200), default="")
    subtitle: Mapped[str] = mapped_column(String(500), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(500))
    link_url: Mapped[str | None] = mapped_column(String(500))
    link_label: Mapped[str | None] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data: Mapped[dict] = mapped_column(JSONB, default=dict)


class CmsPage(Base, TimestampMixin):
    """About, policies, terms etc. Body is plain text with light markdown (rendered safely)."""
    __tablename__ = "cms_pages"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    seo_title: Mapped[str | None] = mapped_column(String(160))
    seo_description: Mapped[str | None] = mapped_column(String(320))
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)


class EmailTemplate(Base, TimestampMixin):
    __tablename__ = "email_templates"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)  # supports {placeholders} only — no code execution
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class NotificationLog(Base, TimestampMixin):
    __tablename__ = "notification_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    channel: Mapped[str] = mapped_column(String(16), default="email")
    template_key: Mapped[str] = mapped_column(String(60))
    recipient: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16))  # sent | failed | skipped
    error: Mapped[str | None] = mapped_column(Text)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    actor_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[str | None] = mapped_column(String(60))
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
