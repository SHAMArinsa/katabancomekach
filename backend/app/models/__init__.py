"""Import every model so Alembic autogenerate and metadata.create_all see them."""
from app.models.user import (ConsentRecord, NewsletterSubscriber, Permission, RefreshToken, Role, User,  # noqa: F401
                             UserAddress, UserRole, UserToken, role_permissions)
from app.models.catalog import (Category, Collection, Product, ProductAttribute, ProductCollection,  # noqa: F401
                                ProductImage, ProductReview, ProductVariant, UploadMetadata)
from app.models.inventory import Inventory, InventoryMovement, InventoryReservation  # noqa: F401
from app.models.cart import Cart, CartItem, Wishlist, WishlistItem  # noqa: F401
from app.models.order import Order, OrderAddress, OrderItem, OrderStatusHistory  # noqa: F401
from app.models.payment import Payment, PaymentEvent, Refund  # noqa: F401
from app.models.shipping import (DestinationEligibility, Shipment, ShipmentTrackingEvent,  # noqa: F401
                                 ShippingFeeCollection, ShippingProvider, ShippingRate, ShippingZone)
from app.models.commerce import Coupon, CouponRedemption, Currency, ExchangeRate, TaxRule  # noqa: F401
from app.models.support import DamageClaim, Return, ReturnItem, SupportMessage, SupportTicket  # noqa: F401
from app.models.system import (AdminAuditLog, CmsPage, ContentBlock, EmailTemplate,  # noqa: F401
                               NotificationLog, SiteSetting)
