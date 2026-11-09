"""Secure initial administrator provisioning (there is no public admin sign-up).

Run on a machine with database access:
    python -m scripts.create_admin --email owner@example.com --name "Store Owner"
The password is prompted (not echoed). For non-interactive environments (e.g. a Render shell) set
ADMIN_PASSWORD in the environment for that single command instead.

By default this refuses to run if a Super Admin already exists; use --additional to add another.
"""
import argparse
import getpass
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import Role, User


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", default="Administrator")
    ap.add_argument("--role", default="Super Admin")
    ap.add_argument("--additional", action="store_true", help="Allow creating another admin when one exists")
    args = ap.parse_args()

    email = args.email.strip().lower()
    db = SessionLocal()
    try:
        role = db.scalar(select(Role).where(Role.name == args.role))
        if not role:
            print("Roles are missing. Run `python -m scripts.seed` first.", file=sys.stderr)
            return 1
        existing_super = db.scalar(select(User).join(User.roles).where(Role.name == "Super Admin", User.is_staff.is_(True)))
        if existing_super and not args.additional:
            print("A Super Admin already exists. Use --additional to create another, or manage staff in the admin portal.",
                  file=sys.stderr)
            return 1
        if db.scalar(select(User).where(User.email == email)):
            print("A user with that email already exists.", file=sys.stderr)
            return 1
        password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Password (min 12 chars): ")
        if not os.environ.get("ADMIN_PASSWORD"):
            if getpass.getpass("Confirm password: ") != password:
                print("Passwords do not match.", file=sys.stderr)
                return 1
        if len(password) < 12 or password.isalpha() or password.isdigit():
            print("Use at least 12 characters mixing letters and numbers.", file=sys.stderr)
            return 1
        user = User(email=email, full_name=args.name, password_hash=hash_password(password), is_staff=True,
                    email_verified_at=datetime.now(timezone.utc), roles=[role])
        db.add(user)
        db.commit()
        print(f"Created {args.role}: {email}. Sign in at <frontend>/admin/login and enable MFA under Account.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
