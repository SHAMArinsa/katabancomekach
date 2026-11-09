# Glass Luxury Store

A premium e-commerce platform for glass home décor, kitchenware and tableware — selling across India and internationally.
One FastAPI backend and one PostgreSQL database serve two separate React portals:

| Portal | URL | Who |
|---|---|---|
| **Storefront** | `/` | Customers browse, buy, track orders, request returns, report damage |
| **Admin** | `/admin` | Staff manage catalogue, inventory, orders, payments, shipping, content and every business setting |

The brand is not fixed: the placeholder name **“Maison Verre”** and all copy, logo, policies and homepage content are editable in **Admin › Business settings / Website content**.


## Quick start on Windows (easiest)

1. Install **Python 3.12+**, **Node.js 20+** and **PostgreSQL** (you already have these).
2. Double-click **`setup.bat`** in the project folder. It installs everything, asks for your PostgreSQL password once, creates the database, runs migrations and loads demo data.
3. Double-click **`start.bat`**. Two windows open (API and website), and your browser opens http://localhost:5173.

### Demo logins (local development only)

| Portal | URL | Email | Password |
|---|---|---|---|
| Customer | http://localhost:5173/login | customer@demo.glassstore.in | Customer@123456 |
| Admin | http://localhost:5173/admin/login | admin@demo.glassstore.in | Admin@123456 |

The sign-in pages also show these with a **Use** button. Demo accounts are never created when `APP_ENV=production`; there, create the first admin with `py -m scripts.create_admin`.

In development, emails are printed to the API window instead of being sent, and after registering you get a **Verify my email now** button.

## Business rules (enforced by the backend)

- Products are **always paid online** before dispatch. Product cash-on-delivery is impossible (API schema, service layer *and* a database `CHECK` constraint).
- **Free delivery** when the eligible merchandise subtotal reaches **₹2,000 (domestic)** or **₹10,000 (international)** — both editable in Admin, along with the calculation basis (before/after discount).
- Below the threshold the **courier collects the shipping fee from the recipient**. This is only allowed when the configured courier supports recipient-paid shipping on prepaid parcels; otherwise checkout and shipment creation are blocked with a clear message.
- **Product payment, shipping-fee collection and fulfilment are three independent status machines** with validated transitions, history and DB constraints.
- An order **cannot be dispatched until payment is verified** (service rule + DB constraint). Orders are never marked paid from a browser redirect — the server verifies the gateway signature and re-fetches the payment; webhooks are signature-checked and processed idempotently; amount/currency mismatches are flagged, never accepted.
- Unsupported destinations, domestic-only products, fragile restrictions and courier incompatibilities are detected server-side. International orders carry a customs/duties disclosure the customer must acknowledge.
- Stock is **reserved** at order creation with row-level locks (no overselling), **deducted** after verified payment, and **released/restored** on expiry, failure or cancellation.
- Every price, discount, tax, address and shipping term is **snapshotted** on the order; later price changes never alter history.

## Stack

- **Backend:** Python, FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL (psycopg 3), Argon2 password hashing, JWT access tokens + rotating httpOnly refresh cookies, RBAC, structured JSON logging. REST under `/api/v1` (`public`, `auth`, `customer`, `admin`, `payments`, `shipping`, `webhooks`). OpenAPI at `/docs`.
- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form, Zod, Lucide icons.
- **Integrations (adapters):** payments `mock` | `razorpay`; shipping `mock` | `manual`; email `console` | `smtp`; storage `local` | `vercel_blob`.
- **Tests:** Pytest + HTTPX (61 tests) · Vitest + React Testing Library (16 tests).

## Repository layout

```
backend/    FastAPI app (app/api, core, db, models, schemas, repositories, services, integrations), alembic/, tests/, scripts/
frontend/   React app (src/app, components, layouts, features, pages, services, schemas, types, utils), public/
docs/       LOCAL_SETUP.md · DEPLOYMENT.md · API.md
```

## Quick start (Windows, PowerShell)

Full instructions, including PostgreSQL setup and troubleshooting: **[docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md)**.

```powershell
# backend
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
alembic upgrade head
python -m scripts.seed
python -m scripts.create_admin --email you@example.com --name "Your Name"
uvicorn app.main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev
```

Storefront: http://localhost:5173 · Admin: http://localhost:5173/admin · API docs: http://127.0.0.1:8000/docs

In development, payments use the **mock gateway** (clearly labelled “Test mode”; no money moves) and emails are printed to the backend console (verification and reset links appear there).

## Documentation

- [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) — Windows setup, database, seed data, admin provisioning, tests, troubleshooting
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Render (API + PostgreSQL), Vercel (frontend), Vercel Blob, Razorpay go-live, security checklist, backups & recovery
- [docs/API.md](docs/API.md) — API structure, auth model, key endpoints and status models

## What is verified vs. what needs your accounts

Verified here end-to-end with automated tests and a browser run: catalogue, search, cart, checkout, thresholds, mock payments (success, failure, duplicate webhooks, amount mismatch), reservations and concurrency, fulfilment, shipping-fee collection, refunds, returns, damage claims with private photo evidence, RBAC, audit log, settings, local image storage.

**Not verified against live services** (they need your credentials): the Razorpay adapter, a real courier API, SMTP delivery and the Vercel Blob adapter. Each is implemented behind an adapter and documented in DEPLOYMENT.md with the steps to verify it before launch.
