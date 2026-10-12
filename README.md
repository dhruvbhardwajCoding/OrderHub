# Northwind Order Hub

[![SAP CAP](https://img.shields.io/badge/SAP%20CAP-v8-blue.svg)](https://cap.cloud.sap)
[![OData V4](https://img.shields.io/badge/OData-V4-green.svg)](https://www.odata.org/)
[![Node.js](https://img.shields.io/badge/Node.js-LTS%2020%20%7C%2022-brightgreen.svg)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/SQLite-In--Memory%20%2F%20Persistent-orange.svg)](https://sqlite.org)
[![Tests](https://img.shields.io/badge/Tests-Jest%20Suite-blueviolet.svg)](https://jestjs.io/)

A modern SAP Cloud Application Programming Model (CAP) backend service for managing sales orders with live integration to remote Northwind OData master data.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Mocked Users & Authorization](#mocked-users--authorization)
- [API Endpoints](#api-endpoints)
- [Example Requests](#example-requests)
- [Running Automated Tests](#running-automated-tests)
- [Invoice Storage: Local vs. SAP Document Management](#invoice-storage-local-vs-sap-document-management)
- [Project Structure](#project-structure)
- [Phase Roadmap](#phase-roadmap)
- [Requirement Checklist](#requirement-checklist)
- [Screenshots](#screenshots)
- [Known Limitations](#known-limitations)

---

## Overview

**Northwind Order Hub** serves as an enterprise sales management hub. It links transactional sales order processing (orders, line items, status workflows, calculations) directly with real-time Northwind master data (Customers, Products, Categories, Suppliers, Shippers).

### Key Features
- **Transactional Order Management**: Full CRUD lifecycle for sales orders and line items.
- **Master Data Integration**: Real-time read delegation to the public Northwind OData V4 service without local data replication.
- **Data Snapshot Strategy**: Freezes customer names, product names, and unit prices upon order creation to ensure immutable historical records.
- **Automated Calculations**: Server-side line-item discounts, net totals, configurable tax (10% default), and gross sums.
- **Sequential Order Numbers**: Auto-generated sequential format `SO-YYYY-NNNNN` scoped per year.
- **Workflow Enforcement**: Strict status progression (`New` &rarr; `Submitted` &rarr; `Approved` &rarr; `Invoiced` or `Cancelled`) managed through bound actions.
- **Role-Based Access Control (RBAC)**: Role boundaries enforced across Sales Representatives, Sales Managers, and Billing Clerks.

---

## Architecture

The frontend and backend are two independently-run services on different ports/origins — not one app serving both, the way a typical CAP+UI5 project defaults to. The browser talks to the backend purely over cross-origin OData V4; there's no server-side rendering or shared process between them.

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  frontend/  (localhost:8080)│        │  backend/  (localhost:4004)      │
│  SAPUI5 app, served by a    │        │  SAP CAP server                   │
│  plain static Express       │  OData │  ┌─────────────────────────┐     │
│  server (frontend/server.js)│  V4 +  │  │   Transactional Engine  │     │
│                              │  CORS, │  │  - Calculations         │     │
│  manifest.json's dataSources│───────▶│  │  - Order Numbering      │     │
│  point at an absolute       │credent-│  │  - Status Lifecycles    │     │
│  http://localhost:4004 URL  │ -ialed │  │  - RBAC Restrictions    │     │
│                              │        │  └────────────┬────────────┘     │
└─────────────────────────────┘        │               │                  │
                                        │               ▼                  │
                                        │      ┌─────────────────┐         │
                                        │      │  Local SQLite   │         │
                                        │      │  (Sales Orders) │         │
                                        │      └─────────────────┘         │
                                        │  ┌─────────────────────┐         │
                                        │  │ Northwind Delegate  │────────▶│ Remote Northwind OData V4
                                        │  └─────────────────────┘         │
                                        └──────────────────────────────────┘
```

1. **Frontend (`frontend/`)**: The SAPUI5 app, served standalone by a minimal Express static file server (`frontend/server.js`) on port 8080 — no CAP, no backend code, just static files. `manifest.json`'s `dataSources` and a couple of direct `fetch`/download URLs (`Component.js`, `SalesOrder.controller.js`) point at an absolute `http://localhost:4004` instead of the relative paths you'd use if one server hosted both.
2. **Backend (`backend/`)**: The CAP server — `OrderService`/`AnalyticsService` under `/odata/v4/*`, the local SQLite database, and the Northwind delegate. Runs entirely on its own; nothing here knows the frontend exists except a CORS allow-list for its origin.
3. **CORS**: Since the browser now sees two different origins, `backend/srv/server.js` registers an `Access-Control-Allow-Origin` middleware (via `cds.on('bootstrap')`, so it runs before CAP's own routes) that echoes back exactly the configured `FRONTEND_URL` (default `http://localhost:8080`) with credentials enabled — required because the app sends Basic Auth via `fetch(..., {credentials: "include"})`, and credentialed CORS can't use the `*` wildcard origin.
4. **Local Store (SQLite)**: Persists `SalesOrders` and `SalesOrderItems`, inside `backend/`.
5. **Remote Northwind OData V4**: Queried live via `@sap/cds` service delegation (`https://services.odata.org/V4/Northwind/Northwind.svc/`).

See [DECISIONS.md ADR 26](DECISIONS.md) for the rationale and what to change if you deploy the two services anywhere other than `localhost:4004`/`localhost:8080`.

---

## Tech Stack

| Component | Technology | Version / Notes |
| :--- | :--- | :--- |
| **Runtime** | Node.js | LTS v20.x or v22.x |
| **Framework** | SAP Cloud Application Programming Model (`@sap/cds`) | `^8.0.0` |
| **Dev Tools** | SAP CDS SDK (`@sap/cds-dk`) | `^8.0.0` |
| **Database** | SQLite (`@cap-js/sqlite`) | `^1.0.0` (In-memory for tests, file for dev) |
| **Protocol** | OData V4 | JSON payloads |
| **Testing** | Jest (`jest`) + `@sap/cds/lib/test` | `^29.0.0` |
| **HTTP Client** | Axios / Curl | For external calls and API verification |

---

## Prerequisites

- **Node.js**: LTS version `v20.x` or `v22.x` installed (`node --version`)
- **npm**: Version `10.x` or higher (`npm --version`)
- *(Optional)* **SAP CDS Development Kit**:
  ```bash
  npm install -g @sap/cds-dk
  ```

---

## Getting Started

The backend and frontend are two separate npm projects (`backend/`, `frontend/`) — install and run each independently, in two terminals.

### 1. Clone & Install

```bash
git clone <repository-url>
cd orderHub
cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Environment Configuration (backend only)

```bash
cd backend
cp .env.example .env
```

Available environment variables in `backend/.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `FRONTEND_URL` | `http://localhost:8080` | The frontend origin the backend accepts cross-origin requests from (CORS) |
| `TAX_RATE` | `0.10` | Tax rate applied to net order amounts (e.g., `0.10` = 10%) |
| `APPROVAL_THRESHOLD` | `5000` | Gross amount threshold above which orders require manager approval |
| `cds_requires_northwind_metadata_credentials_url` | `https://services.odata.org/V4/Northwind/Northwind.svc/` | Remote Northwind OData V4 service endpoint |
| `GEMINI_API_KEY` | _(none)_ | Enables the AI assistant (AI-01); the app runs fully without it (AI-02) |
| `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` | Ethereal (fake) | Real email delivery for invoices — see `.env.example` |

### 3. Run Both Services

**Terminal 1 — backend** (CAP server, port 4004):

```bash
cd backend
npm run watch
```

**Terminal 2 — frontend** (static UI5 app, port 8080):

```bash
cd frontend
npm start
```

Open `http://localhost:8080` in your browser. The UI5 app loads from the frontend server and talks to the backend at `http://localhost:4004` over OData V4 — a real cross-origin setup, not two parts of one process. If you change either port, update `backend/.env`'s `FRONTEND_URL` and the `BACKEND_URL` constant in `frontend/orderhub/Component.js` / `SalesOrder.controller.js` / `manifest.json`'s `dataSources` to match (see DECISIONS.md ADR 26).

---

## Mocked Users & Authorization

The service enforces authentication and role-based permissions (`auth: mocked` mode):

| User | Password | Role | Permissions & Responsibilities |
| :--- | :--- | :--- | :--- |
| **`alice`** | `alice` | `SalesRep` | **Full Sales Orders Access**: Create, Read, Update, Delete orders; Submit orders for approval. |
| **`bob`** | `bob` | `SalesManager` | **Management & Approval**: Read all orders; Approve submitted orders; Cancel orders. Cannot create orders. |
| **`carol`** | `carol` | `BillingClerk` | **Billing**: Read Approved/Invoiced orders; create invoices (`createInvoice`) and send them by email (`sendInvoice`). |

---

## API Endpoints

All endpoints are hosted under service path `/odata/v4/order`.

### Northwind Master Data (Read-Only Projections)

- `GET /odata/v4/order/Customers` — Northwind customers list
- `GET /odata/v4/order/Products` — Northwind products catalog
- `GET /odata/v4/order/Categories` — Northwind product categories
- `GET /odata/v4/order/Suppliers` — Product suppliers
- `GET /odata/v4/order/Shippers` — Available shipping carriers

### Transactional Sales Order Entities

- `GET /odata/v4/order/SalesOrders` — Query sales orders (supports `$filter`, `$orderby`, `$select`)
- `GET /odata/v4/order/SalesOrders(<ID>)?$expand=items` — Retrieve an order with line items
- `POST /odata/v4/order/SalesOrders` — Create a new order with items (SalesRep only)
- `PATCH /odata/v4/order/SalesOrders(<ID>)` — Update order details (SalesRep only, when status is `New`)
- `DELETE /odata/v4/order/SalesOrders(<ID>)` — Delete an order (SalesRep only, when status is `New`)

### Bound Actions (Lifecycle State Transitions)

- `POST /odata/v4/order/SalesOrders(<ID>)/OrderService.submit` — Submit a order (`New` &rarr; `Submitted`) [SalesRep]
- `POST /odata/v4/order/SalesOrders(<ID>)/OrderService.approve` — Approve an order (`Submitted` &rarr; `Approved`) [SalesManager]
- `POST /odata/v4/order/SalesOrders(<ID>)/OrderService.cancel` — Cancel an order [SalesRep or SalesManager]

---

## Example Requests

### 1. Create a New Sales Order

**As `alice` (`SalesRep`):**

```bash
curl -X POST http://localhost:4004/odata/v4/order/SalesOrders \
  -u alice:alice \
  -H "Content-Type: application/json" \
  -d '{
    "customerID": "ALFKI",
    "currency_code": "USD",
    "items": [
      {
        "productID": 1,
        "quantity": 20,
        "discount": 10
      },
      {
        "productID": 14,
        "quantity": 5,
        "discount": 0
      }
    ]
  }'
```

**Expected Response (`201 Created`):**
```json
{
  "@odata.context": "$metadata#SalesOrders/$entity",
  "ID": "c7a6f02e-9d21-4f10-bf91-7662c19a97bc",
  "orderNo": "SO-2026-00001",
  "customerID": "ALFKI",
  "customerName": "Alfreds Futterkiste",
  "status": "New",
  "netAmount": 440.25,
  "taxAmount": 44.03,
  "grossAmount": 484.28,
  "currency_code": "USD"
}
```

### 2. Submit Order for Approval

**As `alice` (`SalesRep`):**

```bash
curl -X POST http://localhost:4004/odata/v4/order/SalesOrders(c7a6f02e-9d21-4f10-bf91-7662c19a97bc)/OrderService.submit \
  -u alice:alice \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response (`200 OK`):**
Order status updates from `New` to `Submitted`.

### 3. Approve Order

**As `bob` (`SalesManager`):**

```bash
curl -X POST http://localhost:4004/odata/v4/order/SalesOrders(c7a6f02e-9d21-4f10-bf91-7662c19a97bc)/OrderService.approve \
  -u bob:bob \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response (`200 OK`):**
Order status updates from `Submitted` to `Approved`.

### 4. Cancel Order

**As `alice` or `bob`:**

```bash
curl -X POST http://localhost:4004/odata/v4/order/SalesOrders(c7a6f02e-9d21-4f10-bf91-7662c19a97bc)/OrderService.cancel \
  -u alice:alice \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response (`200 OK`):**
Order status transitions to `Cancelled`.

---

## Running Automated Tests

The project includes an end-to-end integration and unit test suite powered by **Jest** and `@sap/cds.test`. The test suite runs against an isolated in-memory SQLite database with Northwind test fixtures. Tests live in `backend/` (they exercise CAP service handlers, not UI5 code), so run them from there:

```bash
cd backend
npm test
```

### Test Coverage Highlights
- **Master Data Delegation**: Verifies read access on Customers, Products, Categories, Suppliers, and Shippers.
- **Order Creation & Snapshots**: Validates customer and product name/price freezing upon creation.
- **Calculations & Totals**: Validates per-item net amount calculations and order-level tax and gross rollups.
- **Validation Rules**: Ensures rejection of invalid customer IDs, missing/discontinued products, out-of-range quantities (`1–999`), and invalid discounts (`0–25%`).
- **Sequential Numbering**: Verifies consistent generation of `SO-YYYY-NNNNN` order numbers.
- **Status Lifecycle**: Tests permitted transitions and enforces rejection of illegal status hops.
- **Approval Threshold**: Confirms behavior for high-value orders exceeding threshold (`> 5000`).
- **Role-Based Security**: Confirms 403 Forbidden enforcement across `SalesRep`, `SalesManager`, `BillingClerk`, and 401 Unauthorized for unauthenticated callers.
- **Invoicing & Email**: `createInvoice`/`sendInvoice` lifecycle, the `<customerID>@example.test` recipient override, and the FAILED/SENT `mailStatus` tracking.
- **Invoice Storage** (`test/sdm-client.test.js`, `test/invoice-store.test.js`): the CMIS Browser Binding client (folder creation, document upload with DMS-04 metadata, token caching, DMS-05 unreachable handling) and the `local`/`sdm` dispatch facade, all against a mocked `fetch` — see [Invoice Storage](#invoice-storage-local-vs-sap-document-management) below.

---

## Invoice Storage: Local vs. SAP Document Management

Invoice PDFs are stored behind one interface, `srv/lib/invoice-store.js`, with two implementations (DMS-01):

| Mode | When | Where the PDF lives |
|------|------|----------------------|
| `local` (default) | `cd backend && npm run watch` | `Invoices.content` in SQLite |
| `sdm` | `cd backend && cds watch --profile hybrid` | SAP Document Management, Integration Option, at `/invoices/<year>/<invoiceNo>.pdf`; only the CMIS object id (`Invoices.dmsObjectId`) is kept locally |

The switch is entirely config-driven (`cds.requires.invoiceStore.kind` in `package.json`) — no code changes. `sdm` mode talks to Document Management over its CMIS Browser Binding REST API (`srv/lib/sdm-client.js`), authenticating via OAuth2 client-credentials from `cds.requires.sdm.credentials` (a Document Management, Integration Option service key — see `.env.example` for the env var names, or use `cds bind`).

**This assessment has no SAP BTP account**, so `sdm` mode can't be demoed against a real instance (DMS-06 is the one item explicitly scoped out by section 8.1's "Access" note). Instead:

```bash
cd backend
npm run demo:hybrid
```

runs the real server in `sdm` mode against a mocked CMIS endpoint (`test/fixtures/mock-sdm-fetch.js`) — folder creation, upload with the DMS-04 metadata, and the `GET /Invoices(ID)/content` lazy-backfill-from-DMS path all run for real, end-to-end, over HTTP. See `DECISIONS.md` ADR 19 for the full design (including why `GET .../content` caches DMS-fetched bytes back into SQLite after the first read, and the `@cap-js/sqlite` LargeBinary-column quirk this work uncovered and fixed).

If Document Management is unreachable, `createInvoice` is rejected and the order is **not** marked `Invoiced` (DMS-05) — the clerk sees a clear error and can retry.

---

## Project Structure

Two independent npm projects — see [Architecture](#architecture) and DECISIONS.md ADR 26 for why:

```
orderHub/
├── README.md                     # Project documentation (this file)
├── DECISIONS.md                  # Architectural decisions log
├── AI_USAGE.md                   # AI tooling and implementation disclosures
│
├── backend/                      # SAP CAP server — runs standalone on :4004
│   ├── .env.example               # Template for environment configuration
│   ├── package.json               # Dependencies, scripts, and CAP configuration
│   ├── eslint.config.js
│   ├── db/
│   │   └── schema.cds             # CDS domain model: SalesOrders, SalesOrderItems, Invoices
│   ├── srv/
│   │   ├── order-service.cds      # OData V4 service definition and RBAC annotations
│   │   ├── order-service.js       # Event handlers, action hooks, and validation logic
│   │   ├── analytics-service.cds/.js  # Dashboard + customer-map aggregation (AN-*, MAP-*)
│   │   ├── server.js              # Custom bootstrap: CORS for the frontend origin, /user-api/currentUser
│   │   ├── external/
│   │   │   ├── northwind-metadata.cds # CDS projection model for Northwind OData service
│   │   │   ├── northwind-metadata.xml # Northwind EDMX schema definition
│   │   │   └── data/               # Offline seed CSVs for test execution
│   │   └── lib/                   # Reusable business logic modules
│   │       ├── calculations.js     # Line item and order totals computation
│   │       ├── constants.js        # Business rules, thresholds, and transition states
│   │       ├── northwind.js        # Remote Northwind lookup helper routines
│   │       ├── northwind-cache.js  # In-memory TTL cache for master-data reads (MD-05)
│   │       ├── geocode.js          # Nominatim geocoding, cached in CustomerGeo (MAP-02)
│   │       ├── ai.js                # Gemini REST client (AI-01, AI-02)
│   │       ├── order-number.js     # Sequential SO-YYYY-NNNNN number generator
│   │       ├── pdf.js               # Invoice PDF rendering (pdfmake)
│   │       ├── mailer.js            # Invoice email dispatch (nodemailer)
│   │       ├── invoice-store.js     # local/sdm storage facade (DMS-01)
│   │       └── sdm-client.js        # CMIS Browser Binding REST client (DMS-02)
│   └── test/
│       ├── order-service.test.js   # Main Jest integration suite
│       ├── sdm-client.test.js      # CMIS client unit tests (mocked fetch)
│       ├── invoice-store.test.js   # invoice-store facade unit tests
│       └── fixtures/
│           └── mock-sdm-fetch.js   # fetch-level CMIS mock for `npm run demo:hybrid`
│
└── frontend/                      # SAPUI5 app — runs standalone on :8080
    ├── package.json               # Just `express`, to serve the static files
    ├── eslint.config.js
    ├── server.js                  # Minimal static file server
    └── orderhub/                  # The UI5 app itself
        ├── index.html              # UI5 bootstrap (SAPUI5 CDN + Leaflet)
        ├── manifest.json           # App descriptor — dataSources point at http://localhost:4004
        ├── Component.js            # App bootstrap; BACKEND_URL constant
        ├── controller/, view/, control/, fragments/, model/, i18n/
```

---

## Phase Roadmap

- [x] **Phase 1: Backend Core & OData V4 Service**
  - [x] SAP CAP domain model (`SalesOrders`, `SalesOrderItems`) with SQLite storage
  - [x] Remote Northwind OData V4 integration & projections
  - [x] Data snapshot strategy for historical accuracy
  - [x] Server-side calculations (discounts, tax, gross totals)
  - [x] Sequential order number generator (`SO-YYYY-NNNNN`)
  - [x] Lifecycle state transitions via bound actions (`submit`, `approve`, `cancel`)
  - [x] Role-based access control (SalesRep, SalesManager, BillingClerk)
  - [x] Automated test suite with mocked in-memory database and test fixtures
  - [x] Northwind call timeout (MD-04) and in-memory master-data cache (MD-05) — see `srv/lib/northwind.js` / `northwind-cache.js`
- [x] **Phase 2: SAPUI5 Application** (map visualization and `@odata.draft.enabled` still pending)
  - [x] SAPUI5 frontend: dashboard, customer map/list, product list, sales order list and object page
  - [x] Role-aware action buttons (submit/approve/cancel/createInvoice/sendInvoice) driven by `/user-api/currentUser`
  - [x] Dashboard KPI tiles, revenue-by-country/category charts and a top-5-customers table, all server-aggregated via `AnalyticsService` (AN-01, AN-02, AN-03) — see `srv/analytics-service.cds`/`.js`
  - [ ] OpenStreetMap-based customer map (`sap.ui.mdc.Geomap` or an approved fallback) — not started
  - [ ] Draft enablement (`@odata.draft.enabled`) — not started
- [x] **Phase 3: Invoicing & Communications** (AI capabilities still pending)
  - [x] PDF invoice generation (`pdfmake`) with Bill-To/Seller blocks, line items, totals, due date and page footer
  - [x] Invoice storage behind `local`/`sdm` (SAP Document Management, Integration Option) — see [Invoice Storage](#invoice-storage-local-vs-sap-document-management)
  - [x] Email dispatch (`nodemailer`) with a review-before-send dialog and FAILED/SENT tracking
  - [ ] AI integration (Order Assistant / Sales Q&A / Invoice Email Writer) — intentionally deferred to last

---

## Requirement Checklist

Status against the assessment brief's requirement IDs (section 5). ✅ done · 🟡 partial · ⬜ not done.

### Master data (Northwind)

| ID | Requirement | Status | Note |
|---|---|---|---|
| MD-01 | `cds import`, registered under `cds.requires` | ✅ | `srv/external/northwind-metadata.cds`, `package.json` |
| MD-02 | Customers/Products/Categories/Suppliers/Shippers exposed read-only | ✅ | |
| MD-03 | `$filter`/`$search`/`$orderby`/`$top`/`$skip` passed through to Northwind | ✅ | A CAP 8.9 parser quirk silently dropped `$filter`/`$search` for these entities — found and fixed; see DECISIONS.md ADR 20 |
| MD-04 | Northwind slow/down: timeout, readable error, no crash | ✅ | `srv/lib/northwind.js`, `NORTHWIND_TIMEOUT_MS` |
| MD-05 (Should) | Cache master-data reads for a configurable time | ✅ | `srv/lib/northwind-cache.js`, `NORTHWIND_CACHE_TTL_MS` |

### Sales orders (SQLite)

| ID | Requirement | Status | Note |
|---|---|---|---|
| SO-01 | Create/edit/list/delete orders with items | ✅ | Delete button on the order object page (SalesRep, `New` orders only); server rejects deleting a non-`New` order (409) since `Invoices.order` isn't cascade-owned by `SalesOrders` |
| SO-02 | Store Northwind keys + snapshot name/price | ✅ | |
| SO-03 | Server-side validation (customer/product exist, qty 1–999, discount 0–25%, not discontinued) | ✅ | |
| SO-04 | Server-side net/tax/gross; client never sends totals | ✅ | |
| SO-05 | Server-generated order number `SO-YYYY-NNNNN` | ✅ | |
| SO-06 | Status changes only through bound actions | ✅ | `status` is `@readonly`; a direct `PATCH` is rejected (tested) |
| SO-07 | Orders over 5,000 need manager approval before invoicing | ✅ | |
| SO-08 (Should) | Draft editing (`@odata.draft.enabled`) | ⬜ | Not started |
| SO-09 (Should) | Warn when quantity exceeds `UnitsInStock` | ✅ | Server emits the warning (`req.warn`, tested); create-order UI shows a per-row warning badge, including for items pre-filled from the AI assistant |

### Map

| ID | Requirement | Status | Note |
|---|---|---|---|
| MAP-01 | Customers as spots on an OpenStreetMap-based map built with UI5 controls | ✅ | Replaced the raw OSM iframe with `orderhub.control.LeafletMap`, a real `sap.ui.core.Control` (properties, an aggregation-free marker API, apiVersion-2 renderer) wrapping Leaflet.js — the spec-accepted fallback for `sap.ui.mdc.Geomap`; see DECISIONS.md ADR 23 |
| MAP-02 | Geocode once, cache in SQLite | ✅ | `db/schema.cds`'s `CustomerGeo`; `srv/lib/geocode.js` (Nominatim, throttled, cascading fallback), background-filled via `scheduleBackgroundGeocode` |
| MAP-03 | Click a spot → popover with name/city/order count, link to customer page | ✅ | `CustomerSpotPopover` fragment; "Open customer"/"New order" actions |
| MAP-04 (Should) | Filter by country, colour by revenue band | ✅ | Country/band `Select`s in the filter toolbar; marker colour driven by `revenueBand` |

### Analytics

| ID | Requirement | Status | Note |
|---|---|---|---|
| AN-01 | KPI tiles: order count, revenue, open approvals, invoices sent | ✅ | `AnalyticsService.getKPIs()`, server-aggregated |
| AN-02 | 2+ charts (e.g. revenue by country, revenue by category) | ✅ | `sap.viz` VizFrame bar + donut, both server-aggregated |
| AN-03 (Should) | Top 5 customers table with drill-down | ✅ | Row press navigates to the customer |

### Invoice and email

| ID | Requirement | Status | Note |
|---|---|---|---|
| INV-01 | `createInvoice` bound action on Approved orders, `pdfmake` | ✅ | |
| INV-02 | Stored through the invoice store (local/SDM), exposed as a media stream | ✅ | `srv/lib/invoice-store.js`; see [Invoice Storage](#invoice-storage-local-vs-sap-document-management) |
| INV-03 | Email the PDF as an attachment; record recipient/timestamp/status | ✅ | |
| INV-04 (Should) | Resend action, clear error on failure | ✅ | `sendInvoice` is idempotent/resend-safe; failures set `mailStatus: 'FAILED'` without rolling back the invoice |

### AI

| ID | Requirement | Status | Note |
|---|---|---|---|
| AI-01 | One AI feature wired through a CAP action/function | ✅ | "Order from text" (section 9, option A) — `proposeOrderFromText` action on `OrderService`, backed by Google Gemini (`srv/lib/ai.js`); every customer/product hint is matched against live Northwind data server-side before anything is shown, never trusted from the model directly; see DECISIONS.md ADR 24 |
| AI-02 | App works fully with no AI key configured | ✅ | No `GEMINI_API_KEY` → shell bar button is disabled with a tooltip explaining why (`/user-api/currentUser`'s `aiAvailable` flag); the action itself also degrades cleanly (200, empty proposal) rather than erroring if called directly |

### Non-functional (section 10)

| Area | Requirement | Status | Note |
|---|---|---|---|
| Setup | `git clone`, `npm install`, copy `.env.example`, `cds watch` starts it, `npm test` runs all tests | ✅ | Backend and frontend are now two separate npm projects (`backend/`, `frontend/`) — see [Getting Started](#getting-started); each step above happens once per folder |
| Security | Mocked auth, 3 users/roles, `@requires`/`@restrict` | ✅ | `kind: 'mocked'` (see DECISIONS.md ADR 14 for why `kind: 'dummy'` doesn't work) |
| Secrets | No keys/passwords/tokens in the repo or its history | ✅ | All via env vars, documented in `.env.example` |
| Tests | 10+ `cds.test` tests across the listed categories, incl. PDF bytes starting with `%PDF` | ✅ | 122 tests; `test/pdf.test.js` checks the literal `%PDF` requirement against the real, unmocked generator |
| Offline tests | No real Northwind/LLM/Document Management calls in tests | ✅ | `[test]` profile + CSV fixtures for Northwind; `sdm-client`/`pdf` mocked where needed |
| Geocoding | Nominatim rate limit, User-Agent, `CustomerGeo` cache | ✅ | `srv/lib/geocode.js` — 1 req/sec throttle, descriptive `GEOCODE_USER_AGENT`, cached in `CustomerGeo` |
| Performance | Server-side paging; no full-dataset loads; <3s per screen | ✅ | OData `$top`/`$skip` paging is in place; measured live against the real running server — SalesOrders list ~13ms, dashboard KPIs ~10–30ms (cached), cold (uncached) Northwind Products read ~1.6s (one remote round trip, then ~9ms cached), Customer Map ~0.4s — all well under 3s |
| Errors | `req.error`/`req.reject` with proper HTTP codes; `cds.log`, not `console.log` | ✅ | |
| Code quality | ESLint config committed and clean; no dead code | ✅ | Both `backend/eslint.config.js` and `frontend/eslint.config.js`, each run via that folder's own `npm run lint` |
| Git | Small, meaningful commits | 🟡 | The pre-existing `first commit` bundles all of Phases 1–2 in one commit (not rewritten — that would mean rewriting already-existing history); everything since is organized into focused, individually-reviewable commits |

---

## Screenshots

_To be added — this environment has no browser access to capture them. See `dashboard.png` (shared during development) for the dashboard; the remaining screens (customer map, customer detail, products, sales orders list, sales order object page, create order) still need screenshots before submission._

---

## Known Limitations

- **Draft editing** (SO-08, Should) is deliberately not implemented. `SalesOrders` already has a hand-built state machine (`submit`/`approve`/`cancel`/`createInvoice`/`sendInvoice`) and a tested create flow built around active entities; grafting `@odata.draft.enabled` on top is a real architectural change (draft-indicator UI, a `draftActivate` handshake, re-validating every action against draft semantics), not a metadata flag flip, and risks destabilizing a complete, tested feature set for a bonus requirement. A deliberate, scoped-out decision, not an oversight.
- **DMS-06** (showing the `sdm` invoice store against a real SAP Document Management instance via `cds bind`) could not be completed — this assessment has no SAP BTP account. `npm run demo:hybrid` exercises the same code path against a mocked CMIS endpoint instead; see DECISIONS.md ADR 19.
- **AI-01/AI-02** were verified against the real `proposeOrderFromText` HTTP endpoint (response shape, AI-02's no-key degradation, and a full extraction→Northwind-matching round trip against a mocked Gemini response) but not against the real Gemini API — this environment has no `GEMINI_API_KEY`. Add one to `.env` (see `.env.example`) to exercise the real extraction path.
- The dashboard and customer map were visually verified in a real browser during development (including fixing a `layoutData` namespace bug and an `HBox`-vs-percentage-width sizing bug on the map — see DECISIONS.md ADR 23). The AI assistant dialog's rendering has only been verified at the API/data level, not visually in a browser.
