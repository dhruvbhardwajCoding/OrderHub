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
11. [ADR 11: Default Currency (USD)](#adr-11-default-currency-usd)
12. [ADR 12: Auto-Approval Threshold](#adr-12-auto-approval-threshold)
13. [ADR 13: Billing Clerk Scope](#adr-13-billing-clerk-scope)
14. [ADR 14: `auth.kind` Must Be `mocked`, Not `dummy`](#adr-14-authkind-must-be-mocked-not-dummy)
15. [ADR 15: `pdfmake` 0.3.x API Migration](#adr-15-pdfmake-03x-api-migration)
16. [ADR 16: `SalesOrderItems.netAmount` Column Was Missing](#adr-16-salesorderitemsnetamount-column-was-missing)
17. [ADR 17: `sendInvoice` Email Override Instead of a Hard Failure](#adr-17-sendinvoice-email-override-instead-of-a-hard-failure)
18. [ADR 18: `sendInvoice`'s Failure-Marker Write Must Use `cds.spawn`, Not a Nested `cds.tx()`](#adr-18-sendinvoices-failure-marker-write-must-use-cdsspawn-not-a-nested-cdstx)
19. [ADR 19: Invoice Storage (DMS-01 to DMS-06) — Raw CMIS REST Client, Config-Switched, Read-Through Cache](#adr-19-invoice-storage-dms-01-to-dms-06--raw-cmis-rest-client-config-switched-read-through-cache)
20. [ADR 20: Northwind Timeout (MD-04), Cache (MD-05), and a `$filter`/`$search` Bug Found Along the Way](#adr-20-northwind-timeout-md-04-cache-md-05-and-a-filtersearch-bug-found-along-the-way)
21. [ADR 21: AnalyticsService (AN-01, AN-02, AN-03) — Server-Side Aggregation, Cross-System Join in the Handler](#adr-21-analyticsservice-an-01-an-02-an-03--server-side-aggregation-cross-system-join-in-the-handler)
22. [ADR 22: ESLint Config, Sample Invoice, and a Real (Unmocked) PDF Test](#adr-22-eslint-config-sample-invoice-and-a-real-unmocked-pdf-test)
23. [ADR 23: Customer Map (MAP-01 to MAP-04) — Custom Leaflet Control, Cascading Geocode Fallback](#adr-23-customer-map-map-01-to-map-04--custom-leaflet-control-cascading-geocode-fallback)
24. [ADR 24: AI Assistant (AI-01, AI-02) — Gemini, Server-Side Matching, Action Not Function](#adr-24-ai-assistant-ai-01-ai-02--gemini-server-side-matching-action-not-function)
25. [ADR 25: Order Delete (SO-01) and Stock Warning UI (SO-09)](#adr-25-order-delete-so-01-and-stock-warning-ui-so-09)
26. [ADR 26: Decoupling the Frontend and Backend into Two Standalone Services](#adr-26-decoupling-the-frontend-and-backend-into-two-standalone-services)
27. [ADR 27: Draft Editing (SO-08) — Service-Level Drafts, Validation at Activation](#adr-27-draft-editing-so-08--service-level-drafts-validation-at-activation)

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

---

## ADR 14: `auth.kind` Must Be `mocked`, Not `dummy`

- **Status**: Accepted
- **Context**: `package.json` configured `cds.requires.auth.kind: 'dummy'` alongside a `users` map (alice/bob/carol with distinct roles). CAP's built-in `dummy` strategy (`node_modules/@sap/cds/lib/srv/middlewares/auth/dummy-auth.js`) ignores Basic-Auth credentials entirely and always sets `req.user` to the framework's `privileged` user, which carries *every* role. The `users` map is only consulted by the `mocked` strategy.
- **Decision**: Changed `auth.kind` to `'mocked'` in both the default and `[test]` profiles (and in the test file's own `cds.env.requires.auth` override and `CDS_REQUIRES_AUTH_KIND` env var, which previously forced `'dummy'` regardless of `package.json`).
- **Rationale**: Under `dummy`, every HTTP Basic-Auth login — alice, bob, carol, or no credentials at all — was treated as fully privileged, so role-gated actions (`approve`, `createInvoice`, `sendInvoice`) silently accepted calls from any persona. This was invisible in most tests because a privileged user also satisfies every role check; only an explicit "role X must be rejected" test exposed it (`SalesRep cannot create or send invoices` failed with 200 instead of 403 until this was fixed).
- **Consequences**: SalesRep / SalesManager / BillingClerk separation is now actually enforced end-to-end, not just hidden behind client-side button visibility.

---

## ADR 15: `pdfmake` 0.3.x API Migration

- **Status**: Accepted
- **Context**: `srv/lib/pdf.js` called `new (require('pdfmake'))(fonts)`, following the pre-0.3 API where the package root exported the `PdfPrinter` class. `pdfmake@0.3.11` (the version pinned in `package.json`) restructured the package: the root export is now a singleton with `setFonts()` / `createPdf()`, `createPdfKitDocument()` became `async`, and a `localAccessPolicy`/`urlAccessPolicy` must be set or font/image resolution throws. The old code threw `PdfPrinter is not a constructor` on every `createInvoice` call — the reported "invoice won't generate" bug.
- **Decision**: Rewrote `pdf.js` against the current singleton API: `pdfMake.setFonts(...)`, `pdfMake.setLocalAccessPolicy(() => true)` (trusted, hardcoded standard-14 font names only), `pdfMake.setUrlAccessPolicy(() => false)` (no remote fetches — the invoice has no external images), then `pdfMake.createPdf(docDefinition).getBuffer()`.
- **Rationale**: Matches the installed dependency rather than downgrading pdfmake, and the new `OutputDocument.getBuffer()` helper removes the need to hand-roll stream-to-buffer collection.
- **Consequences**: Also used the opportunity to bring the invoice content up to the section 8 spec: line numbers, Bill-To address pulled live from Northwind, invoice/due dates, a dynamic tax-rate label, and a footer with payment terms + page numbers.

---

## ADR 16: `SalesOrderItems.netAmount` Column Was Missing

- **Status**: Accepted
- **Context**: `order-service.js`'s `CREATE` handler computes `item.netAmount` for every line and sums it into the order header's `netAmount`, but `db/schema.cds`'s `SalesOrderItems` entity never declared a `netAmount` column. CAP silently drops unmapped properties on `INSERT`, so the header totals were correct but every persisted item's own net amount was lost — confirmed by generating a real invoice PDF end-to-end and seeing `0.00` on every line.
- **Decision**: Added `netAmount : Decimal(15,2) @readonly;` to `SalesOrderItems` in `db/schema.cds`.
- **Rationale**: The item net amount is both a documented requirement (SO-04, and the section 8 invoice item table) and already computed server-side; it just needed somewhere to live.
- **Consequences**: Requires a fresh `cds deploy` / DB recreation to pick up the new column (existing `db.sqlite` files predate it).

---

## ADR 17: `sendInvoice` Email Override Instead of a Hard Failure

- **Status**: Accepted
- **Context**: Section 8's "Rules" explicitly note Northwind customers have no email address at all, and require generating a `<customerID>@example.test` placeholder with the UI allowing the recipient to be overridden before sending. The original `sendInvoice` action took no parameters and simply failed with "Customer has no usable email address" whenever `customer.Email` was empty — which, since Northwind never populates `Email`, meant the action could never succeed for a real Northwind customer.
- **Decision**: Added an optional `email` parameter to the `sendInvoice` bound action (`srv/order-service.cds`). The handler uses `req.data.email` if supplied (trimmed, validated against a basic email regex), else falls back to `customer.Email`, else fails as before. The UI (`SendInvoiceDialog.fragment.xml` + `SalesOrder.controller.js`) opens a dialog pre-filled with `<customerID>@example.test`, editable Subject/Message, and only calls the action on explicit confirm — matching the section 7.6 wireframe's "review before send" pattern.
- **Rationale**: Keeps the server as the source of truth for validation (so API/test callers without a UI still get a clear 400 if they send nothing and the customer has no email) while making the documented UI flow actually usable for every seeded Northwind customer.
- **Consequences**: `sendInvoice`'s existing "no email → FAILED + 400" contract is preserved for callers that don't pass `email`; new tests cover the override's success and validation paths.

---

## ADR 18: `sendInvoice`'s Failure-Marker Write Must Use `cds.spawn`, Not a Nested `cds.tx()`

- **Status**: Accepted
- **Context**: On a send failure, the handler needs to persist `mailStatus: 'FAILED'` on the `Invoices` row *and* still return an HTTP error via `req.reject()`. `req.reject()` throws, which rolls back the entire ambient request transaction — including any `db.run()` write made earlier in the same handler — so a plain write doesn't survive. The original code worked around this with a fresh `cds.tx()` + manual `.commit()`, but `@cap-js/sqlite` runs with a single-connection pool (`max: 1`); opening a second transaction while the ambient one is still open contends for that one connection and deadlocks (reproduced as a 30s Jest timeout on `BillingClerk can send invoice email (fails gracefully for mock customer)`).
- **Decision**: Replaced the nested `cds.tx()` with `cds.spawn({}, async (tx) => {...})`, which runs the write in a context detached from the current request (via a fresh `AsyncLocalStorage` context, scheduled with `setImmediate`), so it only acquires the pooled connection after the ambient transaction has released it.
- **Rationale**: `cds.spawn` is CAP's documented mechanism for "persist this even if the current transaction rolls back" side effects; it avoids both the deadlock and the data loss.
- **Consequences**: The FAILED-status write is fire-and-forget relative to the HTTP response — it reliably lands before any subsequent read in practice (a single `UPDATE` is far faster than the next network round-trip), but it is not strictly synchronous with the error response.

---

## ADR 19: Invoice Storage (DMS-01 to DMS-06) — Raw CMIS REST Client, Config-Switched, Read-Through Cache

- **Status**: Accepted
- **Context**: Section 8.1 requires PDF storage behind one module (`srv/lib/invoice-store.js`) with two swappable implementations — `local` (SQLite, the `cds watch` default) and `sdm` (SAP Document Management Service, Integration Option) — switched by CAP profile/`cds.env`, never by code. DMS-02 allows either the `@cap-js/sdm` plugin or the raw CMIS REST API. This assessment has no SAP BTP account, so `sdm` can only ever be built and tested against a mock (explicitly anticipated by the brief's "Access" note, which says doing exactly that only costs the DMS-06 bonus points).
- **Decision**:
  - Chose the raw **CMIS Browser Binding REST API** (`srv/lib/sdm-client.js`) over the `@cap-js/sdm` plugin. The plugin is built around its own `@sap/attachments`-style aspect/annotation model for arbitrary entity attachments; this project's schema already has its own explicit `Invoices.dmsObjectId` / `Invoices.content` columns matching the brief's own sketch, so wiring the plugin in would mean restructuring the schema around its conventions rather than the reverse. A direct REST client also stays honest about what is and isn't tested without real credentials — every HTTP call is mockable.
  - `cds.requires.invoiceStore.kind` (`local` default, `sdm` under a `[hybrid]` profile — `cds watch --profile hybrid`) selects the implementation; `cds.requires.sdm.credentials` (`url`, `repositoryId`, `uaa: {url, clientid, clientsecret}`) holds the service key, filled in by `cds bind` or env vars (`.env.example`), never hardcoded.
  - `sdm-client.js` authenticates via OAuth2 client-credentials (caching the token until near-expiry), resolves/creates the `/invoices/<year>` folder path idempotently, and uploads with `cmis:name`, `cmis:objectTypeId`, and a `cmis:description` carrying `orderNo`/`customerID`/`invoiceDate` (DMS-04) as a semicolon-separated string — simplest way to tag a document without defining a custom CMIS type.
  - **Read-through cache**: `GET /Invoices(ID)/content` is served by a `before('READ', Invoices)` handler that, the first time a stored invoice is requested in `sdm` mode, fetches the bytes from Document Management and writes them into the (otherwise `local`-only) `content` column, then lets the already-working generic SQLite media-stream handler serve them — see "why not mutate the READ result directly" below. Later requests for the same invoice are served from SQLite without hitting DMS again. `sendInvoice` goes through `invoiceStore.readInvoice()` directly and does *not* cache, so the very first access to a freshly created invoice (e.g. sending it before anyone has previewed it) still round-trips to DMS and is covered by a live-mode test (see Testing below).
  - Any DMS failure — upload (`createInvoice`) or download (`GET content`, `sendInvoice`) — surfaces as an HTTP 502 with a clear message; `createInvoice` does not insert the `Invoices` row or flip the order to `Invoiced` (DMS-05), and the `before('READ')` handler rejects the stream request instead of serving nothing.
- **Rationale for the read-through cache over strict "SQLite keeps only the invoice data and document ID"**: empirically, mutating a CAP `on('READ')` handler's returned row after calling `next()` does **not** reliably change what's actually streamed back to the client — `@cap-js/sqlite` resolves a plain `SELECT.one` (no explicit columns) by *excluding* `@Core.MediaType` columns entirely, and an explicit-column `SELECT` returns a Node `Readable` stream rather than a `Buffer`, so by the time `next()` resolves, the HTTP response machinery may already be wired to that original (empty) value. A `before` handler that backfills `content` in SQLite *before* the generic handler runs was verified end-to-end (real HTTP round trip) to work reliably, because it reuses the exact code path `local` mode already relies on, instead of re-implementing CAP's internal stream-serialization. Invoices are immutable once created, so caching their bytes after the first fetch is a correctness-neutral optimization, not a staleness risk.
- **A pre-existing bug this surfaced**: `sendInvoice`'s original `db.run(SELECT.one.from('orderhub.Invoices').where({order_ID: ID}))` never specified `.columns(...)`, so — per the same `@cap-js/sqlite` behavior above — `invoice.content` was always `undefined`, not the PDF. `sendInvoiceEmail(invoice.content, ...)` was therefore attaching `undefined` to every email nodemailer ever sent, silently (nodemailer doesn't reject a missing attachment body). Fixed by explicitly selecting `'ID', 'invoiceNo', 'content', 'dmsObjectId'`, and by having `invoice-store.js` normalize a `Readable` stream into a `Buffer` so callers never have to know which shape the DB driver handed back.
- **Testing**: `test/sdm-client.test.js` (9 tests) and `test/invoice-store.test.js` (10 tests) mock `fetch` / `sdm-client` respectively — folder creation, document upload with DMS-04 metadata, token caching, Buffer/stream normalization, and DMS-05 failure paths. Beyond unit tests, the full `local`→`sdm` round trip (create → DMS upload → lazy-backfilled `GET content` → `sendInvoice` straight from DMS → DMS-unreachable error path leaving the order un-invoiced) was verified against a real running server using `test/fixtures/mock-sdm-fetch.js`, a `fetch`-level CMIS mock loaded via `NODE_OPTIONS=--require`. Run it with `npm run demo:hybrid`.
- **Consequences**: Without a real Document Management instance, DMS-06 (showing it against a real instance via `cds bind`, in the demo video) cannot be completed — `npm run demo:hybrid` is the closest substitute, and the `[hybrid]` profile plus `cds.requires.sdm.credentials` are wired exactly as `cds bind` would populate them, so pointing `.env` at a real service key is the only change needed if access becomes available.

---

## ADR 20: Northwind Timeout (MD-04), Cache (MD-05), and a `$filter`/`$search` Bug Found Along the Way

- **Status**: Accepted
- **Context**: MD-04 requires a timeout and a readable error if Northwind is slow or down; MD-05 (Should) asks for an in-memory cache with a configurable TTL. Implementing both meant touching `delegateToNorthwind` (the generic `on('READ')` handler order-service.js registers for the five read-only Northwind projections — Customers, Products, Categories, Suppliers, Shippers), which surfaced a much bigger, pre-existing bug.
- **MD-04**: `srv/lib/northwind.js` now exports `withTimeout(promise, label)`, racing any Northwind call against `NORTHWIND_TIMEOUT_MS` (default 8000ms) and rejecting with a `{code: 'NORTHWIND_TIMEOUT', status: 504}` error on expiry. `getCustomer`/`getProducts`/`getCustomers`/`getCategories` and `delegateToNorthwind` all route through it, so every Northwind call site — order creation, invoice generation, and plain master-data reads — degrades the same way. Verified live by forcing `NORTHWIND_TIMEOUT_MS=1`: both a plain `GET /Products` and an order-creation POST (which calls `getCustomer`) failed with a clean `504` and the server stayed up and kept serving other requests afterward.
- **MD-05**: `srv/lib/northwind-cache.js` is a plain `Map`-based TTL cache keyed by `entity name + JSON.stringify(query-or-path)`, wired only into `delegateToNorthwind` — not into `getCustomer`/`getProducts` (order creation needs fresh stock/price/discontinued data; caching there would be a correctness bug, not an optimization). TTL defaults to 30s via `NORTHWIND_CACHE_TTL_MS`, 0 disables it. Confirmed live that `$top`/`$skip` variations of the same base query correctly share a cache entry (OData pagination is applied by CAP *after* the handler returns, not baked into the query), while different `$filter` values get independent entries.
- **The bug found while verifying MD-05 lived up its own correctness bar**: confirming different filters produced different cache entries meant actually comparing response bodies for `$filter=CategoryID eq 1` vs `eq 2` — and they came back identical and unfiltered. Tracing it (`node_modules/@sap/cds/libx/odata/parse/index.js`'s `odata_new_parser` feature, the hard default since @sap/cds 8.x per `lib/env/defaults.js`) showed that for a custom `on('READ')` handler on an `@cds.persistence.skip` entity, CAP's query builder populates `SELECT.orderBy`/`.limit`/`.count` correctly but **silently drops `SELECT.where` and `.search` built from `$filter`/`$search`** — confirmed with a `before('READ')` handler logging `req.query.SELECT` before any of this project's code ran. Key-based single-entity reads (`/Customers('ALFKI')`, used by the create-order flow) are unaffected — that key ends up in `SELECT.from.ref[0].where`, a different code path, which does work. This means `$filter`/`$search` had **never worked** on these five entities, since before any of today's changes — a real MD-03 violation invisible to the existing tests, since they only checked `status === 200` and a non-empty array, never that the array was actually filtered.
- **Decision**: For collection reads only (`req.query.SELECT.one` falsy), `delegateToNorthwind` now forwards the browser's *original* OData query string straight to Northwind via `northwind.send({method: 'GET', path})` instead of `northwind.run(req.query)` — a true proxy rather than relying on CAP's CQN translation. `northwind.send()` already returns a plain array with `.$count` set when `$count=true` was requested (confirmed live: `$top=3` → exactly 3 rows; `$count=true` → `.$count` present on the array) — exactly the shape CAP's post-processing expects, so no further adaptation was needed. Single-key reads keep using `northwind.run(req.query)` as before, since that path was never broken.
- **Rationale**: A hand-rolled OData `$filter` parser would duplicate what Northwind's own OData engine already does correctly, and risk getting the grammar subtly wrong (string vs. numeric literals, `and`/`or`, `contains()`, etc.). Forwarding the original query string sidesteps that entirely — Northwind parses exactly what the browser sent.
- **Testing**: `test/order-service.test.js` ("Northwind master-data reads") now asserts actual filtered *content* (`CategoryID eq 1` vs `eq 2` return disjoint, correctly-scoped product sets; `Country eq 'Germany'` returns only German customers), not just `status === 200` — this is the regression test that would have caught the original bug. `test/northwind.test.js` (8 tests) covers `withTimeout`'s resolve/timeout/passthrough-rejection behavior and the 502-vs-504 distinction; `test/northwind-cache.test.js` (5 tests) covers key independence per query/entity and TTL expiry.
- **Consequences**: Country/revenue-band map filtering (MAP-04, Should — not yet built) and any future `$search`-driven list screens on these five entities will now actually work; previously they would have silently returned everything.

---

## ADR 21: AnalyticsService (AN-01, AN-02, AN-03) — Server-Side Aggregation, Cross-System Join in the Handler

- **Status**: Accepted
- **Context**: AN-01/AN-02 require dashboard KPIs and charts to come from a CAP service that aggregates server-side, not from the UI summing `SalesOrders` rows (section 7.3). But the numbers that matter — revenue by *country*, revenue by *product category* — need data that spans both systems: money lives in local `SalesOrders`/`SalesOrderItems`, while country (on `Customers`) and category (on `Products`→`Categories`) live in Northwind. Section 6 explicitly rules out `$expand` across that boundary.
- **Decision**: A new read-only `AnalyticsService` (`srv/analytics-service.cds`/`.js`, mounted at `/odata/v4/analytics`) exposes four unbound functions — `getKPIs()`, `getRevenueByCountry()`, `getRevenueByCategory()`, `getTopCustomers(top)` — each doing the join by hand: aggregate the local rows by `customerID`/`productID` first (one SQL-ish query against SQLite), then batch-fetch just those customers/products/categories from Northwind (`getCustomers`/`getProducts`/`getCategories` in `srv/lib/northwind.js`, extended for this purpose — see ADR 20), and merge in JS. The dashboard (`Dashboard.controller.js`) calls these via a second named UI5 model (`"analytics"`, added to `manifest.json`) instead of reading `/SalesOrders` and reducing it client-side.
- **"Revenue" = confirmed orders only**: both `getKPIs().revenue` and the two breakdowns only sum orders with status `Approved` or `Invoiced` — not `New`/`Submitted` (not yet confirmed) or `Cancelled` (never happened). `orderCount` and `openApprovals`, by contrast, count *all* orders / `Submitted` orders respectively, since those are volume/queue metrics, not money. Verified live with a mix of statuses: a large `Submitted` order correctly inflated `orderCount` and `openApprovals` but was excluded from `revenue` and both breakdowns.
- **Revenue-by-category uses item `netAmount` (pre-tax), not order `grossAmount`**: category/product-level numbers are naturally a pre-tax, per-line concept (tax is computed once at the order level, not per item), while the KPI tile and revenue-by-country use `grossAmount` (what the customer actually pays). The two will not sum to the same total — that's intentional, not a bug, and is why `getRevenueByCategory`'s test asserts against the sum of item `netAmount`, not order `grossAmount`.
- **Charting**: used `sap.viz.ui5.controls.VizFrame` (bar for revenue-by-country, donut for revenue-by-category) — one of the two options the wireframe names in section 7.3. Added `sap.viz` to both `manifest.json`'s `sap.ui5.dependencies.libs` and `index.html`'s bootstrap `data-sap-ui-libs`.
- **Verification**: all four functions were exercised against a real running server with real orders across two customers/countries/categories (not just unit tests) — confirmed KPI totals, per-country and per-category breakdowns, and `getTopCustomers` ranking all matched hand-computed expected values, and that the `parent.status` path-expression `WHERE` clause (needed to scope `SalesOrderItems` by their parent order's status) compiles and executes correctly against `@cap-js/sqlite`. `test/analytics-service.test.js` (7 tests) covers the same scenarios against a mocked Northwind. **Not verified**: the actual rendered dashboard in a browser — VizFrame chart rendering and the UI5 `bindContext`/`bindList` calls against unbound OData functions were written to the standard UI5 v4 ODataModel API and the live service's `$metadata` (confirmed function signatures match exactly what the controller calls), but this could not be visually tested in this environment.
- **Follow-up, once a real browser screenshot was available**: three bugs surfaced. (1) `FeedItem.values` is a `string[]`-typed property; binding it to an i18n text (`values="{i18n>colRevenue}"`) resolves to a plain string at runtime and threw an uncaught type error *during view construction*, which silently blanked the entire Dashboard (not just the charts) — fixed by using plain literal strings ("Revenue"/"Country"/"Category") for these internal chart-binding keys instead of i18n bindings. (2) The two chart `Panel`s used `HBox` + `width="48%"`, which `sap.viz.ui5.controls.VizFrame` doesn't reliably size against (flex-percentage sizing vs. VizFrame's own internal d3-based layout); replaced with `sap.ui.layout.Grid` (`defaultSpan="L6 M12 S12"`), which gives each chart a real, stable pixel width. (3) The unbound-function binding calls themselves were wrong: `bindContext("/getKPIs(...)").requestObject()` — the `"(...)"` deferred-parameter syntax (paired with `.setParameter()` + `.execute()`) is for *actions*, not read-only *functions*, which need a literal, already-resolved path (`"/getKPIs()"`); and `ODataListBinding` (from `bindList`) has no `.setParameter()` at all — `getTopCustomers`'s `top` parameter needed to be embedded directly in the path (`"/getTopCustomers(top=5)"`).

---

## ADR 22: ESLint Config, Sample Invoice, and a Real (Unmocked) PDF Test

- **Status**: Accepted
- **Context**: Section 10's non-functional requirements explicitly call for a committed, clean ESLint config; a `docs/sample-invoice.pdf` deliverable; and, among the "at least 10 `cds.test` tests," one that verifies generated PDF bytes literally start with `%PDF`. None of these existed — and `test/order-service.test.js` mocks `srv/lib/pdf.js` everywhere, so the real `pdfmake` output was never actually exercised by any test.
- **Decision**:
  - `eslint.config.js` (flat config, ESLint 10 — the only format it supports) with two rule sets: Node/CommonJS globals (`require`, `module`, `SELECT`/`INSERT`/`UPDATE`/`DELETE` as CAP's injected CQN globals, etc.) for `srv/`, `test/`, and root config files, and browser/UI5 globals (`sap`, `jQuery`, `window`) with `sourceType: 'script'` for `app/**/*.js` (UI5 controllers are `sap.ui.define` AMD modules, not ES modules). `npm run lint` runs it; fixed the 1 real bug (`no-redeclare`: `_showCustomerOnMap` in `CustomerMap.controller.js` declared `var sMapHtml` twice in the same function scope — `var` is function-scoped so the two branches collided even though only one ever executes per call; switched both to block-scoped `const`) and 7 unused-variable warnings it found along the way. `npx eslint .` now exits clean.
  - `docs/sample-invoice.pdf`: generated with the real `generateInvoicePdf()` (not a mock) against a realistic 3-item order, so it's the actual artifact the app produces, not a hand-crafted stand-in.
  - `test/pdf.test.js` (5 tests): calls `generateInvoicePdf()` directly and unmocked — asserts the buffer literally starts with `%PDF` (the explicit requirement), plus a well-formed-PDF check (`%%EOF` trailer) for a 25-item/2-page order per section 8's "layout that still works with 25 items across 2 pages," a no-customer-snapshot path, and a zero-items edge case.
- **Consequences**: this is the first test in the suite to touch the real `pdfmake` dependency rather than a mock — if a future `pdfmake` upgrade breaks PDF generation again (as ADR 15 describes happening once already), this test suite now catches it.

---

## ADR 23: Customer Map (MAP-01 to MAP-04) — Custom Leaflet Control, Cascading Geocode Fallback

- **Status**: Accepted
- **Context**: The original `CustomerMap` view embedded a raw OpenStreetMap `<iframe>` — it showed a map, but not one "built with UI5 controls," which MAP-01 requires. The spec's primary suggestion, `sap.ui.mdc.Geomap`, is still experimental and needs a custom `GeomapDelegate` wired to a V4 list binding; the spec explicitly accepts "another UI5-compatible map control" as a fallback (section 6, Map). Separately, MAP-02 needs geocoded coordinates for customers that don't have any, and Northwind's addresses are fictional (`"Obere Str. 57"` doesn't exist), which breaks naive free-text geocoding.
- **Decision — map control**: Built `orderhub.control.LeafletMap` (`app/orderhub/control/LeafletMap.js`), a real `sap.ui.core.Control` — declared properties (`height`, `centerLat`, `centerLng`, `zoom`), a `spotPress` event, an apiVersion-2 renderer, and a `setMarkers()`/`fitToMarkers()` API — wrapping Leaflet.js (loaded via CDN with SRI-verified `<script>`/`<link>` tags in `index.html`, since UI5 has no built-in Leaflet binding). The control tears down and rebuilds its Leaflet map instance on every `onAfterRendering`, because UI5 re-renders produce a fresh DOM node each time and Leaflet's own internal DOM references would otherwise point at a detached element.
- **Decision — geocoding**: `srv/lib/geocode.js` calls Nominatim (OpenStreetMap's free geocoder) with a throttle (hard 1100ms minimum interval between requests — Nominatim's usage policy caps clients at 1 req/sec) and a required, descriptive `User-Agent` (`GEOCODE_USER_AGENT`, Nominatim rejects generic/browser-looking UAs). A single full-address query against Northwind's fictional streets empirically failed most of the time (`"Obere Str. 57, Berlin, 12209, Germany"` → `[]`), so `geocodeAddress()` tries four progressively coarser queries — full address → city+region+postal+country → city+country → country-only — stopping at the first hit. Verified live: this took the success rate from 61% (20/33 failing on the first, most-precise query alone) to 100% (0/20 failing) against real customer records.
- **Decision — caching and background fill**: Results land in `CustomerGeo` (`db/schema.cds`), keyed by `customerID`, with a `failed` flag so a customer whose address genuinely can't be resolved (even at country granularity) isn't re-queried on every dashboard load. `AnalyticsService.getCustomerLocations()` serves whatever is already cached immediately and kicks off `scheduleBackgroundGeocode()` (via `setImmediate`, deduplicated by a `Set` of in-flight IDs) for any customer not yet in the cache, so the map is never blocked on a slow, rate-limited geocoding pass — uncached customers simply appear on a later refresh.
- **Decision — revenue bands and filtering (MAP-04)**: `getCustomerLocations()` joins the geocoded coordinates with each customer's order count (all orders) and revenue (confirmed orders only — `Approved`/`Invoiced`, same convention as ADR 21's `AnalyticsService`), buckets revenue into `high`/`medium`/`low` via `REVENUE_BAND_HIGH_THRESHOLD`/`REVENUE_BAND_MEDIUM_THRESHOLD` (`srv/lib/constants.js`), and the view's filter toolbar (search, country `Select`, band `Select`) filters client-side against the already-fetched list.
- **Rationale**: A custom control is far less work than building and validating a `GeomapDelegate` for an experimental library control, and the spec explicitly sanctions it. The cascading geocode fallback trades precision (a country-level pin is obviously less exact than a street-level one) for actually having a pin at all — for this dataset's fictional addresses, the alternative was a map that's mostly empty.
- **Testing**: `test/geocode.test.js` (8 tests) covers throttling, the exact fallback cascade (including a case mirroring the real `"Obere Str. 57, Berlin"` failure), exhaustion (all four queries fail), and `scheduleBackgroundGeocode`'s dedup behavior. `test/analytics-service.test.js` covers `getCustomerLocations()`'s join/banding/background-trigger logic against a mocked Northwind and geocode module.
- **Follow-up, once real browser screenshots were available**: two layout bugs surfaced, both now fixed.
  1. The map was squeezed into a ~75px sliver next to the customer list. Cause: `LeafletMap` had no declared `width` property at all (the view's `width="70%"` was silently ignored), and its renderer hardcoded `width:100%` on the control's own root div — which, inside an `HBox` flex item with no explicit width, collapses to content size (visually, just the Leaflet zoom buttons). Fixed by giving the control a real `width` property (honored by the renderer) and replacing the `HBox` with `sap.ui.layout.Grid` (9/12 map, 3/12 list), the same fix pattern ADR 21 already used for the dashboard's `VizFrame` sizing bug.
  2. Placing `<layoutData><GridData .../></layoutData>` directly inside `<custom:LeafletMap>` then threw `"Cannot add direct child without default aggregation defined"` at runtime, even though the identical markup worked on a sibling `sap.m.VBox` in the same view. `layoutData` is inherited from `sap.ui.core.Element` and should resolve on any `Control` subclass without being redeclared, but empirically did not for this custom control. Rather than debug UI5's aggregation-inheritance internals further, fixed it the reliable way on both ends: wrapped `LeafletMap` in a plain `VBox` and put the `GridData` there (the already-proven-working pattern from the list column), and separately added an explicit `aggregations: { layoutData: {...} }` to the control's own metadata as a defensive fix for any future direct use.
  - The Leaflet control's actual rendering, marker placement, and popover interaction were then confirmed working by the user in a real browser.

---

## ADR 24: AI Assistant (AI-01, AI-02) — Gemini, Server-Side Matching, Action Not Function

- **Status**: Accepted
- **Context**: Section 9 asks for one AI feature wired through a CAP action or function, with two hard constraints: the app must work fully with no AI key configured (AI-02), and nothing the model proposes may be trusted directly — every customer/product it names must be matched against live Northwind data before anything is saved. Of the suggested options, "order from text" (option A — paste a customer email, get a structured draft order) was chosen as the most concretely demonstrable within a CAP+UI5 app, and Google Gemini as the provider, since the user supplies their own `GEMINI_API_KEY`.
- **Decision — provider isolation**: `srv/lib/ai.js` wraps Gemini's REST API directly (no SDK dependency, consistent with this project's other thin REST clients like `sdm-client.js`) behind two functions: `isConfigured()` (reads `process.env.GEMINI_API_KEY` at call time, not import time, so it reflects the current environment even across test runs) and `extractOrderFromText(text)`, which calls `generateContent` with `responseMimeType: 'application/json'` and an explicit `responseSchema` so Gemini returns structured JSON rather than freeform prose to parse. This function only extracts *hints* (`customerHint`, `items[{productHint, quantity}]`, `deliveryNote`) — it never sees Northwind data and never invents a customer or product ID itself.
- **Decision — action, not function**: `proposeOrderFromText(text: String)` is declared as an **action** on `OrderService`, not a function, matching the existing `sendInvoice(email: String)` precedent. OData functions pass parameters URL-encoded in the request path; a pasted email can be arbitrarily long with line breaks and punctuation that don't survive that encoding cleanly, so this needed a POST body. (Caught and corrected mid-implementation — it was initially written as a function before this mismatch was noticed; re-verified via `cds compile srv/order-service.cds -s OrderService --to edmx` that it compiles as `<Action IsBound="false">`/`<ActionImport>`.)
- **Decision — server-side matching is mandatory, never trust the model**: the `proposeOrderFromText` handler (`srv/order-service.js`) takes Gemini's raw hints and matches each one against a live `getAllCustomers`/`getAllProducts` Northwind fetch via a shared `matchEntity()` helper (case-insensitive substring match; zero matches → `not_found`, more than one → `ambiguous`, exactly one → `matched` with the real Northwind ID/name attached). The response always carries a `matchStatus` per item and for the customer, so the UI can show the clerk exactly what was and wasn't resolved — nothing with an unresolved ID can reach order creation, since the "Create draft order" UI flow only forwards items with `matchStatus: 'matched'`.
- **Decision — AI-02 degrades without an error**: rather than having the action throw/404 when no key is configured, the handler short-circuits to a normal 200 response shaped like a real (empty) proposal (`{ aiAvailable: false, customerStatus: 'not_found', items: [], ... }`). The UI's primary defense is disabling the shell bar's AI-assistant button entirely (bound to `/user-api/currentUser`'s new `aiAvailable` flag, reused from the existing endpoint rather than adding a dedicated OData round trip just for one boolean) with a tooltip explaining why; the `aiAvailable` check in the response is a second, defense-in-depth layer in case the action is ever called directly.
- **Decision — UI reuses the existing order-creation flow**: "Create draft order" in the AI assistant dialog does not call a new endpoint — it stashes the matched items on the component (`this.getOwnerComponent()._aiDraftItems`, a one-shot handoff keyed by `customerID`) and navigates to the existing `createOrder` route, which picks the stash up in its `_onPatternMatched` if present (and discards it otherwise, so a manual visit to the same route is unaffected). The clerk still reviews/edits quantities and saves through the same `/SalesOrders` POST as any manually built order — the AI only pre-fills, it never writes anything itself.
- **Rationale**: Treating the model's output as untrusted hints (rather than, say, letting it name Northwind IDs directly) is the only way to satisfy "every customer and product matched against Northwind before anything is saved" without also trusting an LLM not to hallucinate an ID. Reusing the create-order flow rather than adding an AI-specific save path means AI-created orders go through exactly the same validation (stock, discontinued, quantity/discount bounds) as any other order — there is no separate, less-tested write path to keep in sync.
- **Testing**: `test/ai.test.js` (9 tests) covers the Gemini client directly against a mocked `fetch` — configuration, successful structured extraction, and every failure mode (`AI_NOT_CONFIGURED`, network failure, non-OK HTTP, empty response, non-JSON response) each mapping to the right error code/HTTP status. `test/order-service.test.js`'s "AI assistant" block (7 tests) exercises `proposeOrderFromText` end-to-end against a mocked `ai.js` and mocked Northwind data — matched/ambiguous/not-found paths for both customer and items, and the AI-02 no-key response shape. Verified live against the real running server (no `GEMINI_API_KEY` set in this environment) that `/user-api/currentUser` returns `aiAvailable: false` and that `proposeOrderFromText` returns the expected empty-proposal shape rather than erroring. **Not verified**: the real Gemini extraction path (no API key available in this environment) and the dialog's rendering in a browser — see README's Known Limitations.

---

## ADR 25: Order Delete (SO-01) and Stock Warning UI (SO-09)

- **Status**: Accepted
- **Context**: Two "Should"/partial items remained after the map and AI work: SO-01 (delete had no UI entry point) and SO-09 (the server already emits a non-blocking stock warning via `req.warn`, but nothing surfaced it). Both were small, well-scoped, low-risk additions to already-working flows — unlike SO-08 (draft editing), which was deliberately left out as a real architectural change (see README's Known Limitations).
- **Decision — delete (SO-01)**: `@restrict` already grants `DELETE` to `SalesRep` with no status condition (CAP's declarative `@restrict` can't see the row being deleted to condition on it), so a `before('DELETE', SalesOrders)` handler in `srv/order-service.js` rejects with 409 unless `status === 'New'` — mirroring the existing `before('UPDATE', ...)` guard just above it, which already enforces the same "only while New" rule for edits. This matters beyond UX: `Invoices.order` is a plain `Association` to `SalesOrders`, not a `Composition`, so deleting an order that already has an invoice would **not** cascade-delete it and would leave an orphaned `Invoices` row pointing at a deleted order. Gating on `status === 'New'` rules this out structurally, since an order can only reach `Invoiced` (and therefore only get an `Invoices` row) after leaving `New`. A `btnDelete` button was added to the `SalesOrder` object page footer (visible only for `SalesRep` on a `New` order, following the exact same visibility-flag pattern as `btnSubmit`/`btnApprove`/`btnCancel`), calling the UI5 v4 model's `oContext.delete()` and navigating back to the list on success.
- **Decision — stock warning (SO-09)**: rather than wire up CAP's OData message-instance-annotation mechanism (`req.warn` → `@com.sap.vocabularies.Common.v1.Messages` → UI5's `MessageManager`) — which works, but ties the UI's warning display to async message-propagation timing that's hard to verify without a browser — the warning is instead computed directly in the UI from data already on hand, the same way `CreateOrder.controller.js`'s `_validateOrder` already duplicates the server's quantity/discount bounds checks client-side for immediate feedback. `onProductSelectConfirm` now also captures `UnitsInStock` from the selected product (already fetched for the select dialog's own "Stock: {UnitsInStock}" display) and stores it on the order-model item; a new `formatter.stockWarningVisible(quantity, unitsInStock)` drives a per-row `ObjectStatus` warning badge in the items table. The check is non-blocking (save/submit still succeed), matching the server's own `req.warn` semantics exactly.
- **Stock data extended to the AI path too**: `ProposedOrderItem` (the AI assistant's response type) gained a `unitsInStock` field, populated in `proposeOrderFromText`'s Northwind product match (`srv/order-service.cds`, `srv/order-service.js`), and threaded through `App.controller.js`'s `onAiCreateDraftOrder` item mapping into the same `unitsInStock` field `CreateOrder.controller.js` already reads — so an order drafted from a pasted email gets the same stock warning as one built by hand, through the one shared code path (no second, AI-specific warning implementation to keep in sync).
- **Testing**: `test/order-service.test.js`'s new "Order deletion (SO-01)" block (5 tests) covers: SalesRep deletes a New order (204, then a 404 on re-read); deletion rejected (409) once Submitted or Approved; deletion rejected (403) for SalesManager/BillingClerk, who were never granted it. The existing AI-matching test was extended to assert `unitsInStock` is carried through. Verified live against the real running server: create → delete (204) → re-read (404); create → submit → delete (409, naming the actual status); SalesManager delete attempt on a New order (403); and, with a mocked Gemini response, `proposeOrderFromText` returning `unitsInStock: 39` for a matched product. The stock-warning badge's actual rendering was not independently verified in a browser — see README's Known Limitations.

---

## ADR 26: Decoupling the Frontend and Backend into Two Standalone Services

- **Status**: Accepted
- **Context**: Through ADR 25, this was one CAP project: `cds watch` served the UI5 app under `app/orderhub/` as static files from the same Express process and the same port (4004) as the OData API, which is CAP's own default convention for a project laid out this way. Requested afterward: split it so the frontend and backend run as two independent, separately-started services on different ports — "microservice-like" — rather than one process serving both.
- **Decision — physical split**: Moved everything backend-owned (`srv/`, `db/`, `test/`, `package.json`, `.env`, `eslint.config.js`, `node_modules`) into a new `backend/` folder, and `app/orderhub/` into `frontend/orderhub/` under a new `frontend/` folder, each now its own npm project with its own `package.json`, `node_modules`, and `eslint.config.js`. Moving the UI5 app out of `app/` is itself load-bearing, not cosmetic — that's the specific path CAP auto-discovers and serves; moving it out is what stops the backend from serving it at all, forcing a real second process.
- **Decision — frontend serving**: `frontend/server.js` is a ~15-line Express static file server (the only dependency `frontend/package.json` has) serving `frontend/orderhub/` on port 8080 (`PORT` env var to override). No UI5 tooling (`@ui5/cli`) or build step — the app was already plain static files (XML views, AMD-module controllers, a CDN-loaded UI5 runtime), so a static server is all serving it standalone ever needed.
- **Decision — CORS, not a proxy**: The browser now sees two origins (`localhost:8080` for the app, `localhost:4004` for the API), so every OData call is cross-origin. Rather than adding a reverse proxy in front of both (more moving parts, another thing to configure and keep in sync), `backend/srv/server.js` registers a `cds.on('bootstrap', (app) => app.use(...))` middleware — bootstrap runs before CAP mounts its own protocol adapters, so it covers every route, not just the hand-written `/user-api/currentUser` one — that sets `Access-Control-Allow-Origin` to the exact configured `FRONTEND_URL` (default `http://localhost:8080`, env-overridable) plus `Access-Control-Allow-Credentials: true`, and answers `OPTIONS` preflights with a bare `204`. The origin can't be `*`: the app authenticates via `fetch(..., {credentials: "include"})` (Basic Auth), and the CORS spec disallows the wildcard origin on any credentialed request — confirmed live (`curl -i` with an `Origin` header) that both a preflight and a real authenticated `GET` come back with the specific origin echoed, not `*`, and that CORS headers are present on error responses too (502s included), since the middleware runs for every request regardless of outcome.
- **Decision — absolute backend URLs, not a proxy or relative paths**: `manifest.json`'s `dataSources` (`mainService`, `analyticsService`) now point at `http://localhost:4004/...` instead of `/odata/v4/...`, and the two remaining hand-written calls — `Component.js`'s `/user-api/currentUser` fetch and `SalesOrder.controller.js`'s invoice-PDF `window.open` — read from a `BACKEND_URL` constant declared at the top of each file. There's no way to share one JS constant into a static `manifest.json`, so this is three places to edit together, called out in a one-line comment at each site and in the README/`.env.example`, rather than introducing a build step or a runtime-config-injection mechanism to serve one hardcoded local URL.
- **Follow-up, once tested in a real browser**: `curl` tests passed but the browser still showed no data, for three reasons curl can't reveal. (1) The UI5 v4 `ODataModel` makes its own requests and doesn't send cached Basic Auth cross-origin unless its `withCredentials: true` setting is on (added to both models in `manifest.json`). (2) It sends its own request headers (`X-CSRF-Token`, `sap-cancel-on-close`, more by version), so `Access-Control-Allow-Headers` now reflects whatever the preflight's `Access-Control-Request-Headers` lists instead of a fixed list. (3) It rejects any response whose `OData-Version` header it can't read, and browsers hide non-safelisted response headers from cross-origin JS, so `Access-Control-Expose-Headers` now lists `OData-Version` and the other headers UI5 reads. Verified with headless Chromium (Playwright): 77 products, 20 map markers, and the dashboard charts all render. The same browser run also caught an older bug: every product showed "Discontinued: Yes" because a v4 formatter on an `Edm.Boolean` receives the formatted string ("No", which is truthy), not the boolean. Fixed with `targetType: 'any'`.
- **Rationale**: A reverse proxy would hide the fact that these are two separate services instead of demonstrating it, and would be one more process to run and debug. Plain CORS is exactly what two independently-deployable services would actually use in production, and it's a handful of lines, not a new dependency.
- **Testing**: Full `backend/` Jest suite (122 tests) re-run unaffected from the new location — nothing in `cds.test()`'s project-root resolution or any test's relative paths depended on being at the repo root rather than `backend/`. Both `eslint.config.js`s (backend's narrowed to drop the now-nonexistent `app/**/*.js` glob; a new, smaller one added for `frontend/`) lint clean. Verified live, both servers running simultaneously on their real ports: an `OPTIONS` preflight and a real credentialed `GET /user-api/currentUser` from `Origin: http://localhost:8080`, a cross-origin `GET /SalesOrders` returning real data, and a cross-origin `POST /proposeOrderFromText` whose *error* response (a Gemini timeout, unrelated to this change) still carried the correct CORS headers — confirming the middleware applies uniformly, not just to the success path. `frontend/index.html`, `manifest.json`, and `Component.js` were fetched from the running frontend server and inspected to confirm the served files contain the corrected absolute URLs.

---

## ADR 27: Draft Editing (SO-08) — Service-Level Drafts, Validation at Activation

- **Status**: Accepted
- **Context**: SO-08 ("Should") was deliberately scoped out in ADR 26's time frame as a real architectural change against an already-complete, tested order flow — not a metadata flag flip. Implemented afterward, following a written plan (`docs/SO-08-draft-plan.md`, since superseded by this ADR) that front-loaded eight assumptions about CAP 8.9's draft behavior to verify live before writing feature code, rather than discovering them mid-implementation.
- **Decision — where drafts live**: `annotate OrderService.SalesOrders with @odata.draft.enabled` in `srv/order-service.cds`. `SalesOrderItems`, a composition child, becomes draft-enabled automatically — no separate annotation. This changes `SalesOrders`' OData key from `ID` to `(ID, IsActiveEntity)` everywhere, including every test URL and every frontend navigation path that addresses an order directly.
- **Decision — validation moves to activation, not creation**: `POST /SalesOrders` now creates a draft (`IsActiveEntity: false`) and runs none of the old CREATE validation — no order number, no computed totals, `customerName`/`productName`/prices all `null` unless separately filled in. `OrderService.draftActivate` is what actually fires the CREATE event (for a brand-new draft) or UPDATE (for an edited one) on the **active** entity — which is exactly where the pre-existing validation belongs, since a draft is allowed to be incomplete or momentarily invalid while someone is still editing it. The original CREATE handler's body (customer/product lookup, discontinued check, quantity 1–999, discount 0–25%, stock `req.warn`, snapshot, totals) was extracted into one shared `validateAndPrice(req, {isNew, northwind, db})`, called from both `before('CREATE', SalesOrders)` and — only when `req.data.items` is present — `before('UPDATE', SalesOrders)`, so CREATE and an edit's activation share one implementation instead of two that could drift. `isNew` only controls two things: whether `orderNo` is (re)generated and whether `status` is reset to `'New'`.
- **Decision — draft-only handlers, kept deliberately light**: `before('NEW', SalesOrders.drafts)` validates the customer and snapshots its name immediately (so the editor has something to show before the clerk does anything else), rather than waiting for activation. `before('NEW'/'UPDATE', SalesOrderItems.drafts)` fills in `productName`/`unitPrice`/`netAmount` as items are added or edited, and an `after` handler recomputes the draft's own header totals (`netAmount`/`taxAmount`/`grossAmount`) from whatever items currently exist — but none of this enforces the activation-time bounds (quantity 1–999, discount 0–25%, discontinued). An incomplete or momentarily-invalid draft is fine; it just can't activate until it's valid.
- **Decision — guards**: `before('EDIT', SalesOrders)` rejects 409 unless the active order's `status === 'New'` (same rule UPDATE already enforced for direct edits). The five workflow actions (`submit`/`approve`/`cancel`/`createInvoice`/`sendInvoice`) get explicit `this.on(action, SalesOrders.drafts, ...)` handlers that reject 409 with a clear message — CAP already blocks calling them on a draft key with a generic 501 ("no handler for ... drafts") since they're only registered against the active entity, so this is a better message for the same outcome, not a new restriction. The DELETE guard (SO-01, ADR 25) had a latent bug this surfaced: `req.params[0]` is now `{ID, IsActiveEntity}`, and the old code passed that object straight into `where({ID})`, which matches no row and silently stops guarding deletes of active orders — fixed by reusing `extractKey()` (already used by the bound actions), with an explicit early return for a draft key (`IsActiveEntity === false`), since discarding a draft is always allowed and never needs the active-order status check.
- **Decision — the editor is OData-bound, not a JSON model**: `OrderDraft.view.xml`/`.controller.js` replace the old `CreateOrder` form (a local JSON model POSTed in one shot at the end) with one screen, for both "new order" and "edit order", element-bound directly to the draft. Every quantity/discount edit and every add/remove of a product goes to the server as it happens (the v4 model's `$auto` group batches and sends it) — that's the actual point of a draft, versus a client-side form that happens to also create a server-side row. `CreateOrder.controller.js` is reduced to: create a draft, seed it from the AI assistant's stash if present (as **individual** item POSTs, not a deep insert — deep-inserted items don't get `before('NEW', SalesOrderItems.drafts)` treatment, verified live: `productName`/`unitPrice`/`netAmount` stay `null` until activation either way, but individual POSTs mean the editor can show them correctly immediately instead of blank), then hand off to `OrderDraft`.
- **Decision — Sales Orders list shows drafts too**: `$filter: 'IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null'` — the standard CAP/Fiori pattern for "show a draft if one exists, otherwise show the active row," so a user never sees both the stale active version and their in-progress edit of the same order as two separate rows. A draft row has no `orderNo` yet (shows "Draft" instead) and its `status` reads `'New'` from the CDS default regardless of what it's actually a draft *of* — `formatter.orderListStatusText`/`orderListStatusState` special-case `IsActiveEntity === false` to show "Draft" instead, duplicating (not calling) `statusState`'s switch, since a `".formatter.xyz"` XML binding isn't guaranteed to run with `this` bound to the formatter module.
- **A1–A8, the plan's pre-verified assumptions**: all eight held in this CAP version (8.9.10) — POST creates an unvalidated draft; `draftActivate` fires CREATE with the full payload; `draftEdit` + an item PATCH + `draftActivate` fires UPDATE with `req.data.items` already populated (no separate query needed); a plain `GET /SalesOrders` already excludes drafts with no extra `$filter`; `@restrict`'s existing grants cover the draft NEW/EDIT events without changes; bound actions on a draft key 501 automatically; `$expand=invoice` keeps working on the active entity; a direct `PATCH` of an active instance now fails outright (`cds.fiori.bypass_draft` would be needed to allow it, and this project deliberately doesn't set it).
- **Two things the plan didn't anticipate, found only by testing live**:
  1. **File-based SQLite needs an explicit `cds deploy` after a schema change.** `cds watch` against a missing `db.sqlite` creates an empty file, not a deployed one — the first `POST /SalesOrders` failed with `no such table: DRAFT_DraftAdministrativeData`. `npx cds deploy --to sqlite:db.sqlite` (re-run after every schema change during this work) is the fix; this only matters for the persistent dev database, not the in-memory one `[test]` profile uses.
  2. **A PATCH/DELETE against a composition child's own draft entity set doesn't behave like the draft root's.** `PATCH /SalesOrderItems(ID=..,IsActiveEntity=false)` dispatches as CAP event `'UPDATE'`, not `'PATCH'` — the event-name remap that turns UPDATE into PATCH for drafts only triggers for the entity CAP considers the draft root. And `DELETE` on that same child entity set leaves `req.params` empty (confirmed via logging: `extractKey(req)` returned `undefined`) — unlike the draft root or a bound action, both of which populate it — so the deleted item's ID has to be parsed out of `req.query.DELETE.from.ref[0].where` instead (`extractDeleteKey()`, next to `extractKey()`), the same pattern the invoice content-stream handler already used for a different reason.
- **Two frontend bugs, also found only in a real browser, not curl**: `HasDraftEntity`/`HasActiveEntity` are read imperatively (`oContext.getProperty(...)` in `_updateButtonVisibility`/`onDiscard`) and never appear in a declarative XML binding, so `autoExpandSelect`'s view-binding-based column inference never requests them — both element bindings needed an explicit `$select` for just that one property, or the property silently reads as `undefined` (discovered because `onDiscard` was taking the wrong branch, navigating to the orders list instead of back to the active order it was editing). And the stock-warning lookup's and the draft-aware status badge's new composite bindings hit the same `Edm.Int32`/`Edm.Boolean`-to-formatter-argument type coercion issue ADR 26 already found once for `Discontinued` — every part needs `targetType: 'any'`, or UI5 throws `FormatException: Don't know how to format ... to boolean` instead of calling the formatter at all.
- **Rationale**: Service-level `@odata.draft.enabled` on top of the hand-built state machine (rather than, say, a bespoke "is this order locked for editing" flag) reuses CAP's own battle-tested draft-concurrency and discard-on-timeout machinery instead of reinventing it, and keeps the active entity's lifecycle (`New`→`Submitted`→`Approved`→...) completely separate from and unaffected by whether it's currently being edited. Running validation once, at activation, rather than on every draft keystroke, is what makes "the draft can be incomplete while being edited" possible at all — the alternative (validate on every PATCH) would make it impossible to, say, clear a quantity field while typing a new value.
- **Testing**: Backend — `test/order-service.test.js`'s helpers (`orderUrl()`, `createActiveOrder()`) replace every old "POST then use `data.ID`" pattern with a real create-then-activate round trip, so the test suite exercises the actual draft flow rather than a bypass; a new "Draft editing (SO-08)" block (12 tests) covers draft creation, immediate customer validation, activation success/failure (and that a failed activation leaves the draft intact), live item fill-in and header totals, edit→patch→activate re-pricing with the order number preserved, `draftEdit` rejected on a non-New order, a workflow action rejected on a draft key, discard leaving the active order untouched, the SO-01 delete-guard regression, and role restrictions (SalesManager/BillingClerk can start or edit nothing). `test/analytics-service.test.js` gets one test confirming an unactivated draft never moves a KPI number. 136 tests total, all passing; `npx eslint .` clean on both `backend/` and `frontend/`.
  Frontend — verified against headless Chromium (Playwright), not just curl, including with a real (not mocked) Gemini key: a new order survives a full page reload mid-edit with its exact in-progress state (item, quantity); Save assigns an order number and correct totals; editing an existing New order, changing a quantity, and discarding leaves the order byte-for-byte unchanged; editing again and saving updates the totals under the same order number; Submit makes the Edit button disappear; the AI assistant's "Create draft order" lands in this same editor with the matched item already added, priced, and summed into the header total; a draft abandoned without Discard or Save (navigated away from directly) shows a "Continue Draft" button on revisit, which takes priority over "Edit"; bob (SalesManager) never sees Edit or Continue Draft on any order; the editor is usable at 390px with no horizontal scroll.
