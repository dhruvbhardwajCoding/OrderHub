'use strict';

/**
 * Unit test for the real invoice PDF generator (not mocked, unlike in
 * test/order-service.test.js). Satisfies the non-functional "Tests" row's
 * explicit requirement: "invoice creation (PDF bytes start with %PDF)".
 */

const { generateInvoicePdf } = require('../srv/lib/pdf');

describe('generateInvoicePdf (real pdfmake output, not mocked)', () => {
  const order = {
    orderNo: 'SO-2026-00001',
    customerName: 'Alfreds Futterkiste',
    currency_code: 'USD',
    netAmount: 440.25,
    taxAmount: 44.03,
    grossAmount: 484.28,
    items: [
      { productID: 1, productName: 'Chai', quantity: 20, unitPrice: 18.0, discount: 10, netAmount: 324.0 },
      { productID: 14, productName: 'Tofu', quantity: 5, unitPrice: 23.25, discount: 0, netAmount: 116.25 },
    ],
  };

  test('produces a real PDF buffer whose bytes start with %PDF', async () => {
    const buffer = await generateInvoicePdf(order, 'INV-2026-00001');

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('still produces a valid PDF when no Northwind customer snapshot is passed', async () => {
    const buffer = await generateInvoicePdf(order, 'INV-2026-00002', null);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('produces a valid PDF with a full Northwind customer address for the Bill-To block', async () => {
    const customer = {
      CustomerID: 'ALFKI',
      CompanyName: 'Alfreds Futterkiste',
      ContactName: 'Maria Anders',
      Address: 'Obere Str. 57',
      City: 'Berlin',
      PostalCode: '12209',
      Country: 'Germany',
    };
    const buffer = await generateInvoicePdf(order, 'INV-2026-00003', customer);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('stays a valid, well-formed PDF with 25 items across what would be 2 pages (section 8)', async () => {
    const manyItems = Array.from({ length: 25 }, (_, i) => ({
      productID: i + 1,
      productName: `Product ${i + 1}`,
      quantity: 1,
      unitPrice: 10,
      discount: 0,
      netAmount: 10,
    }));
    const bigOrder = { ...order, items: manyItems, netAmount: 250, taxAmount: 25, grossAmount: 275 };

    const buffer = await generateInvoicePdf(bigOrder, 'INV-2026-00004');
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    // A real multi-page PDF ends with %%EOF, not an empty/truncated buffer.
    expect(buffer.subarray(-6).toString('ascii').trim().endsWith('%%EOF')).toBe(true);
  });

  test('handles an order with no items without throwing', async () => {
    const buffer = await generateInvoicePdf({ ...order, items: [] }, 'INV-2026-00005');
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
