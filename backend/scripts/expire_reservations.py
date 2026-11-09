"""Release expired inventory reservations and cancel unpaid orders.

Reservations are also swept automatically at every checkout. Schedule this (e.g. a Render Cron Job every
10 minutes) so stock frees up even when nobody is checking out:
    python -m scripts.expire_reservations
"""
from app.db.session import SessionLocal
from app.services.inventory import sweep_expired

if __name__ == "__main__":
    db = SessionLocal()
    try:
        print(f"Expired {sweep_expired(db)} unpaid order(s).")
    finally:
        db.close()
