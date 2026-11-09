from datetime import datetime
from decimal import Decimal

from sqlalchemy import (Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
                        UniqueConstraint)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Money, TimestampMixin
from app.models.enums import CATEGORY_STATUSES, FRAGILITY_LEVELS, PRODUCT_STATUSES, check_in


class Category(Base, TimestampMixin):
    __tablename__ = "categories"
    __table_args__ = (CheckConstraint(check_in("status", CATEGORY_STATUSES), name="status"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="published")
    seo_title: Mapped[str | None] = mapped_column(String(160))
    seo_description: Mapped[str | None] = mapped_column(String(320))

    children: Mapped[list["Category"]] = relationship(back_populates="parent", order_by="Category.position")
    parent: Mapped["Category | None"] = relationship(back_populates="children", remote_side="Category.id")


class Collection(Base, TimestampMixin):
    """Brand / designer / featured / gift / seasonal collections."""
    __tablename__ = "collections"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True)
    kind: Mapped[str] = mapped_column(String(24), default="featured")  # featured|gift|seasonal|designer|premium
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str | None] = mapped_column(String(500))
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ProductCollection(Base):
    __tablename__ = "product_collections"
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(check_in("status", PRODUCT_STATUSES), name="status"),
        CheckConstraint(check_in("fragility", FRAGILITY_LEVELS), name="fragility"),
        CheckConstraint("price >= 0", name="price_nonneg"),
        CheckConstraint("compare_at_price IS NULL OR compare_at_price >= 0", name="compare_nonneg"),
        Index("ix_products_search", "name", "sku"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True)
    short_description: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"), index=True)
    brand: Mapped[str | None] = mapped_column(String(120))
    glass_type: Mapped[str | None] = mapped_column(String(120))
    material: Mapped[str | None] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(80))
    finish: Mapped[str | None] = mapped_column(String(80))
    dimensions: Mapped[str | None] = mapped_column(String(120))  # e.g. "H 30 cm × Ø 12 cm"
    capacity: Mapped[str | None] = mapped_column(String(60))
    weight_grams: Mapped[int | None] = mapped_column(Integer)
    package_weight_grams: Mapped[int | None] = mapped_column(Integer)
    package_length_cm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    package_width_cm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    package_height_cm: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    fragility: Mapped[str] = mapped_column(String(20), default="fragile")
    care_instructions: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[Decimal] = mapped_column(Money)
    compare_at_price: Mapped[Decimal | None] = mapped_column(Money)
    sale_price: Mapped[Decimal | None] = mapped_column(Money)
    sale_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sale_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tax_class: Mapped[str] = mapped_column(String(40), default="standard")
    hs_code: Mapped[str | None] = mapped_column(String(16))
    country_of_origin: Mapped[str] = mapped_column(String(2), default="IN")
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=5)
    gift_wrap_available: Mapped[bool] = mapped_column(Boolean, default=True)
    gift_wrap_price: Mapped[Decimal] = mapped_column(Money, default=0)
    # Destination availability: domestic_only | international | restricted list via blocked_countries
    ships_internationally: Mapped[bool] = mapped_column(Boolean, default=True)
    blocked_countries: Mapped[list[str]] = mapped_column(ARRAY(String(2)), default=list)
    search_keywords: Mapped[str] = mapped_column(Text, default="")
    seo_title: Mapped[str | None] = mapped_column(String(160))
    seo_description: Mapped[str | None] = mapped_column(String(320))
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_bestseller: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_new_arrival: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    badge: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    category: Mapped[Category | None] = relationship(lazy="joined")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product", order_by="ProductImage.position", cascade="all, delete-orphan", lazy="selectin")
    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product", order_by="ProductVariant.position", cascade="all, delete-orphan", lazy="selectin")
    attributes: Mapped[list["ProductAttribute"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="ProductAttribute.position")
    collections: Mapped[list[Collection]] = relationship(secondary="product_collections", lazy="selectin")


class ProductVariant(Base, TimestampMixin):
    """Every product has at least one (default) variant; inventory is per variant."""
    __tablename__ = "product_variants"
    __table_args__ = (CheckConstraint("price_override IS NULL OR price_override >= 0", name="price_nonneg"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120), default="Default")
    options: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"Color": "Amber", "Size": "Large"}
    price_override: Mapped[Decimal | None] = mapped_column(Money)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped[Product] = relationship(back_populates="variants")
    inventory: Mapped["Inventory | None"] = relationship(uselist=False, lazy="selectin", cascade="all, delete-orphan")


class ProductImage(Base, TimestampMixin):
    __tablename__ = "product_images"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    storage_key: Mapped[str | None] = mapped_column(String(500))
    alt_text: Mapped[str] = mapped_column(String(255), default="")
    media_type: Mapped[str] = mapped_column(String(10), default="image")  # image | video
    position: Mapped[int] = mapped_column(Integer, default=0)
    product: Mapped[Product] = relationship(back_populates="images")


class ProductAttribute(Base):
    __tablename__ = "product_attributes"
    __table_args__ = (UniqueConstraint("product_id", "name"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    value: Mapped[str] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, default=0)


class ProductReview(Base, TimestampMixin):
    """Only verified purchasers can review; only approved reviews are shown."""
    __tablename__ = "product_reviews"
    __table_args__ = (CheckConstraint("rating BETWEEN 1 AND 5", name="rating"),
                      UniqueConstraint("user_id", "product_id", "order_id"))
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(160), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    display_name: Mapped[str] = mapped_column(String(80), default="")
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)


class UploadMetadata(Base, TimestampMixin):
    __tablename__ = "upload_metadata"
    id: Mapped[int] = mapped_column(primary_key=True)
    storage_provider: Mapped[str] = mapped_column(String(24))
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    url: Mapped[str | None] = mapped_column(String(800))
    content_type: Mapped[str] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(Integer)
    visibility: Mapped[str] = mapped_column(String(10), default="public")  # public | private
    purpose: Mapped[str] = mapped_column(String(40))  # product_image | category_image | content | damage_evidence | brand
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


from app.models.inventory import Inventory  # noqa: E402,F401
