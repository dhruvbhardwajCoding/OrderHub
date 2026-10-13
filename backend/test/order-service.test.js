'use strict';

// 'dummy' auth always sets req.user to the privileged built-in user (all
// roles, no credential check) — it would make every role-restriction test
// a no-op. 'mocked' actually verifies username/password against `users`
// below and attaches the matching roles, which is what the role-based
// (SalesRep / SalesManager / BillingClerk) tests rely on.
process.env.CDS_REQUIRES_AUTH_KIND = 'mocked';

const cds = require('@sap/cds');

/* ─── helpers ──────────────────────────────────────────────────── */
const { calculateItemNetAmount, calculateOrderTotals } = require('../srv/lib/calculations');
const { APPROVAL_THRESHOLD } = require('../srv/lib/constants');

// Mock the Northwind helper functions so tests do not depend entirely on the live service
const MOCK_CUSTOMERS = [
  { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste' },
];
const MOCK_PRODUCTS = [
  { ProductID: 1, ProductName: 'Chai', UnitPrice: 18.00, UnitsInStock: 39, Discontinued: false },
  { ProductID: 14, ProductName: 'Tofu', UnitPrice: 23.25, UnitsInStock: 35, Discontinued: false },
  { ProductID: 5, ProductName: 'Chef Anton Cajun Seasoning', UnitPrice: 22.00, UnitsInStock: 53, Discontinued: true }
];

jest.mock('../srv/lib/northwind', () => ({
  getCustomer: jest.fn(async (srv, id) => {
    if (id === 'ALFKI') return { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste' };
    return null;
  }),
  getAllCustomers: jest.fn(async () => MOCK_CUSTOMERS),
  getProducts: jest.fn(async (srv, ids) => MOCK_PRODUCTS.filter(p => ids.includes(p.ProductID))),
  getAllProducts: jest.fn(async () => MOCK_PRODUCTS),
  withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../srv/lib/ai', () => ({
  isConfigured: jest.fn(() => false),
  extractOrderFromText: jest.fn(),
}));
const mockAi = require('../srv/lib/ai');

jest.mock('../srv/lib/pdf', () => ({
  generateInvoicePdf: jest.fn(async () => Buffer.from('mock pdf content'))
}));

jest.mock('../srv/lib/mailer', () => ({
  sendInvoiceEmail: jest.fn(async () => ({ messageId: 'mock-123' }))
}));

const ALICE = { auth: { username: 'alice', password: 'alice' } };   // SalesRep
const BOB   = { auth: { username: 'bob',   password: 'bob'   } };   // SalesManager
const CAROL = { auth: { username: 'carol', password: 'carol' } };   // BillingClerk

const SVC = '/odata/v4/order';

/* ─── bootstrap CDS test server ─────────────────────────────── */
cds.env.requires.auth = {
  kind: 'mocked',
  users: {
    alice: { password: 'alice', roles: ['SalesRep'] },
    bob:   { password: 'bob',   roles: ['SalesManager'] },
    carol: { password: 'carol', roles: ['BillingClerk'] }
  }
};
const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

/* ─── SO-08 draft helpers ──────────────────────────────────────
 * With @odata.draft.enabled, SalesOrders' key is (ID, IsActiveEntity),
 * not just ID, and POST /SalesOrders now creates a DRAFT rather than
 * immediately validating/pricing/numbering the order — that happens at
 * activation (OrderService.draftActivate). Every test that needs a real,
 * usable order (an orderNo, computed totals) goes through
 * createActiveOrder() rather than hand-building the old one-shot POST.
 */
const orderUrl = (id, active = true) => `${SVC}/SalesOrders(ID=${id},IsActiveEntity=${active})`;

async function createActiveOrder(payload, user = ALICE) {
  const { data: draft } = await POST(`${SVC}/SalesOrders`, payload, user);
  const { data } = await POST(`${orderUrl(draft.ID, false)}/OrderService.draftActivate`, {}, user);
  return data; // the active order: orderNo assigned, totals computed
}

/* ═══════════════════════════════════════════════════════════════
 *  1. NORTHWIND READ OPERATIONS
 * ═══════════════════════════════════════════════════════════════ */

describe('Northwind master-data reads', () => {

  test('GET /Customers returns customer list', async () => {
    const { status, data } = await GET(`${SVC}/Customers`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value[0]).toHaveProperty('CustomerID');
  });

  test('GET /Products returns product list', async () => {
    const { status, data } = await GET(`${SVC}/Products`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value[0]).toHaveProperty('ProductID');
  });

  test('GET /Categories returns categories', async () => {
    const { status, data } = await GET(`${SVC}/Categories`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
  });

  test('GET /Suppliers returns suppliers', async () => {
    const { status, data } = await GET(`${SVC}/Suppliers`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
  });

  test('GET /Shippers returns shippers', async () => {
    const { status, data } = await GET(`${SVC}/Shippers`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
  });

  // Regression: @sap/cds 8.9's default odata_new_parser feature silently
  // drops $filter/$search (but not $orderby/$top/$skip/$count) from the CQN
  // query handed to a custom READ handler on an @cds.persistence.skip
  // entity. These entities bypass CQN for collection reads specifically to
  // route around that gap (see order-service.js's delegateToNorthwind) —
  // without these tests, that regressed silently (every filter on these 5
  // entities was a no-op that returned the full, unfiltered list).
  test('$filter on Products (MD-03) actually filters, not just returns 200', async () => {
    const { status, data } = await GET(`${SVC}/Products?$filter=CategoryID eq 1`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value.every((p) => p.CategoryID === 1)).toBe(true);
  });

  test('different $filter values on Products yield different, correctly-scoped results', async () => {
    const { data: cat1 } = await GET(`${SVC}/Products?$filter=CategoryID eq 1`, ALICE);
    const { data: cat2 } = await GET(`${SVC}/Products?$filter=CategoryID eq 2`, ALICE);

    expect(cat1.value.every((p) => p.CategoryID === 1)).toBe(true);
    expect(cat2.value.every((p) => p.CategoryID === 2)).toBe(true);
    expect(cat1.value.map((p) => p.ProductID).sort()).not.toEqual(cat2.value.map((p) => p.ProductID).sort());
  });

  test('$filter on Customers by Country actually filters', async () => {
    const { status, data } = await GET(`${SVC}/Customers?$filter=Country eq 'Germany'`, ALICE);
    expect(status).toBe(200);
    expect(data.value.length).toBeGreaterThan(0);
    expect(data.value.every((c) => c.Country === 'Germany')).toBe(true);
  });

  test('GET /Customers(key) still works for a single-entity lookup', async () => {
    const { status, data } = await GET(`${SVC}/Customers('ALFKI')`, ALICE);
    expect(status).toBe(200);
    expect(data.CustomerID).toBe('ALFKI');
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  2. SALES ORDER CREATION
 * ═══════════════════════════════════════════════════════════════ */

describe('Sales order creation', () => {

  const validOrder = () => ({
    customerID: 'ALFKI',
    currency_code: 'USD',
    items: [
      { productID: 1,  quantity: 20, discount: 10 },
      { productID: 14, quantity: 5,  discount: 0  },
    ],
  });

  test('activating a draft creates a valid order with correct calculations', async () => {
    const data = await createActiveOrder(validOrder());

    expect(data.IsActiveEntity).toBe(true);
    expect(data.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
    expect(data.customerID).toBe('ALFKI');
    expect(data.customerName).toBe('Alfreds Futterkiste');
    expect(data.status).toBe('New');
    expect(data.currency_code).toBe('USD');

    // Verify calculated amounts
    // Item 1: 18.00 * 20 * (1 - 10/100) = 324.00
    // Item 2: 23.25 *  5 * (1 -  0/100) = 116.25
    // Net = 440.25, Tax = 44.03 (10%), Gross = 484.28
    expect(Number(data.netAmount)).toBeCloseTo(440.25, 2);
    expect(Number(data.taxAmount)).toBeCloseTo(44.03, 2);
    expect(Number(data.grossAmount)).toBeCloseTo(484.28, 2);
  });

  test('POST (draft creation) does not assign an order number or price the order', async () => {
    const { status, data } = await POST(`${SVC}/SalesOrders`, validOrder(), ALICE);
    expect(status).toBe(201);
    expect(data.IsActiveEntity).toBe(false);
    expect(data.orderNo).toBeNull();
    expect(data.netAmount).toBeNull();
  });

  test('activation generates sequential order numbers', async () => {
    const r1 = await createActiveOrder(validOrder());
    const r2 = await createActiveOrder(validOrder());
    expect(r1.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
    expect(r2.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);

    // Second order number should be greater
    expect(r2.orderNo > r1.orderNo).toBe(true);
  });

  test('activation snapshots product name and unit price', async () => {
    const data = await createActiveOrder(validOrder());
    const items = (await GET(`${orderUrl(data.ID)}/items`, ALICE)).data.value;

    const chai = items.find((i) => i.productID === 1);
    expect(chai.productName).toBe('Chai');
    expect(Number(chai.unitPrice)).toBe(18);

    const tofu = items.find((i) => i.productID === 14);
    expect(tofu.productName).toBe('Tofu');
    expect(Number(tofu.unitPrice)).toBe(23.25);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  3. VALIDATION
 * ═══════════════════════════════════════════════════════════════ */

// SO-08: most of this validation no longer fails on POST (that only creates
// a draft) — it fails when the draft is activated, which is where
// validateAndPrice() (item/quantity/discount/discontinued checks) now runs.
// The one exception is the customer check, which the draft's own before('NEW')
// handler already runs immediately at POST time (see "Draft editing" below)
// so the editor can show a customer name right away — a bad customerID never
// even gets a draft created for it.
describe('Server-side validation (at draft activation)', () => {

  async function draftActivateShouldFail(payload) {
    const { data: draft } = await POST(`${SVC}/SalesOrders`, payload, ALICE);
    const res = await POST(`${orderUrl(draft.ID, false)}/OrderService.draftActivate`, {}, ALICE).catch((e) => e);
    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  }

  test('Rejects order for non-existent customer (fails immediately at POST, not activation)', async () => {
    const err = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ZZZZZ',
      items: [{ productID: 1, quantity: 1 }],
    }, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects order for non-existent product', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [{ productID: 99999, quantity: 1 }],
  }));

  test('Rejects order with discontinued product', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [{ productID: 5, quantity: 1 }],
  }));

  test('Rejects quantity below minimum (0)', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [{ productID: 1, quantity: 0 }],
  }));

  test('Rejects quantity above maximum (1000)', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [{ productID: 1, quantity: 1000 }],
  }));

  test('Rejects discount above maximum (26%)', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [{ productID: 1, quantity: 1, discount: 26 }],
  }));

  test('Rejects negative discount', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [{ productID: 1, quantity: 1, discount: -1 }],
  }));

  test('Rejects order with no items', () => draftActivateShouldFail({
    customerID: 'ALFKI',
    items: [],
  }));
});

/* ═══════════════════════════════════════════════════════════════
 *  4. CALCULATIONS (unit-level)
 * ═══════════════════════════════════════════════════════════════ */

describe('Calculation helpers', () => {

  test('Item net amount: 18 × 20 − 10% = 324', () => {
    expect(calculateItemNetAmount(18, 20, 10)).toBeCloseTo(324, 2);
  });

  test('Item net amount: 23.25 × 5 − 0% = 116.25', () => {
    expect(calculateItemNetAmount(23.25, 5, 0)).toBeCloseTo(116.25, 2);
  });

  test('Order totals with 10% tax', () => {
    const items = [
      { netAmount: 324.00 },
      { netAmount: 116.25 },
    ];
    const totals = calculateOrderTotals(items, 0.10);
    expect(totals.netAmount).toBeCloseTo(440.25, 2);
    expect(totals.taxAmount).toBeCloseTo(44.03, 2);
    expect(totals.grossAmount).toBeCloseTo(484.28, 2);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  5. STATUS TRANSITIONS & BOUND ACTIONS
 * ═══════════════════════════════════════════════════════════════ */

describe('Status lifecycle — submit / approve / cancel', () => {

  let orderID;

  beforeEach(async () => {
    // Create a fresh order for each test with grossAmount > 5000 so it doesn't auto-approve
    const data = await createActiveOrder({
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    });
    orderID = data.ID;
  });

  test('submit transitions New → Submitted', async () => {
    const { status, data } = await POST(
      `${orderUrl(orderID)}/OrderService.submit`, {}, ALICE
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Submitted');
  });

  test('approve transitions Submitted → Approved', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    const { status, data } = await POST(
      `${orderUrl(orderID)}/OrderService.approve`, {}, BOB
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Approved');
  });

  test('cancel transitions New → Cancelled', async () => {
    const { status, data } = await POST(
      `${orderUrl(orderID)}/OrderService.cancel`, {}, ALICE
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Cancelled');
  });

  test('cancel transitions Submitted → Cancelled', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    const { status, data } = await POST(
      `${orderUrl(orderID)}/OrderService.cancel`, {}, BOB
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Cancelled');
  });

  /* ── invalid transitions ─────────────────────────────────── */

  test('cannot submit an already-submitted order', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    const err = await POST(
      `${orderUrl(orderID)}/OrderService.submit`, {}, ALICE
    ).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('cannot approve a New order (must be Submitted first)', async () => {
    const err = await POST(
      `${orderUrl(orderID)}/OrderService.approve`, {}, BOB
    ).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('cannot cancel an Approved order', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    await POST(`${orderUrl(orderID)}/OrderService.approve`, {}, BOB);
    const err = await POST(
      `${orderUrl(orderID)}/OrderService.cancel`, {}, ALICE
    ).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  5b. ORDER DELETION (SO-01)
 * ═══════════════════════════════════════════════════════════════ */

describe('Order deletion (SO-01)', () => {

  let orderID;

  beforeEach(async () => {
    // quantity 300 → grossAmount > APPROVAL_THRESHOLD, so submit() leaves it
    // 'Submitted' rather than auto-approving (matches the lifecycle tests above).
    const data = await createActiveOrder({
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    });
    orderID = data.ID;
  });

  test('SalesRep can delete a New order', async () => {
    const { status } = await DELETE(orderUrl(orderID), ALICE);
    expect(status).toBe(204);

    const err = await GET(orderUrl(orderID), ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBe(404);
  });

  test('cannot delete a Submitted order', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    const err = await DELETE(orderUrl(orderID), ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBe(409);
  });

  test('cannot delete an Approved order', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    await POST(`${orderUrl(orderID)}/OrderService.approve`, {}, BOB);
    const err = await DELETE(orderUrl(orderID), ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBe(409);
  });

  test('SalesManager cannot delete an order (not granted)', async () => {
    const err = await DELETE(orderUrl(orderID), BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBe(403);
  });

  test('BillingClerk cannot delete an order (not granted)', async () => {
    const err = await DELETE(orderUrl(orderID), CAROL).catch((e) => e);
    expect(err.response?.status || err.status).toBe(403);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  5c. DRAFT EDITING (SO-08)
 * ═══════════════════════════════════════════════════════════════ */

describe('Draft editing (SO-08)', () => {

  test('POST creates a draft, not an order — no order number, not active', async () => {
    const { status, data } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 5 }],
    }, ALICE);
    expect(status).toBe(201);
    expect(data.IsActiveEntity).toBe(false);
    expect(data.orderNo).toBeNull();
  });

  test('starting a draft validates and snapshots the customer immediately', async () => {
    const bad = await POST(`${SVC}/SalesOrders`, { customerID: 'ZZZZZ' }, ALICE).catch((e) => e);
    expect(bad.response?.status || bad.status).toBe(400);

    const { data: good } = await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI' }, ALICE);
    expect(good.customerName).toBe('Alfreds Futterkiste');
  });

  // "Activating a valid draft assigns an order number, computes totals, and
  // sets status: 'New'" is exactly what createActiveOrder() does and is
  // already covered by the "Sales order creation" describe block above —
  // not repeated here.

  test('activating an invalid draft rejects with 400 and leaves the draft intact', async () => {
    const { data: draft } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 0 }], // qty 0 is invalid
    }, ALICE);

    const err = await POST(`${orderUrl(draft.ID, false)}/OrderService.draftActivate`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBe(400);

    const { data: stillDraft } = await GET(orderUrl(draft.ID, false), ALICE);
    expect(stillDraft.IsActiveEntity).toBe(false);
  });

  test('adding a draft item fills in product name/price and updates the draft header totals', async () => {
    const { data: draft } = await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI' }, ALICE);

    const { data: item } = await POST(`${orderUrl(draft.ID, false)}/items`, { productID: 1, quantity: 5 }, ALICE);
    expect(item.productName).toBe('Chai');
    expect(Number(item.unitPrice)).toBe(18);
    expect(Number(item.netAmount)).toBeCloseTo(90, 2);

    const { data: header } = await GET(orderUrl(draft.ID, false), ALICE);
    expect(Number(header.netAmount)).toBeCloseTo(90, 2);
  });

  test('editing a New order: draftEdit → patch an item → activate recomputes totals, keeps the order number', async () => {
    const original = await createActiveOrder({
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 5 }],
    });
    expect(Number(original.netAmount)).toBeCloseTo(90, 2);

    await POST(`${orderUrl(original.ID)}/OrderService.draftEdit`, { PreserveChanges: true }, ALICE);
    const { data: items } = await GET(`${orderUrl(original.ID, false)}/items`, ALICE);
    await PATCH(`${SVC}/SalesOrderItems(ID=${items.value[0].ID},IsActiveEntity=false)`, { quantity: 10 }, ALICE);

    const { data: activated } = await POST(`${orderUrl(original.ID, false)}/OrderService.draftActivate`, {}, ALICE);
    expect(activated.orderNo).toBe(original.orderNo); // unchanged
    expect(Number(activated.netAmount)).toBeCloseTo(180, 2); // 18 * 10
  });

  test('draftEdit on a Submitted order is rejected', async () => {
    const order = await createActiveOrder({
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 300 }], // above threshold, stays Submitted
    });
    await POST(`${orderUrl(order.ID)}/OrderService.submit`, {}, ALICE);

    const err = await POST(`${orderUrl(order.ID)}/OrderService.draftEdit`, { PreserveChanges: true }, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBe(409);
  });

  test('submit on a draft key is rejected — must activate first', async () => {
    const { data: draft } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 1 }],
    }, ALICE);

    const err = await POST(`${orderUrl(draft.ID, false)}/OrderService.submit`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBe(409);
  });

  test('discarding a draft edit leaves the active order unchanged', async () => {
    const order = await createActiveOrder({
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 5 }],
    });
    await POST(`${orderUrl(order.ID)}/OrderService.draftEdit`, { PreserveChanges: true }, ALICE);
    const { data: items } = await GET(`${orderUrl(order.ID, false)}/items`, ALICE);
    await PATCH(`${SVC}/SalesOrderItems(ID=${items.value[0].ID},IsActiveEntity=false)`, { quantity: 99 }, ALICE);

    await DELETE(orderUrl(order.ID, false), ALICE); // discard the edit, not the order

    const { data: stillActive } = await GET(orderUrl(order.ID), ALICE);
    expect(Number(stillActive.netAmount)).toBeCloseTo(Number(order.netAmount), 2); // unchanged
  });

  test('deleting an active New order still works (SO-01 regression)', async () => {
    const order = await createActiveOrder({ customerID: 'ALFKI', items: [{ productID: 1, quantity: 1 }] });
    const { status } = await DELETE(orderUrl(order.ID), ALICE);
    expect(status).toBe(204);
  });

  test('SalesManager cannot start a new order', async () => {
    const err = await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI' }, BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBe(403);
  });

  test('BillingClerk cannot start a new order', async () => {
    const err = await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI' }, CAROL).catch((e) => e);
    expect(err.response?.status || err.status).toBe(403);
  });

  test('SalesManager cannot edit an existing order', async () => {
    const order = await createActiveOrder({
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 1 }],
    });
    const err = await POST(`${orderUrl(order.ID)}/OrderService.draftEdit`, { PreserveChanges: true }, BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBe(403);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  6. APPROVAL THRESHOLD
 * ═══════════════════════════════════════════════════════════════ */

describe('Approval threshold auto-approve', () => {

  test(`Order <= ${APPROVAL_THRESHOLD} auto-approved on submit`, async () => {
    // 18 * 2 = 36, gross ~ 39.60 (well under threshold)
    const data = await createActiveOrder({
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 2, discount: 0 }]
    });
    const { data: submitted } = await POST(
      `${orderUrl(data.ID)}/OrderService.submit`, {}, ALICE
    );
    expect(submitted.status).toBe('Approved'); // auto-approved
  });

  test(`Orders above ${APPROVAL_THRESHOLD} stays Submitted on submit`, async () => {
    // 18.00 * 300 = 5400 (above threshold)
    const data = await createActiveOrder({
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    });
    expect(Number(data.grossAmount)).toBeGreaterThan(APPROVAL_THRESHOLD);

    const submitted = await POST(
      `${orderUrl(data.ID)}/OrderService.submit`, {}, ALICE
    );
    expect(submitted.data.status).toBe('Submitted'); // needs manager
  });
});


/* ═══════════════════════════════════════════════════════════════
 *  8. ADDITIONAL INVALID TRANSITIONS & DIRECT PATCH REJECTIONS
 * ═══════════════════════════════════════════════════════════════ */

describe('Additional invalid transitions & direct PATCH', () => {
  let orderID;

  beforeEach(async () => {
    const data = await createActiveOrder({
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    });
    orderID = data.ID;
  });

  test('Approved → approve() rejected', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    await POST(`${orderUrl(orderID)}/OrderService.approve`, {}, BOB);
    const err = await POST(`${orderUrl(orderID)}/OrderService.approve`, {}, BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('Approved → submit() rejected', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
    await POST(`${orderUrl(orderID)}/OrderService.approve`, {}, BOB);
    const err = await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('Cancelled transitions rejected', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.cancel`, {}, ALICE);
    let err = await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);

    err = await POST(`${orderUrl(orderID)}/OrderService.approve`, {}, BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);

    err = await POST(`${orderUrl(orderID)}/OrderService.cancel`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  // SO-08: direct PATCH of an active order is now rejected outright by CAP's
  // draft machinery itself (draft-enabled actives are read-only unless
  // cds.fiori.bypass_draft is set, which this project deliberately doesn't
  // set — edits go through a draft, see "Draft editing (SO-08)" below), so
  // this is now a stronger guarantee than the old @readonly-only check.
  test('PATCH status directly is rejected', async () => {
    const err = await PATCH(orderUrl(orderID), { status: 'Approved' }, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);

    const { data } = await GET(orderUrl(orderID), ALICE);
    expect(data.status).toBe('New');
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  9. ODATA QUERY SUPPORT
 * ═══════════════════════════════════════════════════════════════ */

describe('OData query support', () => {
  beforeAll(async () => {
    // Active orders only — a plain GET/$filter/$orderby/$count already
    // excludes drafts by default (verified live), so these go through
    // activation to land in the set these queries are checking.
    await createActiveOrder({ customerID: 'ALFKI', items: [{ productID: 1, quantity: 1 }] });
    await createActiveOrder({ customerID: 'ALFKI', items: [{ productID: 14, quantity: 2 }] });
    await createActiveOrder({ customerID: 'ALFKI', items: [{ productID: 1, quantity: 3 }] });
  });

  test('$top and $skip pagination', async () => {
    const { data: top2 } = await GET(`${SVC}/SalesOrders?$top=2`, ALICE);
    expect(top2.value.length).toBe(2);

    const { data: skip1 } = await GET(`${SVC}/SalesOrders?$top=2&$skip=1`, ALICE);
    expect(skip1.value.length).toBe(2);
  });

  test('$filter on status', async () => {
    const { data } = await GET(`${SVC}/SalesOrders?$filter=status eq 'New'`, ALICE);
    expect(data.value.length).toBeGreaterThanOrEqual(3);
  });

  test('$orderby on createdAt', async () => {
    const { data } = await GET(`${SVC}/SalesOrders?$orderby=createdAt desc`, ALICE);
    expect(data.value.length).toBeGreaterThanOrEqual(3);
    const d1 = new Date(data.value[0].createdAt);
    const d2 = new Date(data.value[1].createdAt);
    expect(d1.getTime()).toBeGreaterThanOrEqual(d2.getTime());
  });

  test('$count returns total', async () => {
    const { data } = await GET(`${SVC}/SalesOrders?$count=true`, ALICE);
    expect(data['@odata.count']).toBeGreaterThanOrEqual(3);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  8. ORDER NUMBER FORMAT
 * ═══════════════════════════════════════════════════════════════ */

describe('Order number generation', () => {

  test('Order number matches SO-YYYY-NNNNN pattern', async () => {
    const data = await createActiveOrder({
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 1 }],
    });
    expect(data.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  10. BILLING CLERK PHASE 3 - INVOICES
 * ═══════════════════════════════════════════════════════════════ */

describe('Billing Clerk - Invoice operations', () => {

  let orderID;

  beforeEach(async () => {
    // Create, Submit, Approve an order
    const data = await createActiveOrder({
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 1, discount: 0 }]
    });
    orderID = data.ID;

    // ALFKI + 1 item = small amount, so it auto-approves.
    await POST(`${orderUrl(orderID)}/OrderService.submit`, {}, ALICE);
  });

  test('BillingClerk can create invoice for Approved order', async () => {
    const { status, data } = await POST(`${orderUrl(orderID)}/OrderService.createInvoice`, {}, CAROL);
    expect(status).toBe(200);
    expect(data.invoiceNo).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(data.mailStatus).toBe('PENDING');

    // Order status should be Invoiced
    const { data: order } = await GET(orderUrl(orderID), ALICE);
    expect(order.status).toBe('Invoiced');
  });

  test('BillingClerk can send invoice email (fails gracefully for mock customer)', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.createInvoice`, {}, CAROL);

    // getCustomer returns { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste' }
    // No email is present, so it should fail gracefully
    const err = await POST(`${orderUrl(orderID)}/OrderService.sendInvoice`, {}, CAROL).catch(e => e);

    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    expect(msg).toMatch(/Customer has no usable email/);

    // Check if mailStatus was updated to FAILED
    const { data: invoice } = await GET(`${SVC}/Invoices?$filter=order_ID eq '${orderID}'`, CAROL);
    expect(invoice.value[0].mailStatus).toBe('FAILED');
  });

  test('BillingClerk can send invoice using an overridden recipient email', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.createInvoice`, {}, CAROL);

    // ALFKI has no Email in Northwind; the UI pre-fills <customerID>@example.test
    // and the clerk can edit/confirm it — passed through as the `email` param.
    const { status, data } = await POST(
      `${orderUrl(orderID)}/OrderService.sendInvoice`,
      { email: 'ALFKI@example.test' },
      CAROL
    );

    expect(status).toBe(200);
    expect(data.mailStatus).toBe('SENT');
    expect(data.sentTo).toBe('ALFKI@example.test');
  });

  test('sendInvoice rejects a malformed overridden email', async () => {
    await POST(`${orderUrl(orderID)}/OrderService.createInvoice`, {}, CAROL);

    const err = await POST(
      `${orderUrl(orderID)}/OrderService.sendInvoice`,
      { email: 'not-an-email' },
      CAROL
    ).catch(e => e);

    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    expect(msg).toMatch(/not a valid email/);
  });

  test('SalesRep cannot create or send invoices', async () => {
    let err = await POST(`${orderUrl(orderID)}/OrderService.createInvoice`, {}, ALICE).catch(e => e);
    expect(err.response?.status || err.status).toBe(403);

    err = await POST(`${orderUrl(orderID)}/OrderService.sendInvoice`, {}, ALICE).catch(e => e);
    expect(err.response?.status || err.status).toBe(403);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  11. AI ASSISTANT — proposeOrderFromText (AI-01, AI-02)
 * ═══════════════════════════════════════════════════════════════ */

describe('AI assistant — proposeOrderFromText', () => {
  afterEach(() => {
    mockAi.isConfigured.mockReset().mockReturnValue(false);
    mockAi.extractOrderFromText.mockReset();
  });

  test('AI-02: with no key configured, returns aiAvailable:false without calling the model', async () => {
    const { status, data } = await POST(`${SVC}/proposeOrderFromText`, { text: 'Please send 20 Chai to Alfreds' }, ALICE);
    expect(status).toBe(200);
    expect(data.aiAvailable).toBe(false);
    expect(data.items).toEqual([]);
    expect(mockAi.extractOrderFromText).not.toHaveBeenCalled();
  });

  test('matches a mentioned customer and product against live Northwind data', async () => {
    mockAi.isConfigured.mockReturnValue(true);
    mockAi.extractOrderFromText.mockResolvedValue({
      customerHint: 'Alfreds',
      items: [{ productHint: 'Chai', quantity: 20 }],
      deliveryNote: 'delivery next week',
    });

    const { status, data } = await POST(`${SVC}/proposeOrderFromText`, { text: 'Please send 20 Chai to Alfreds, delivery next week' }, ALICE);

    expect(status).toBe(200);
    expect(data.aiAvailable).toBe(true);
    expect(data.customerStatus).toBe('matched');
    expect(data.customerID).toBe('ALFKI');
    expect(data.items).toHaveLength(1);
    expect(data.items[0].matchStatus).toBe('matched');
    expect(data.items[0].productID).toBe(1);
    expect(data.items[0].quantity).toBe(20);
    expect(data.items[0].unitsInStock).toBe(39); // SO-09: carried through so the UI can warn before saving
    expect(data.deliveryNote).toBe('delivery next week');
  });

  test('flags a product that does not exist in Northwind as not_found, without inventing an ID', async () => {
    mockAi.isConfigured.mockReturnValue(true);
    mockAi.extractOrderFromText.mockResolvedValue({
      customerHint: 'Alfreds',
      items: [{ productHint: 'Unobtainium Widget', quantity: 3 }],
      deliveryNote: '',
    });

    const { data } = await POST(`${SVC}/proposeOrderFromText`, { text: 'Send 3 Unobtainium Widgets to Alfreds' }, ALICE);

    expect(data.items[0].matchStatus).toBe('not_found');
    expect(data.items[0].productID).toBeNull();
  });

  test('flags a customer mention that matches nothing in Northwind as not_found', async () => {
    mockAi.isConfigured.mockReturnValue(true);
    mockAi.extractOrderFromText.mockResolvedValue({
      customerHint: 'Totally Fictional Company Inc',
      items: [],
      deliveryNote: '',
    });

    const { data } = await POST(`${SVC}/proposeOrderFromText`, { text: 'Order for Totally Fictional Company Inc' }, ALICE);

    expect(data.customerStatus).toBe('not_found');
    expect(data.customerID).toBeNull();
  });

  test('rejects empty text with a 400', async () => {
    mockAi.isConfigured.mockReturnValue(true);
    const err = await POST(`${SVC}/proposeOrderFromText`, { text: '   ' }, ALICE).catch(e => e);
    expect(err.response?.status || err.status).toBe(400);
    expect(mockAi.extractOrderFromText).not.toHaveBeenCalled();
  });

  test('surfaces an AI extraction failure as a clear error, not a crash', async () => {
    mockAi.isConfigured.mockReturnValue(true);
    mockAi.extractOrderFromText.mockRejectedValue(
      Object.assign(new Error('The AI service is currently unavailable.'), { status: 502 })
    );

    const err = await POST(`${SVC}/proposeOrderFromText`, { text: 'Send 5 Chai to Alfreds' }, ALICE).catch(e => e);
    expect(err.response?.status || err.status).toBe(502);
  });

  test('only SalesRep can use the AI assistant', async () => {
    mockAi.isConfigured.mockReturnValue(true);
    const err = await POST(`${SVC}/proposeOrderFromText`, { text: 'Send 5 Chai to Alfreds' }, BOB).catch(e => e);
    expect(err.response?.status || err.status).toBe(403);
  });
});
