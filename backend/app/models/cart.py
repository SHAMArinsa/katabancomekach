from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.catalog import ProductVariant


class Cart(Base, TimestampMixin):
    __tablename__ = "carts"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    coupon_code: Mapped[str | None] = mapped_column(String(40))
    items: Mapped[list["CartItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin",
                                                   order_by="CartItem.id")


class CartItem(Base, TimestampMixin):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("cart_id", "variant_id", "gift_wrap"),
                      CheckConstraint("quantity > 0", name="qty_pos"))
    id: Mapped[int] = mapped_column(primary_key=True)
    cart_id: Mapped[int] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    quantity: Mapped[int] = mapped_column(Integer)
    gift_wrap: Mapped[bool] = mapped_column(Boolean, default=False)
    variant: Mapped[ProductVariant] = relationship(lazy="joined")


class Wishlist(Base, TimestampMixin):
    __tablename__ = "wishlists"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    items: Mapped[list["WishlistItem"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class WishlistItem(Base, TimestampMixin):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("wishlist_id", "product_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    wishlist_id: Mapped[int] = mapped_column(ForeignKey("wishlists.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
