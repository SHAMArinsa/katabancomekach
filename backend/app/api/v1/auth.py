from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_admin, get_current_customer, request_ip
from app.core.errors import BusinessRuleError, Conflict
from app.core.rate_limit import rate_limit
from app.core.security import hash_password
from app.db.session import get_db
from app.models import ConsentRecord, User
from app.schemas.common import EmailIn, LoginIn, RegisterIn, ResetPasswordIn, TokenIn
from app.schemas.serializers import staff_out, user_out
from app.services import auth as auth_svc
from app.services import site_settings

router = APIRouter(prefix="/auth", tags=["auth"])
auth_limit = rate_limit("auth", limit=10, window_s=60)


def _now():
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------ customer

@router.post("/register", status_code=201, dependencies=[Depends(auth_limit)])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    acc = site_settings.account(db)
    if not acc.registration_enabled:
        raise BusinessRuleError("Registration is currently closed.", code="registration_closed")
    if not body.accept_terms:
        raise BusinessRuleError("Please accept the terms and privacy policy.", code="terms_required")
    auth_svc.validate_password(db, body.password)
    if db.scalar(select(User).where(User.email == body.email)):
        raise Conflict("An account with this email already exists.", code="email_taken")
    priv = site_settings.get_section(db, "privacy")
    user = User(email=body.email, password_hash=hash_password(body.password), full_name=body.full_name,
                phone=body.phone, marketing_opt_in=body.marketing_opt_in)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("An account with this email already exists.", code="email_taken")
    ip = request_ip(request)
    db.add(ConsentRecord(user_id=user.id, email=user.email, consent_type="terms", granted=True,
                         version=priv.terms_version, ip_address=ip))  # type: ignore[attr-defined]
    db.add(ConsentRecord(user_id=user.id, email=user.email, consent_type="marketing",
                         granted=body.marketing_opt_in, ip_address=ip))
    dev_link = None
    if acc.require_email_verification:
        dev_link = auth_svc.send_verification(db, user)
    else:
        user.email_verified_at = _now()
    access = auth_svc.start_session(db, user, "customer", response, request)
    db.commit()
    return {"access_token": access, "user": user_out(user),
            "email_verification_required": acc.require_email_verification, "dev_verification_link": dev_link}


@router.post("/login", dependencies=[Depends(auth_limit)])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = auth_svc.authenticate(db, body.email, body.password, "customer")
    access = auth_svc.start_session(db, user, "customer", response, request)
    db.commit()
    return {"access_token": access, "user": user_out(user)}


@router.post("/refresh", dependencies=[Depends(auth_svc.require_csrf_header), Depends(rate_limit("refresh", 60, 60))])
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    user, access = auth_svc.rotate(db, request, response, "customer")
    db.commit()
    return {"access_token": access, "user": user_out(user)}


@router.post("/logout", dependencies=[Depends(auth_svc.require_csrf_header)])
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth_svc.logout(db, request, response, "customer")
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_customer)):
    return user_out(user)


@router.post("/verify-email", dependencies=[Depends(auth_limit)])
def verify_email(body: TokenIn, db: Session = Depends(get_db)):
    user = auth_svc.consume_one_time_token(db, body.token, "verify_email")
    user.email_verified_at = user.email_verified_at or _now()
    db.commit()
    return {"ok": True}


@router.post("/resend-verification", dependencies=[Depends(auth_limit)])
def resend_verification(user: User = Depends(get_current_customer), db: Session = Depends(get_db)):
    if user.email_verified_at:
        return {"ok": True, "already_verified": True}
    dev_link = auth_svc.send_verification(db, user)
    db.commit()
    return {"ok": True, "dev_verification_link": dev_link}


@router.post("/forgot-password", dependencies=[Depends(auth_limit)])
def forgot_password(body: EmailIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user and user.is_active and not user.deleted_at:
        auth_svc.send_password_reset(db, user, "admin" if user.is_staff else "customer")
        db.commit()
    return {"ok": True, "message": "If an account exists for that email, a reset link has been sent."}


@router.post("/reset-password", dependencies=[Depends(auth_limit)])
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    auth_svc.validate_password(db, body.password)
    user = auth_svc.consume_one_time_token(db, body.token, "password_reset")
    user.password_hash = hash_password(body.password)
    user.failed_login_count = 0
    user.locked_until = None
    auth_svc.revoke_all(db, user)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ admin (separate scope + cookie)

@router.post("/admin/login", dependencies=[Depends(rate_limit("admin-auth", 5, 60))])
def admin_login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = auth_svc.authenticate(db, body.email, body.password, "admin", body.mfa_code)
    access = auth_svc.start_session(db, user, "admin", response, request)
    from app.services.audit import audit
    audit(db, user, "admin.login", "user", user.id, ip=request_ip(request))
    db.commit()
    return {"access_token": access, "user": staff_out(user)}


@router.post("/admin/refresh", dependencies=[Depends(auth_svc.require_csrf_header), Depends(rate_limit("refresh", 60, 60))])
def admin_refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    user, access = auth_svc.rotate(db, request, response, "admin")
    db.commit()
    return {"access_token": access, "user": staff_out(user)}


@router.post("/admin/logout", dependencies=[Depends(auth_svc.require_csrf_header)])
def admin_logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth_svc.logout(db, request, response, "admin")
    db.commit()
    return {"ok": True}


@router.get("/admin/me")
def admin_me(admin: User = Depends(get_current_admin)):
    return staff_out(admin)
