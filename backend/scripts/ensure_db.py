"""Create the database named in DATABASE_URL if it doesn't exist yet (no psql needed).

    python -m scripts.ensure_db
"""
import sys

import psycopg
from sqlalchemy.engine import make_url

from app.core.config import settings


def main() -> int:
    url = make_url(settings.DATABASE_URL)
    name = url.database
    try:
        conn = psycopg.connect(host=url.host or "localhost", port=url.port or 5432, user=url.username,
                               password=url.password, dbname="postgres", autocommit=True, connect_timeout=5)
    except psycopg.OperationalError as e:
        msg = str(e).strip().splitlines()[0]
        print(f"Could not connect to PostgreSQL at {url.host}:{url.port or 5432} as '{url.username}'.\n  {msg}")
        if "password" in msg.lower():
            print("  -> The password in backend\\.env (DATABASE_URL) is wrong. Special characters must be URL-encoded (@ = %40).")
        else:
            print("  -> Is PostgreSQL installed and running? (Services app -> postgresql-x64-NN -> Start)")
        return 1
    with conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone()
        if exists:
            print(f"Database '{name}' already exists.")
        else:
            conn.execute(f'CREATE DATABASE "{name}"')
            print(f"Created database '{name}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
