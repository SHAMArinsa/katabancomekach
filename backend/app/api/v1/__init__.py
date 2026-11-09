from fastapi import APIRouter

from app.api.v1 import admin, auth, customer, payments, public, shipping, webhooks

api_router = APIRouter(prefix="/api/v1")
for r in (public.router, auth.router, customer.router, payments.router, shipping.router, webhooks.router,
          admin.router):
    api_router.include_router(r)
