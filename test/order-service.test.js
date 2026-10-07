'use strict';

process.env.CDS_REQUIRES_AUTH_KIND = 'dummy';

const cds = require('@sap/cds');

/* ─── helpers ──────────────────────────────────────────────────── */
const { calculateItemNetAmount, calculateOrderTotals } = require('../srv/lib/calculations');
const { APPROVAL_THRESHOLD } = require('../srv/lib/constants');

// Mock the Northwind helper functions so tests do not depend entirely on the live service
jest.mock('../srv/lib/northwind', () => ({
  getCustomer: jest.fn(async (srv, id) => {
    if (id === 'ALFKI') return { CustomerID: 'ALFKI', CompanyName: 'Alfreds Futterkiste' };
    return null;
  }),
  getProducts: jest.fn(async (srv, ids) => {
    const products = [
      { ProductID: 1, ProductName: 'Chai', UnitPrice: 18.00, UnitsInStock: 39, Discontinued: false },
      { ProductID: 14, ProductName: 'Tofu', UnitPrice: 23.25, UnitsInStock: 35, Discontinued: false },
      { ProductID: 5, ProductName: 'Chef Anton Cajun Seasoning', UnitPrice: 22.00, UnitsInStock: 53, Discontinued: true }
    ];
    return products.filter(p => ids.includes(p.ProductID));
  })
}));

const ALICE = { auth: { username: 'alice', password: 'alice' } };   // SalesRep
const BOB   = { auth: { username: 'bob',   password: 'bob'   } };   // SalesManager
const CAROL = { auth: { username: 'carol', password: 'carol' } };   // BillingClerk

const SVC = '/odata/v4/order';

/* ─── bootstrap CDS test server ─────────────────────────────── */
cds.env.requires.auth = {
  kind: 'dummy',
  users: {
    alice: { password: 'alice', roles: ['SalesRep'] },
    bob:   { password: 'bob',   roles: ['SalesManager'] },
    carol: { password: 'carol', roles: ['BillingClerk'] }
  }
};
const { GET, POST, PATCH, DELETE } = cds.test(__dirname + '/..');

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

  test('POST creates a valid order with correct calculations', async () => {
    const payload = validOrder();
    const { status, data } = await POST(`${SVC}/SalesOrders`, payload, ALICE);

    expect(status).toBe(201);
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

  test('POST generates sequential order numbers', async () => {
    const r1 = await POST(`${SVC}/SalesOrders`, validOrder(), ALICE);
    const r2 = await POST(`${SVC}/SalesOrders`, validOrder(), ALICE);
    expect(r1.data.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
    expect(r2.data.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);

    // Second order number should be greater
    expect(r2.data.orderNo > r1.data.orderNo).toBe(true);
  });

  test('POST snapshots product name and unit price', async () => {
    const { data } = await POST(`${SVC}/SalesOrders`, validOrder(), ALICE);
    const items = (await GET(`${SVC}/SalesOrders(${data.ID})/items`, ALICE)).data.value;

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

describe('Server-side validation', () => {

  test('Rejects order for non-existent customer', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ZZZZZ',
      items: [{ productID: 1, quantity: 1 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects order for non-existent product', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 99999, quantity: 1 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects order with discontinued product', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 5, quantity: 1 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects quantity below minimum (0)', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 0 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects quantity above maximum (1000)', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 1000 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects discount above maximum (26%)', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 1, discount: 26 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects negative discount', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 1, discount: -1 }],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });

  test('Rejects order with no items', async () => {
    const res = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [],
    }, ALICE).catch((e) => e);

    expect(res.response?.status || res.status).toBeGreaterThanOrEqual(400);
  });
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
    const { data } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    }, ALICE);
    orderID = data.ID;
  });

  test('submit transitions New → Submitted', async () => {
    const { status, data } = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Submitted');
  });

  test('approve transitions Submitted → Approved', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE);
    const { status, data } = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Approved');
  });

  test('cancel transitions New → Cancelled', async () => {
    const { status, data } = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.cancel`, {}, ALICE
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Cancelled');
  });

  test('cancel transitions Submitted → Cancelled', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE);
    const { status, data } = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.cancel`, {}, BOB
    );
    expect(status).toBe(200);
    expect(data.status).toBe('Cancelled');
  });

  /* ── invalid transitions ─────────────────────────────────── */

  test('cannot submit an already-submitted order', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE);
    const err = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE
    ).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('cannot approve a New order (must be Submitted first)', async () => {
    const err = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB
    ).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('cannot cancel an Approved order', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE);
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB);
    const err = await POST(
      `${SVC}/SalesOrders(${orderID})/OrderService.cancel`, {}, ALICE
    ).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  6. APPROVAL THRESHOLD
 * ═══════════════════════════════════════════════════════════════ */

describe('Approval threshold auto-approve', () => {

  test(`Order <= ${APPROVAL_THRESHOLD} auto-approved on submit`, async () => {
    // 18 * 2 = 36, gross ~ 39.60 (well under threshold)
    const { data } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI', items: [{ productID: 1, quantity: 2, discount: 0 }]
    }, ALICE);
    const { data: submitted } = await POST(
      `${SVC}/SalesOrders(${data.ID})/OrderService.submit`, {}, ALICE
    );
    expect(submitted.status).toBe('Approved'); // auto-approved
  });

  test(`Orders above ${APPROVAL_THRESHOLD} stays Submitted on submit`, async () => {
    // 18.00 * 300 = 5400 (above threshold)
    const { data } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    }, ALICE);
    expect(Number(data.grossAmount)).toBeGreaterThan(APPROVAL_THRESHOLD);

    const submitted = await POST(
      `${SVC}/SalesOrders(${data.ID})/OrderService.submit`, {}, ALICE
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
    const { data } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 300, discount: 0 }],
    }, ALICE);
    orderID = data.ID;
  });

  test('Approved → approve() rejected', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE);
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB);
    const err = await POST(`${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('Approved → submit() rejected', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE);
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB);
    const err = await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('Cancelled transitions rejected', async () => {
    await POST(`${SVC}/SalesOrders(${orderID})/OrderService.cancel`, {}, ALICE);
    let err = await POST(`${SVC}/SalesOrders(${orderID})/OrderService.submit`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);

    err = await POST(`${SVC}/SalesOrders(${orderID})/OrderService.approve`, {}, BOB).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);

    err = await POST(`${SVC}/SalesOrders(${orderID})/OrderService.cancel`, {}, ALICE).catch((e) => e);
    expect(err.response?.status || err.status).toBeGreaterThanOrEqual(400);
  });

  test('PATCH status directly is rejected (@readonly)', async () => {
    const err = await PATCH(`${SVC}/SalesOrders(${orderID})`, { status: 'Approved' }, ALICE).catch((e) => e);
    // Depending on CAP version, updating a @readonly field might be ignored or throw an error.
    // We verify the status hasn't actually changed.
    const { data } = await GET(`${SVC}/SalesOrders(${orderID})`, ALICE);
    expect(data.status).toBe('New');
  });
});

/* ═══════════════════════════════════════════════════════════════
 *  9. ODATA QUERY SUPPORT
 * ═══════════════════════════════════════════════════════════════ */

describe('OData query support', () => {
  beforeAll(async () => {
    await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI', items: [{ productID: 1, quantity: 1 }] }, ALICE);
    await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI', items: [{ productID: 14, quantity: 2 }] }, ALICE);
    await POST(`${SVC}/SalesOrders`, { customerID: 'ALFKI', items: [{ productID: 1, quantity: 3 }] }, ALICE);
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
    const { data } = await POST(`${SVC}/SalesOrders`, {
      customerID: 'ALFKI',
      items: [{ productID: 1, quantity: 1 }],
    }, ALICE);
    expect(data.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
  });
});
