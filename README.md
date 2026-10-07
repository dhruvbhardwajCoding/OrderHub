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
- [Project Structure](#project-structure)
- [Phase Roadmap](#phase-roadmap)

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

The system follows standard SAP CAP multi-tier architecture, delegating master-data queries to the external Northwind service while persisting transactional entities to a local SQLite database:

```
┌────────────────────────────────────────────────────────┐
│               SAPUI5 Frontend (Phase 2)                │
└───────────────────────────┬────────────────────────────┘
                            │ OData V4 (JSON over HTTP)
                            ▼
┌────────────────────────────────────────────────────────┐
│            SAP CAP Backend (/odata/v4/order)           │
│                                                        │
│  ┌─────────────────────────┐  ┌─────────────────────┐  │
│  │   Transactional Engine  │  │ Northwind Delegate  │  │
│  │  - Calculations        │  │ - Projections       │  │
│  │  - Order Numbering      │  │ - Live Proxy Reads  │  │
│  │  - Status Lifecycles    │  │                     │  │
│  │  - RBAC Restrictions    │  │                     │  │
│  └────────────┬────────────┘  └──────────┬──────────┘  │
└───────────────┼──────────────────────────┼─────────────┘
                │                          │
                ▼                          ▼
       ┌─────────────────┐       ┌───────────────────┐
       │  Local SQLite   │       │ Remote Northwind  │
       │  (Sales Orders) │       │   OData Service   │
       └─────────────────┘       └───────────────────┘
```

1. **Frontend (UI5)**: Consumes OData V4 services from CAP.
2. **CAP Service (`OrderService`)**: Exposes master-data projections and transactional entities under `/odata/v4/order`.
3. **Local Store (SQLite)**: Persists `SalesOrders` and `SalesOrderItems`.
4. **Remote Northwind OData V4**: Queried live via `@sap/cds` service delegation (`https://services.odata.org/V4/Northwind/Northwind.svc/`).

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

### 1. Clone & Install

```bash
git clone <repository-url>
cd orderHub
npm install
```

### 2. Environment Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Available environment variables in `.env`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `TAX_RATE` | `0.10` | Tax rate applied to net order amounts (e.g., `0.10` = 10%) |
| `APPROVAL_THRESHOLD` | `5000` | Gross amount threshold above which orders require manager approval |
| `cds_requires_northwind_metadata_credentials_url` | `https://services.odata.org/V4/Northwind/Northwind.svc/` | Remote Northwind OData V4 service endpoint |

### 3. Run the Development Server

Start the application with live reload using CDS watch:

```bash
npm run watch
```

*Or alternatively:*

```bash
npx cds watch
```

The service will start at `http://localhost:4004`. Open your browser to explore the CAP launchpad and metadata index.

---

## Mocked Users & Authorization

The service enforces authentication and role-based permissions (`auth: mocked` mode):

| User | Password | Role | Permissions & Responsibilities |
| :--- | :--- | :--- | :--- |
| **`alice`** | `alice` | `SalesRep` | **Full Sales Orders Access**: Create, Read, Update, Delete orders; Submit orders for approval. |
| **`bob`** | `bob` | `SalesManager` | **Management & Approval**: Read all orders; Approve submitted orders; Cancel orders. Cannot create orders. |
| **`carol`** | `carol` | `BillingClerk` | **Read-Only / Accounting**: Read all orders and items. Reserved for Phase 3 invoicing workflows. |

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

The project includes an end-to-end integration and unit test suite powered by **Jest** and `@sap/cds.test`. The test suite runs against an isolated in-memory SQLite database with Northwind test fixtures:

```bash
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

---

## Project Structure

```
orderHub/
├── .env.example                  # Template for environment configuration
├── package.json                  # Dependencies, scripts, and CAP configuration
├── README.md                     # Project documentation (this file)
├── DECISIONS.md                  # Architectural decisions log
├── AI_USAGE.md                   # AI tooling and implementation disclosures
├── app/                          # UI assets (target directory for Phase 2 SAPUI5)
├── db/
│   └── schema.cds                # CDS domain model: SalesOrders & SalesOrderItems
├── srv/
│   ├── order-service.cds         # OData V4 service definition and RBAC annotations
│   ├── order-service.js          # Event handlers, action hooks, and validation logic
│   ├── external/
│   │   ├── northwind-metadata.cds# CDS projection model for Northwind OData service
│   │   ├── northwind-metadata.xml# Northwind EDMX schema definition
│   │   └── data/                 # Offline seed CSVs for test execution
│   │       ├── northwind_metadata-Categories.csv
│   │       ├── northwind_metadata-Customers.csv
│   │       ├── northwind_metadata-Products.csv
│   │       ├── northwind_metadata-Shippers.csv
│   │       └── northwind_metadata-Suppliers.csv
│   └── lib/                      # Reusable business logic modules
│       ├── calculations.js       # Line item and order totals computation
│       ├── constants.js          # Business rules, thresholds, and transition states
│       ├── northwind.js          # Remote Northwind lookup helper routines
│       └── order-number.js       # Sequential SO-YYYY-NNNNN number generator
└── test/
    └── order-service.test.js     # Comprehensive Jest test suite
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
- [ ] **Phase 2: SAPUI5 Application & Map Visualizations**
  - [ ] SAPUI5 frontend (List Report & Object Page)
  - [ ] Leaflet / OpenStreetMap customer location visualization
  - [ ] Draft enablement (`@odata.draft.enabled`)
- [ ] **Phase 3: Invoicing, Communications & AI Capabilities**
  - [ ] PDF invoice generation with Billing Clerk role actions
  - [ ] Automated email notification dispatching
  - [ ] AI integration (Order Assistant / Sales Q&A / Invoice Email Writer)
