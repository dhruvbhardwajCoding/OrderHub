# Architecture Decision Records (ADR) — Northwind Order Hub

This document records the architectural and design decisions made for the Northwind Order Hub SAP CAP backend. Each decision captures the problem context, chosen approach, technical rationale, and downstream implications.

---

## Index of Decisions

1. [ADR 01: Draft Support Deferred to Phase 2](#adr-01-draft-support-deferred-to-phase-2)
2. [ADR 02: Configurable 10% Default Tax Rate](#adr-02-configurable-10-default-tax-rate)
3. [ADR 03: Currency-Agnostic Approval Threshold](#adr-03-currency-agnostic-approval-threshold)
4. [ADR 04: Annual Sequential Order Number Format (SO-YYYY-NNNNN)](#adr-04-annual-sequential-order-number-format-so-yyyy-nnnnn)
5. [ADR 05: Master Data Snapshotting on Order Creation](#adr-05-master-data-snapshotting-on-order-creation)
6. [ADR 06: Live Northwind Delegation Without Local Persistence](#adr-06-live-northwind-delegation-without-local-persistence)
7. [ADR 07: Pure CAP OData V4 Service Architecture (No Express REST)](#adr-07-pure-cap-odata-v4-service-architecture-no-express-rest)
8. [ADR 08: In-Memory SQLite Mocking with CSV Fixtures for Automated Testing](#adr-08-in-memory-sqlite-mocking-with-csv-fixtures-for-automated-testing)
9. [ADR 09: Modular Business Logic Organization in `srv/lib/`](#adr-09-modular-business-logic-organization-in-srvlib)
10. [ADR 10: State Machine Enforcement via OData Bound Actions](#adr-10-state-machine-enforcement-via-odata-bound-actions)

---

## ADR 01: Draft Support Deferred to Phase 2

- **Status**: Accepted
- **Context**: SAP CAP offers built-in draft management (`@odata.draft.enabled`) tailored for SAP Fiori / SAPUI5 edit sessions, auto-saving drafts into staging tables before final activation.
- **Decision**: Postpone draft enablement to Phase 2 when the SAPUI5 frontend is implemented. Phase 1 exposes standard active transactional entities.
- **Rationale**:
  - Direct API testing, curl workflows, and automated integration tests in Phase 1 operate cleanly against direct active entities without requiring draft activation handshakes (`draftPrepare`, `draftActivate`).
  - In SAP CAP, draft enablement is purely metadata-driven (`annotate OrderService.SalesOrders with @odata.draft.enabled;`). Introducing it later requires **zero changes** to domain schema (`db/schema.cds`) or table structures.
- **Consequences**: Phase 1 APIs operate directly on active records. In Phase 2, `@odata.draft.enabled` will be added to the service projection alongside UI annotations.

---

## ADR 02: Configurable 10% Default Tax Rate

- **Status**: Accepted
- **Context**: The assessment specification requires calculating net, tax, and gross amounts for orders, but did not fix a specific tax jurisdiction or percentage rate.
- **Decision**: Establish a standard default tax rate of 10% (`0.10`), while allowing dynamic overrides via the `TAX_RATE` environment variable.
- **Rationale**:
  - Provides deterministic, predictable calculation results for automated unit and integration tests (e.g., Net `$440.25` &rarr; Tax `$44.03` &rarr; Gross `$484.28`).
  - Decouples business rules from hardcoded magic numbers by sourcing configurations from `srv/lib/constants.js`.
  - Enables deployment-specific or regional tax rate adjustments without code modifications.
- **Consequences**: Order gross amounts consistently reflect `netAmount + taxAmount` using standard two-decimal half-up rounding.

---

## ADR 03: Currency-Agnostic Approval Threshold

- **Status**: Accepted
- **Context**: Orders exceeding a value of 5,000 require manager approval. Orders may theoretically specify different ISO currency codes (e.g., USD, EUR).
- **Decision**: Evaluate the approval threshold strictly as a currency-agnostic numerical comparison (`grossAmount > 5000`), configurable via `APPROVAL_THRESHOLD` environment variable.
- **Rationale**:
  - Matches the literal assessment requirement without introducing artificial complexity such as external FX conversion services or currency exchange rate tables.
  - Keeps order processing fast, self-contained, and deterministic.
- **Consequences**: Any order whose numerical `grossAmount` exceeds 5,000 mandates approval by a user with the `SalesManager` role before it can progress to invoicing.

---

## ADR 04: Annual Sequential Order Number Format (SO-YYYY-NNNNN)

- **Status**: Accepted
- **Context**: Sales orders require human-readable, unique, and sequential identification numbers distinct from internal UUID primary keys.
- **Decision**: Implement a server-generated order number following the format `SO-YYYY-NNNNN` (e.g., `SO-2026-00001`), resetting the 5-digit sequence annually.
- **Rationale**:
  - Provides a business-friendly reference code that instantly conveys creation year and volume.
  - Generating the sequence in `srv/lib/order-number.js` inside the active CDS database transaction ensures sequential progression and eliminates client-side tampering.
  - Marking `orderNo` as `@readonly` prevents callers from spoofing order identifiers.
- **Consequences**: Order numbers are automatically generated during the `before('CREATE', 'SalesOrders')` lifecycle hook; clients cannot supply custom order numbers.

---

## ADR 05: Master Data Snapshotting on Order Creation

- **Status**: Accepted
- **Context**: In commercial systems, master data (customer names, product names, catalogue unit prices) fluctuates over time. If an order references master data by foreign key alone, changes in Northwind would retroactively corrupt historical order totals and audit trails.
- **Decision**: Snapshot `customerName`, `productName`, and current `unitPrice` into the local `SalesOrders` and `SalesOrderItems` records during order creation.
- **Rationale**:
  - Guarantees financial immutability: an invoice or order created today retains its exact line-item prices and descriptions even if the product is later repriced or discontinued in Northwind.
  - Eliminates cascading joins to external services when viewing historical sales orders.
  - Strictly prevents clients from injecting arbitrary unit prices; prices are resolved server-side from Northwind.
- **Consequences**: Orders capture a point-in-time snapshot. Subsequent updates to Northwind customer or product entities do not mutate existing order records.

---

## ADR 06: Live Northwind Delegation Without Local Persistence

- **Status**: Accepted
- **Context**: The application interacts with Northwind master data (Customers, Products, Categories, Suppliers, Shippers) alongside its own transactional entities.
- **Decision**: Query the external Northwind OData V4 service live on demand via `cds.connect.to('northwind_metadata')` without replicating or caching master data in local SQLite tables.
- **Rationale**:
  - Adheres to the principle of single source of truth: Northwind data remains external and authoritative.
  - Avoids synchronization bottlenecks, stale caches, and background sync cron jobs.
  - Leverages CAP's projection layer (`@readonly entity Customers as projection on northwind.Customers`) to transparently delegate reads, queries, and filters to the upstream OData endpoint.
- **Consequences**: The application requires network connectivity to `https://services.odata.org/V4/Northwind/Northwind.svc/` in development/production (offline development and testing are supported via mocked test profiles).

---

## ADR 07: Pure CAP OData V4 Service Architecture (No Express REST)

- **Status**: Accepted
- **Context**: Web application APIs can be exposed using bespoke Express REST routes (`/api/orders`) or standardized OData services.
- **Decision**: Implement a 100% native SAP CAP OData V4 service (`OrderService` under `/odata/v4/order`) and reject custom Express REST routing.
- **Rationale**:
  - OData V4 provides standardized querying (`$filter`, `$select`, `$expand`, `$top`, `$skip`, `$orderby`) out of the box with zero boilerplate.
  - Native alignment with SAPUI5 and Fiori Elements in Phase 2, which expect OData V4 service metadata (`$metadata`).
  - CAP security annotations (`@restrict`, `@requires`) and lifecycle events (`before`, `on`, `after`) integrate natively with CDS OData services without ad-hoc Express middleware.
- **Consequences**: All client interactions conform to OData V4 protocol standards. Bound actions are used for non-CRUD state transitions.

---

## ADR 08: In-Memory SQLite Mocking with CSV Fixtures for Automated Testing

- **Status**: Accepted
- **Context**: Running automated tests against a live remote Northwind service introduces network latency, flakiness, rate limits, and breaks CI/CD in air-gapped environments.
- **Decision**: Mock the Northwind service as a local in-memory SQLite database during testing via the CAP `[test]` profile, backed by curated CSV fixtures in `srv/external/data/`.
- **Rationale**:
  - Test suites execute completely offline in milliseconds without external HTTP dependencies.
  - Test data is deterministic and controlled, allowing reliable assertions on specific edge cases (e.g., discontinued product ID `5`, valid product ID `1` at `$18.00`).
  - Zero divergence between test model and runtime model because both compile from `srv/external/northwind-metadata.cds`.
- **Consequences**: Tests run via `npm test` using Jest without needing an internet connection or external API credentials.

---

## ADR 09: Modular Business Logic Organization in `srv/lib/`

- **Status**: Accepted
- **Context**: Complex business rules (calculations, validations, sequence numbering, external service adapters) can clutter the main service handler file if left unorganized.
- **Decision**: Isolate business logic into dedicated single-responsibility utility modules under `srv/lib/`:
  - `calculations.js`: Item net amounts, discounts, order totals, and tax calculations.
  - `constants.js`: System boundaries, validation thresholds, role names, and status enums.
  - `order-number.js`: Sequential identifier generator.
  - `northwind.js`: Master-data lookups and existence validations.
- **Rationale**:
  - Enables focused, isolated unit testing of calculation logic without spinning up full HTTP servers.
  - Prevents `srv/order-service.js` from ballooning into a monolithic file.
  - Facilitates seamless reuse in future phases (e.g., invoice generation, automated email notifications, and AI assistant routines).
- **Consequences**: Service handlers act as orchestrators, delegating business computations to domain helper modules.

---

## ADR 10: State Machine Enforcement via OData Bound Actions

- **Status**: Accepted
- **Context**: Sales order status changes represent distinct business milestones (`New` &rarr; `Submitted` &rarr; `Approved` &rarr; `Invoiced` / `Cancelled`) with role-specific approval rules. Allowing direct PATCH updates to `status` risks bypassing validation checks.
- **Decision**:
  - Annotate `status`, `orderNo`, `netAmount`, `taxAmount`, and `grossAmount` as `@readonly` at the service projection layer.
  - Implement explicit OData V4 bound actions: `submit()`, `approve()`, and `cancel()`.
- **Rationale**:
  - Prevents unauthorized or invalid transitions (e.g., approving an order that was never submitted, or directly setting status to `Approved` via PATCH).
  - Enforces role separation: `submit` requires `SalesRep`, `approve` requires `SalesManager`, and `cancel` requires either `SalesRep` or `SalesManager`.
  - Encapsulates domain transitions in an explicit state machine dictionary (`VALID_TRANSITIONS` in `srv/lib/constants.js`).
- **Consequences**: Clients must invoke bound POST actions (`/SalesOrders(<ID>)/OrderService.submit`, etc.) to trigger state changes. Direct modification of lifecycle fields via payload PATCH is rejected.

---

## ADR 11: Default Currency (USD)

- **Status**: Accepted
- **Context**: The assessment required calculating order amounts and threshold limits without specifying a mandatory currency.
- **Decision**: `USD` is hardcoded as the default and fallback `DEFAULT_CURRENCY` across all monetary fields.
- **Rationale**: Ensure calculations and testing thresholds are deterministic and require no live FX conversions.

---

## ADR 12: Auto-Approval Threshold

- **Status**: Accepted
- **Context**: Orders <= 5,000 do not require manual manager approval, to prevent bottlenecking for low-value orders.
- **Decision**: Implemented an auto-approval check in the `submit()` bound action.
- **Rationale**: If `grossAmount <= APPROVAL_THRESHOLD`, the order transitions directly to `Approved`. If `> 5000`, it transitions to `Submitted`.

---

## ADR 13: Billing Clerk Scope

- **Status**: Accepted
- **Context**: The BillingClerk role should only have visibility into orders that are ready for invoicing or already invoiced.
- **Decision**: Added a `where` clause to the `@restrict` annotation for BillingClerks (`where: 'status = ''Approved'' or status = ''Invoiced'''`).
- **Rationale**: Completely hides draft (`New`), `Submitted`, or `Cancelled` orders at the database level for users with the BillingClerk role, ensuring compliance and a clean workspace.
