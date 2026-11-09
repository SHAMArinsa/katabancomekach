import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, logger
from app.db.session import engine
from app.integrations.storage import ensure_dirs, media_root

configure_logging(settings.LOG_LEVEL)

app = FastAPI(
    title=f"{settings.APP_NAME} API",
    version="1.0.0",
    description="Premium glass home & décor commerce API. Namespaces: public, auth, customer, admin, payments, "
                "shipping, webhooks.",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    max_age=600,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
    start = time.perf_counter()
    response = await call_next(request)
    dur = round((time.perf_counter() - start) * 1000, 1)
    response.headers["X-Request-ID"] = rid
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api/v1/admin") or request.url.path.startswith("/api/v1/customer") \
            or request.url.path.startswith("/api/v1/auth"):
        response.headers["Cache-Control"] = "no-store"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path != "/health":
        logger.info("request", extra={"request_id": rid, "method": request.method, "path": request.url.path,
                                      "status": response.status_code, "duration_ms": dur})
    return response


register_error_handlers(app)
app.include_router(api_router)

ensure_dirs()
app.mount("/media", StaticFiles(directory=str(media_root())), name="media")


@app.get("/health", tags=["ops"])
def health():
    db_ok = True
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "env": settings.APP_ENV}


@app.get("/", include_in_schema=False)
def root():
    return {"name": settings.APP_NAME, "docs": "/docs", "health": "/health"}
