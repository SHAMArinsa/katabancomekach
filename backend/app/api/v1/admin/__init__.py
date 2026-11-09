from fastapi import APIRouter

from app.api.v1.admin import catalog, config, customers, operations, staff

router = APIRouter(prefix="/admin")
for module in (operations, catalog, customers, config, staff):
    router.include_router(module.router)
