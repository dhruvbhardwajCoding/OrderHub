# SO-08 Draft Editing — Implementation Plan

Requirement: SO-08 (Should) — "Draft editing (`@odata.draft.enabled`)".
Goal: a SalesRep can start an order, leave, come back and continue it, and edit an existing `New` order without touching the live record until they save. Everything else (submit/approve/invoice, analytics, map, AI) keeps working.

Read this whole file before writing code. Work in the phases below, in order, and stop at each **Gate** until it passes.

---

## 0. Context you need

- CAP `@sap/cds` **8.9.10**. `cds.fiori.lean_draft` is **true** by default, and the plan relies on its event model:
  - Draft-only events run on `SalesOrders.drafts`: `NEW` (create draft), `PATCH` (edit draft), `EDIT` (copy active → draft), `DISCARD` (delete draft).
  - **Activation** (`draftActivate`) fires a normal `CREATE` (new order) or `UPDATE` (edited order) on the **active** `SalesOrders`. So the existing `before('CREATE', SalesOrders)` validation runs at *activation*, not when the draft is created. That's what we want.
- Drafts are stored in separate tables (`OrderService_SalesOrders_drafts`, `..._SalesOrderItems_drafts`). Anything that reads `orderhub.SalesOrders` directly (AnalyticsService, `order-number.js`, map revenue) **never sees drafts**. Don't change those.
- Enabling drafts changes the OData key of `SalesOrders` from `ID` to `(ID, IsActiveEntity)`. **Every URL `/SalesOrders(<uuid>)` breaks.** It must become `/SalesOrders(ID=<uuid>,IsActiveEntity=true)` (active) or `...IsActiveEntity=false` (draft). This is the biggest source of breakage: ~40 test URLs plus the frontend paths.
- `req.params[0]` in bound actions and DELETE becomes an **object** `{ ID, IsActiveEntity }` instead of a string. `extractKey()` (order-service.js ~line 592) already handles objects. The **DELETE guard (line ~225) does not**: it passes `req.params[0]` straight into `where({ ID })`. That must be fixed or it silently stops guarding.
- Existing gap that drafts will expose: `before('UPDATE', SalesOrders)` (line ~200) only checks status and **never re-validates or re-prices**. Today a PATCH of items doesn't recompute totals. Draft activation of an edit fires UPDATE, so pricing must run there too.

### Assumptions to verify in Phase 0 (don't build on them until confirmed)

CAP draft details vary by version. Check each with `curl` against a running server (alice/alice) and note the result in the PR description:

| # | Assumption | How to check |
|---|---|---|
| A1 | `POST /SalesOrders` with `{customerID, items:[...]}` creates a **draft** (deep insert into the draft tables), returns `IsActiveEntity:false`, and does **not** run `before('CREATE', SalesOrders)` | POST, check response and that no `orderNo` is set |
| A2 | `POST /SalesOrders(ID=..,IsActiveEntity=false)/OrderService.draftActivate` runs `before('CREATE', SalesOrders)` with the full payload incl. items | log in the handler |
| A3 | `draftEdit` on an active order, then `draftActivate`, runs `before('UPDATE', SalesOrders)` with `req.data` containing items | log `req.data` |
| A4 | Plain `GET /SalesOrders` returns **active entities only**. If not, list bindings need `$filter=IsActiveEntity eq true` | GET with a draft present |
| A5 | `@restrict` grants map onto draft events (CREATE covers NEW/activate, UPDATE covers EDIT/PATCH). Bob (SalesManager) and Carol (BillingClerk) get 403 on POST and `draftEdit` | try as bob/carol |
| A6 | Bound actions (`submit` etc.) are callable on the draft key too, so they need an explicit guard | POST `.../SalesOrders(ID=..,IsActiveEntity=false)/OrderService.submit` |
| A7 | `$expand=invoice` still works on the active order (Invoices is not draft-enabled; `Invoices.order` points at a draft-enabled target) | GET an invoiced order with `$expand=items,invoice` |
| A8 | Direct `PATCH` of an active order is rejected now (draft-enabled actives are read-only unless `cds.fiori.bypass_draft`) | PATCH as alice; the existing "direct PATCH" tests will tell you what changed |

If an assumption is false, adapt the step that depends on it and note why in the ADR (Phase 4).

---

## Phase 0 — Spike (no feature code yet)

1. In `backend/srv/order-service.cds`, annotate the service projection (not `db/schema.cds`):
   ```cds
   annotate OrderService.SalesOrders with @odata.draft.enabled;
   ```
   `SalesOrderItems` is a composition child, so it becomes draft-enabled automatically.
2. `cd backend && npx cds compile srv/order-service.cds -s OrderService --to edmx | grep -n "IsActiveEntity\|draftActivate\|draftEdit"` — confirm the draft actions and composite key exist.
3. Run `npm test`, save the list of failures (expected: most order tests, because of the URL/key change).
4. Start the server and run the A1–A8 checks.

**Gate 0:** you have the failure list and A1–A8 answered. Don't fix tests yet.

---

## Phase 1 — Backend

All in `backend/srv/order-service.js` unless stated otherwise.

### 1.1 Shared validation + pricing
Extract the body of `before('CREATE', SalesOrders)` (lines ~104–194) into one function, e.g.:

```js
async function validateAndPrice(req, { isNew }) { ... }
```

It does exactly what CREATE does today (customer/product lookup, discontinued, qty 1–999, discount 0–25, stock `req.warn`, snapshot names/prices, line + header totals, currency default). Then:
- `isNew === true` → also set `status = New` and `orderNo = await generateOrderNumber(db)`.
- `isNew === false` → **don't** touch `orderNo` or `status`.

Register it:
- `before('CREATE', SalesOrders, req => validateAndPrice(req, { isNew: true }))`. This is activation of a new draft (A2).
- In the existing `before('UPDATE', SalesOrders)`: keep the "only while New" check (use `extractKey`/`req.data.ID`), then call `validateAndPrice(req, { isNew: false })` **if `req.data.items` is present**. This is activation of an edit (A3). If A3 shows `items` isn't in `req.data` on UPDATE, load the draft items with `SELECT.from(SalesOrders.drafts...)`, or price inside an `on('UPDATE')` after reading the full deep data. Note which one you used.

Don't duplicate the validation code. A second copy will drift.

### 1.2 Guards
- **EDIT:** `this.before('EDIT', SalesOrders, ...)` → load the active order; reject `409` unless `status === 'New'` ("Only 'New' orders can be edited").
- **Bound workflow actions on drafts:** in `submit`, `approve`, `cancel`, `createInvoice`, `sendInvoice`, reject `409` "Save the draft first" when `req.params[0].IsActiveEntity === false`. A small helper `assertActive(req)` next to `extractKey` is fine (A6).
- **DELETE guard fix:** replace `const ID = req.params[0]` with `const ID = extractKey(req)`. Deleting a **draft** (`IsActiveEntity=false`) is a discard and must always be allowed. Only guard active deletes.
- **NEW (create draft):** `before('NEW', SalesOrders.drafts)` → require `customerID`; look it up in Northwind (reject 400 if not found) and set `customerName` so the editor can show it. Don't generate `orderNo` here.

### 1.3 Draft item conveniences (needed by the editor UI)
Draft rows need a product name and price to display.
- `before('NEW', SalesOrderItems.drafts)` and `before('PATCH', SalesOrderItems.drafts)` (when `productID` changes): fetch the product (`getProducts`, uncached, same as create), reject 400 if not found, set `productName`, `unitPrice`. Default `discount` to 0.
- After item `NEW`/`PATCH`/`DELETE` on drafts, recompute line `netAmount` and the draft header `netAmount/taxAmount/grossAmount` with the existing `calculateItemNetAmount`/`calculateOrderTotals`. That way the editor shows live totals.
- **Don't** enforce qty/discount bounds in draft handlers. Drafts may be incomplete; bounds are enforced at activation (1.1).

> 1.3 is the riskiest part. If draft-entity event names differ from the above in this CAP version, check `node_modules/@sap/cds/libx/_runtime/fiori/lean-draft.js` for the real event/target names instead of guessing.

### 1.4 Authorization
Keep `@restrict` as is if A5 holds. If not, add explicit grants for draft events to SalesRep only. Bob and Carol must never be able to create or edit drafts.

### 1.5 Optional config
`package.json` → `cds.fiori.draft_deletion_timeout` is already on by default (abandoned drafts get cleaned up). Leave it.

### 1.6 Tests — `backend/test/order-service.test.js`
1. Add helpers at the top and use them everywhere instead of string-building URLs:
   ```js
   const orderUrl = (id, active = true) => `${SVC}/SalesOrders(ID=${id},IsActiveEntity=${active})`;
   async function createActiveOrder(payload, user = ALICE) {
     const { data: draft } = await POST(`${SVC}/SalesOrders`, payload, user);
     const { data } = await POST(`${orderUrl(draft.ID, false)}/OrderService.draftActivate`, {}, user);
     return data; // active order, has orderNo
   }
   ```
   Replace every existing "POST /SalesOrders then use data.ID" with `createActiveOrder`, and every `/SalesOrders(${id})` with `orderUrl(id)`. Go through the real draft flow, **not** `cds.fiori.bypass_draft`, so the tests cover activation.
2. Validation tests that expected `400` on POST now expect `400` on **activate**. The draft POST itself succeeds. Update them accordingly.
3. Re-check the "direct PATCH" tests against A8 and update the expected codes. Keep the intent: status can't be changed except through actions.
4. New `describe('Draft editing (SO-08)')`:
   - POST creates a draft: `IsActiveEntity:false`, no `orderNo`, not counted in `AnalyticsService.getKPIs().orderCount`.
   - Activating a valid draft → `orderNo` assigned, totals correct, `status: 'New'`.
   - Activating an invalid draft (qty 0 / discontinued product) → 400, and the draft still exists.
   - Adding a draft item fills `productName`/`unitPrice`, and the draft header totals update (1.3).
   - `draftEdit` on a New order → PATCH an item's quantity → activate → totals recomputed, `orderNo` unchanged.
   - `draftEdit` on a Submitted order → 409.
   - `submit` on the draft key → 409; on the active key → works.
   - Discard (DELETE draft) leaves the active order unchanged.
   - Bob: POST `/SalesOrders` → 403; `draftEdit` → 403.
   - Deleting an active New order still works; deleting an active Submitted order is still 409 (regression for the DELETE guard fix).
5. `test/analytics-service.test.js`: add one test that a draft does not affect KPIs (or fold it into 4).

**Gate 1:** `npm test` all green (previous 122 + new), `npx eslint .` clean.

---

## Phase 2 — Frontend: keep the existing app working on the new keys

No new feature yet. The app should behave exactly like before.

Files: `frontend/orderhub/`

- `controller/SalesOrder.controller.js` `_onPatternMatched`: bind `"/SalesOrders(ID=" + sOrderID + ",IsActiveEntity=true)"`.
- Navigation into an order (`SalesOrders.controller.js` `onOrderSelect`, `Dashboard.controller.js` `onOrderPress`, `CreateOrder.controller.js` after save): they pass `ID`. Keep the route param as the plain ID, since the object page adds `IsActiveEntity=true` itself.
- List bindings on `/SalesOrders` (`SalesOrders.view.xml`, `Dashboard.view.xml` recent orders): add `$filter: 'IsActiveEntity eq true'` **only if A4 showed drafts leaking in**. Phase 3 changes the Sales Orders list deliberately.
- The invoice download URL (`SalesOrder.controller.js` `onViewInvoice`) uses `/Invoices(<id>)/content`. Invoices are not draft-enabled, so no change, but verify.
- Bound action calls (`bindContext("OrderService.submit(...)", oContext)`) work unchanged as long as the context is the active one.
- `CreateOrder` "Save"/"Submit" now create a draft, so add `draftActivate` before navigating. This is temporary; Phase 3 replaces this screen's save logic:
  ```js
  oContext.created()
    .then(() => oModel.bindContext("OrderService.draftActivate(...)", oContext).execute())
    .then(oActive => /* navTo salesOrder with oActive.getProperty("ID") */)
  ```
  For Submit: activate, then `submit` on the returned **active** context.

**Gate 2:** run the Playwright screenshot script (see "Verification" below). Dashboard, Products, Customers map, Sales Orders list, an order detail, create + submit an order all work, with no console errors besides the known `Component-preload` 404.

---

## Phase 3 — Frontend: the draft editor

One editor screen for both "new order" and "edit order", bound to the **draft** so every change is saved to the server as you type. That's the point of drafts.

### Routing (`manifest.json`)
- Add route `orderDraft`, pattern `orders/{orderID}/draft`, target a new view `OrderDraft`.
- Keep `createOrder` (`orders/create/{customerID}`) as an entry point that **creates a draft and immediately navigates** to `orderDraft` (`navTo(..., true)` to replace history). It no longer holds its own form.

### `view/OrderDraft.view.xml` + `controller/OrderDraft.controller.js` (new)
Build it from the current `CreateOrder.view.xml` layout (same ObjectHeader, card panel, items table, footer, CSS classes) but bound to OData instead of the `orderModel` JSON model:
- Element binding: `/SalesOrders(ID={orderID},IsActiveEntity=false)` with `$expand: 'items'`.
- Header: `customerName`, live `grossAmount` (from 1.3), and a "Draft" `ObjectStatus`.
- Items table bound to `items`; `quantity` / `discount` as `Input`s bound two-way. The v4 model PATCHes the draft automatically (`groupId: $auto` already set in the manifest).
- **Add product:** reuse `fragments/ProductSelectDialog.fragment.xml`; on confirm, `this.byId("itemsTable").getBinding("items").create({ productID, quantity: 1, discount: 0 })`.
- **Remove:** `oItemContext.delete()`.
- **Stock warning:** `unitsInStock` isn't stored on items. On load, fetch `/Products` for the draft's product IDs once into a JSON model keyed by ID, then reuse `formatter.stockWarningVisible`. Don't add a column to the schema for this.
- Footer: **Discard** (`oDraftContext.delete()` → back to the active order if one exists, otherwise the list), **Save** (`draftActivate` → `navTo('salesOrder', {orderID})`), **Save & Submit** (activate, then `submit` on the active context). Run the existing client checks (`_validateOrder` logic from `CreateOrder.controller.js`) before activating. On a 400 from activate, show the server message and **stay** in the draft.

### `controller/CreateOrder.controller.js`
- `_onPatternMatched`: POST a draft via `bindList("/SalesOrders").create({ customerID, currency_code: "USD", items: [...] })`. Seed `items` from the AI stash (`oComponent._aiDraftItems`, mapped to `{productID, quantity, discount}`) when present; the server fills names and prices (1.3). After `created()`, `navTo("orderDraft", { orderID }, true)`.
- Remove the old JSON-model save/submit code and the unused bits of `CreateOrder.view.xml` (the view can become a simple busy placeholder). Don't leave two editors.

### Object page (`SalesOrder.view.xml` / controller)
- Add an **Edit** button: visible for SalesRep when `status === 'New'` and `HasDraftEntity === false`. It calls `OrderService.draftEdit(...)` on the active context with `PreserveChanges: true`, then navigates to `orderDraft`.
- Add a **Continue draft** button: visible for SalesRep when `HasDraftEntity === true`. It navigates to `orderDraft` directly.
- Wire both into `_updateButtonVisibility`. Add `HasDraftEntity` to the binding's `$select` if `autoExpandSelect` doesn't pick it up.

### Sales Orders list
- Show the user's own drafts too: list filter `IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null` (the standard "actives without a draft, plus my drafts" filter). Add an `ObjectStatus` "Draft" when `IsActiveEntity` is false. Pressing a draft row goes to `orderDraft`; an active row goes to `salesOrder`.
- New drafts have no `orderNo`. Show "Draft" in that column instead of blank.

### i18n (`i18n/i18n.properties`)
Add: `editOrder`, `continueDraft`, `discardDraft`, `saveDraftActivate` ("Save"), `saveAndSubmit`, `draftStatus` ("Draft"), `confirmDiscard`, `draftDiscarded`, `draftSaved`, `draftLocked` (for the 409/423 when another user holds the draft).

**Gate 3:** Playwright run as alice:
1. Customer → New order → add 2 products → change a quantity → **reload the page** → the draft still has both items and the changed quantity.
2. Save → order gets an `SO-YYYY-NNNNN` number and correct totals.
3. Edit → change quantity → Discard → the order is unchanged.
4. Edit → change quantity → Save → totals updated, same order number.
5. Submit → Edit button is gone.
6. AI assistant → Create draft order → lands in the draft editor with the matched items.
7. Phone width (390px): editor usable, no horizontal scroll.

Also check as bob that Edit / Continue draft never appear.

---

## Phase 4 — Docs

- `README.md`: SO-08 row → ✅ with a one-line note; remove SO-08 from "Known Limitations"; update the "Phase 2" roadmap line that says draft is pending; update the test count.
- `DECISIONS.md`: new **ADR 27: Draft editing (SO-08)**. Cover why service-level `@odata.draft.enabled` on top of the hand-built state machine, why validation runs at activation and not on draft edits, the shared `validateAndPrice`, the guards (EDIT only while New, actions only on actives, the DELETE key fix), why the editor is OData-bound rather than JSON-model, and the A1–A8 results that changed anything.
- Delete this plan file when done, or move it into the ADR.

---

## Verification tooling already in this environment

- Backend: `cd backend && npm test`, `npx eslint .`
- Run: `cd backend && npm run watch` (port 4004), `cd frontend && npm start` (port 8080). Mocked users alice/bob/carol, password = username.
- Real-browser checks: Playwright's Chromium is at `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, driver at `/usr/lib/code/node_modules/playwright-core`. Use `browser.newContext({ httpCredentials: { username: 'alice', password: 'alice' } })`. **Curl passing is not enough**: past CORS bugs only showed up in a real browser.
- Known harmless console error: `Component-preload.js` 404 (UI5 dev mode).

## Out of scope / don't touch

- `AnalyticsService`, `order-number.js`, geocoding, invoice storage, mailer, AI matching logic.
- Don't make `Invoices` draft-enabled.
- Don't enable `cds.fiori.bypass_draft` just to make old tests pass. Update the tests instead.
- Don't change the status state machine (`VALID_TRANSITIONS`).

## Commits (suggested)
1. `feat(backend): draft-enable SalesOrders with validation at activation (SO-08)` (Phase 1, incl. tests)
2. `fix(frontend): address orders by draft-aware keys` (Phase 2)
3. `feat(frontend): draft editor for creating and editing orders (SO-08)` (Phase 3)
4. `docs: SO-08 checklist and ADR 27` (Phase 4)
