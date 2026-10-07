# AI Usage Log — Northwind Order Hub

This document details the usage of Artificial Intelligence (AI) during the design, development, and testing of the **Northwind Order Hub** SAP CAP backend application.

---

## Tooling & Assistant Details

- **AI Tool**: Antigravity Coding Assistant (powered by Google DeepMind advanced agentic coding models)
- **Role**: Pair-programming assistant, system architect, code generation, and test suite design
- **Oversight**: Human-in-the-loop review, automated test execution, and architectural validation

---

## Areas of AI Contribution

The AI assistant contributed to the following phases and deliverables:

### 1. Project Architecture Planning
- **Domain Modeling**: Designed the `orderhub` CDS schema (`db/schema.cds`), defining the composition relationship between `SalesOrders` and `SalesOrderItems`, cuid UUID primary keys, and order status enumeration.
- **Service & Projection Design**: Drafted `OrderService` (`srv/order-service.cds`), structuring read-only projections over remote Northwind entities and defining bound action signatures for order lifecycle management.
- **Security & Authorization Architecture**: Outlined role-based access control (RBAC) boundaries across `SalesRep`, `SalesManager`, and `BillingClerk` roles.

### 2. Code Generation (CAP Service, Handlers, & Schema)
- **Service Handler Implementation**: Generated `srv/order-service.js`, implementing:
  - `before('CREATE', 'SalesOrders')`: Master-data lookups, server-side price/name snapshotting, discount/quantity validations, and sequential numbering.
  - Bound actions: `submit`, `approve`, and `cancel` handlers with state transition verification.
  - Event hooks to prevent direct tampering with `@readonly` fields.
- **External Integration Configuration**: Configured `package.json` CDS requires block for live remote OData V4 consumption (`https://services.odata.org/V4/Northwind/Northwind.svc/`) and offline SQLite mocking for test environments.

### 3. Business Logic Modules (`srv/lib/`)
- **Calculations Engine (`srv/lib/calculations.js`)**: Implemented robust monetary math routines for line-item discount application, net amount calculations, configurable tax rollups, and gross amount sums.
- **Order Number Generator (`srv/lib/order-number.js`)**: Developed an annual sequential generator producing `SO-YYYY-NNNNN` identifiers within SQLite transactions.
- **Rules & Constants (`srv/lib/constants.js`)**: Centralized business constraints, validation thresholds (quantity limits `1–999`, discount limits `0–25%`, approval threshold `5000`, tax rate `10%`), and finite-state-machine status transitions.
- **Northwind Adapter (`srv/lib/northwind.js`)**: Created helper routines for querying customer profiles and product availability/discontinuation status.

### 4. Automated Testing Suite (`test/`)
- **Jest Test Suite (`test/order-service.test.js`)**: Designed 20+ comprehensive integration and unit tests using `@sap/cds.test`.
- **Test Scenarios Covered**:
  - Remote Northwind master-data reads (Customers, Products, Categories, Suppliers, Shippers).
  - Order creation with calculated totals, product/customer snapshots, and sequential order numbering.
  - Rejection of invalid inputs (non-existent customer, non-existent product, discontinued product, zero/negative quantity, out-of-range discount, empty items).
  - Permitted and illegal status transitions (`New` &rarr; `Submitted` &rarr; `Approved`, cancellation rules).
  - High-value order approval threshold validation.
  - Role-based authorization enforcement (SalesRep, SalesManager, BillingClerk, and unauthenticated callers).

### 5. Documentation Generation
- Authored the project documentation:
  - `README.md`: Comprehensive setup guide, architecture breakdown, API reference, and curl samples.
  - `DECISIONS.md`: Formal Architecture Decision Records (ADRs) explaining technical choices.
  - `AI_USAGE.md`: Transparent record of AI contributions and future AI feature roadmaps.

---

## Code Review, Testing & Quality Assurance

> **Verification Notice**:
> All AI-generated code, CDS definitions, and business logic underwent review and verification:
> - **Automated Verification**: 100% of functional requirements and edge cases were verified using automated Jest test suites (`npm test`) running against in-memory SQLite instances.
> - **SAP CAP Standards**: Code adheres to official SAP CAP best practices, avoiding proprietary anti-patterns, ensuring clean service projections, and enforcing immutability of historical transactional data.
> - **Security**: Strict role annotations (`@restrict`, `@requires`) and server-side validation guarantee that client requests cannot bypass authorization or mutate read-only business fields.

---

## Planned AI Features (Phase 3 Roadmap)

During Phase 3 (Invoicing, Communication & AI Enhancements), the Northwind Order Hub will incorporate an intelligent capability. One of the following candidate features will be selected:

1. **AI Order Assistant**:
   - An intelligent conversational interface enabling sales representatives to assemble multi-line sales orders using natural language input (e.g., *"Create an order for customer ALFKI with 20 units of Chai and 5 packages of Tofu at a 10% discount"*).
   - Automatically maps product names and quantities to Northwind IDs and validates inventory/discontinued status.

2. **AI Sales Q&A**:
   - An analytical natural-language interface allowing sales managers to query sales order metrics and historical data (e.g., *"Which customer had the highest order value this quarter?"* or *"Summarize pending orders requiring approval"*).
   - Generates dynamic CAP CQL queries against transactional and master data.

3. **AI Invoice Email Writer**:
   - A contextual communication assistant triggered when an order transitions to `Approved` or `Invoiced`.
   - Generates personalized, professional customer email notifications summarizing order line items, applied discounts, and payment terms for review by the Billing Clerk (`carol`).

*Final selection will be determined during Phase 3 planning based on business workflow requirements.*
