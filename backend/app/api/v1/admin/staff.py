from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_admin, request_ip, require
from app.core.errors import BusinessRuleError, Conflict, NotFound
from app.core.permissions import PERMISSIONS
from app.core.security import hash_password, new_totp_secret, totp_uri, verify_totp
from app.db.session import get_db
from app.models import AdminAuditLog, Permission, Role, User, UserRole
from app.schemas.admin import MfaEnableIn, RoleIn, StaffIn, StaffPatch
from app.schemas.serializers import staff_out
from app.services import site_settings
from app.services.audit import audit
from app.services.auth import revoke_all, validate_password

router = APIRouter(tags=["admin-staff"])


def _super_admin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(UserRole).join(Role, Role.id == UserRole.role_id)
                     .join(User, User.id == UserRole.user_id)
                     .where(Role.name == "Super Admin", User.is_active.is_(True))) or 0


@router.get("/permissions")
def permissions(_: User = Depends(require("staff.manage"))):
    return [{"code": k, "description": v} for k, v in PERMISSIONS.items()]


def _role_out(r: Role) -> dict:
    return {"id": r.id, "name": r.name, "description": r.description, "is_system": r.is_system,
            "permissions": sorted(p.code for p in r.permissions)}


@router.get("/roles")
def roles(db: Session = Depends(get_db), _: User = Depends(require("staff.manage"))):
    return [_role_out(r) for r in db.scalars(select(Role).order_by(Role.id)).all()]


def _perms(db: Session, codes: list[str]) -> list[Permission]:
    unknown = set(codes) - set(PERMISSIONS)
    if unknown:
        raise BusinessRuleError(f"Unknown permissions: {', '.join(sorted(unknown))}")
    return list(db.scalars(select(Permission).where(Permission.code.in_(codes))).all())


@router.post("/roles", status_code=201)
def create_role(body: RoleIn, db: Session = Depends(get_db), admin: User = Depends(require("staff.manage"))):
    if db.scalar(select(Role).where(Role.name == body.name)):
        raise Conflict("Role already exists")
    r = Role(name=body.name, description=body.description, permissions=_perms(db, body.permissions))
    db.add(r)
    db.flush()
    audit(db, admin, "role.create", "role", r.id, after=_role_out(r))
    db.commit()
    return _role_out(r)


@router.put("/roles/{rid}")
def update_role(rid: int, body: RoleIn, db: Session = Depends(get_db), admin: User = Depends(require("staff.manage"))):
    r = db.get(Role, rid)
    if not r:
        raise NotFound("Role not found")
    if r.name == "Super Admin" and set(body.permissions) != set(PERMISSIONS):
        raise BusinessRuleError("Super Admin always holds every permission.")
    before = _role_out(r)
    if not r.is_system:
        r.name = body.name
    r.description = body.description
    r.permissions = _perms(db, body.permissions)
    audit(db, admin, "role.update", "role", r.id, before=before, after=_role_out(r))
    db.commit()
    return _role_out(r)


@router.delete("/roles/{rid}")
def delete_role(rid: int, db: Session = Depends(get_db), admin: User = Depends(require("staff.manage"))):
    r = db.get(Role, rid)
    if not r:
        raise NotFound("Role not found")
    if r.is_system:
        raise BusinessRuleError("Built-in roles cannot be deleted.")
    if db.scalar(select(func.count()).select_from(UserRole).where(UserRole.role_id == rid)):
        raise BusinessRuleError("Remove this role from staff members first.")
    audit(db, admin, "role.delete", "role", rid, before=_role_out(r))
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/staff")
def staff(db: Session = Depends(get_db), _: User = Depends(require("staff.manage"))):
    return [staff_out(u) for u in db.scalars(select(User).where(User.is_staff.is_(True)).order_by(User.id)).all()]


@router.post("/staff", status_code=201)
def create_staff(body: StaffIn, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(require("staff.manage"))):
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise Conflict("A user with this email already exists.")
    validate_password(db, body.password)
    roles_ = list(db.scalars(select(Role).where(Role.id.in_(body.role_ids))).all())
    u = User(email=email, full_name=body.full_name, password_hash=hash_password(body.password), is_staff=True,
             email_verified_at=datetime.now(timezone.utc), roles=roles_)
    db.add(u)
    db.flush()
    audit(db, admin, "staff.create", "user", u.id, after={"email": email, "roles": [r.name for r in roles_]},
          ip=request_ip(request))
    db.commit()
    return staff_out(u)


@router.patch("/staff/{uid}")
def update_staff(uid: int, body: StaffPatch, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(require("staff.manage"))):
    u = db.get(User, uid)
    if not u or not u.is_staff:
        raise NotFound("Staff member not found")
    before = staff_out(u)
    was_super = any(r.name == "Super Admin" for r in u.roles)
    if body.full_name is not None:
        u.full_name = body.full_name
    if body.role_ids is not None:
        u.roles = list(db.scalars(select(Role).where(Role.id.in_(body.role_ids))).all())
    if body.is_active is not None:
        u.is_active = body.is_active
        if not body.is_active:
            revoke_all(db, u)
    db.flush()
    still_super = any(r.name == "Super Admin" for r in u.roles) and u.is_active
    if was_super and not still_super and _super_admin_count(db) < 1:
        db.rollback()
        raise BusinessRuleError("At least one active Super Admin is required.")
    audit(db, admin, "staff.update", "user", u.id, before=before, after=staff_out(u), ip=request_ip(request))
    db.commit()
    return staff_out(u)


# ------------------------------------------------------------------ own MFA

@router.post("/me/mfa/setup")
def mfa_setup(db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    if admin.mfa_enabled:
        raise BusinessRuleError("MFA is already enabled.")
    admin.mfa_secret = new_totp_secret()
    db.commit()
    return {"secret": admin.mfa_secret,
            "otpauth_uri": totp_uri(admin.mfa_secret, admin.email, site_settings.store(db).brand_name + " Admin")}


@router.post("/me/mfa/enable")
def mfa_enable(body: MfaEnableIn, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    if not admin.mfa_secret or not verify_totp(admin.mfa_secret, body.code):
        raise BusinessRuleError("That code is not valid. Check your authenticator app's time and try again.")
    admin.mfa_enabled = True
    audit(db, admin, "staff.mfa_enable", "user", admin.id)
    db.commit()
    return {"ok": True}


@router.post("/me/mfa/disable")
def mfa_disable(body: MfaEnableIn, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    if not admin.mfa_enabled or not verify_totp(admin.mfa_secret or "", body.code):
        raise BusinessRuleError("That code is not valid.")
    admin.mfa_enabled = False
    admin.mfa_secret = None
    audit(db, admin, "staff.mfa_disable", "user", admin.id)
    db.commit()
    return {"ok": True}


@router.post("/me/password")
def change_own_password(body: dict, request: Request, db: Session = Depends(get_db), admin: User = Depends(get_current_admin)):
    from app.core.security import verify_password
    current, new = str(body.get("current_password", "")), str(body.get("new_password", ""))
    if not verify_password(current, admin.password_hash):
        raise BusinessRuleError("Current password is incorrect.", code="invalid_credentials")
    if len(new) < 12:
        raise BusinessRuleError("Staff passwords must be at least 12 characters.", code="weak_password")
    validate_password(db, new)
    admin.password_hash = hash_password(new)
    audit(db, admin, "staff.password_change", "user", admin.id, ip=request_ip(request))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ audit log

@router.get("/audit-logs")
def audit_logs(db: Session = Depends(get_db), _: User = Depends(require("audit.read")),
               action: str | None = None, entity_type: str | None = None, actor: str | None = None,
               date_from: date | None = None, date_to: date | None = None,
               page: int = Query(1, ge=1), page_size: int = Query(50, le=200)):
    stmt = select(AdminAuditLog)
    if action:
        stmt = stmt.where(AdminAuditLog.action.ilike(f"{action}%"))
    if entity_type:
        stmt = stmt.where(AdminAuditLog.entity_type == entity_type)
    if actor:
        stmt = stmt.where(AdminAuditLog.actor_email.ilike(f"%{actor}%"))
    if date_from:
        stmt = stmt.where(AdminAuditLog.created_at >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to:
        stmt = stmt.where(AdminAuditLog.created_at <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AdminAuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [{"id": r.id, "actor_email": r.actor_email, "action": r.action, "entity_type": r.entity_type,
                       "entity_id": r.entity_id, "before": r.before, "after": r.after, "reason": r.reason,
                       "ip_address": r.ip_address, "created_at": r.created_at.isoformat()} for r in rows],
            "total": total, "page": page, "pages": (total + page_size - 1) // page_size}
