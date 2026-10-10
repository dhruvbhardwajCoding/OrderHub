'use strict';

// pdfmake@0.3.x no longer exports the PdfPrinter class directly from the
// package root — it exports a singleton with createPdf()/setFonts() instead.
const pdfMake = require('pdfmake');

const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

pdfMake.setFonts(FONTS);
// Standard-14 font names (e.g. "Helvetica") are resolved locally by pdfkit,
// not fetched — allow that, but never let the document pull in remote URLs.
pdfMake.setLocalAccessPolicy(() => true);
pdfMake.setUrlAccessPolicy(() => false);

const DUE_DAYS = 30;

function money(value, currency) {
  const amount = Number(value || 0).toFixed(2);
  return currency ? `${amount} ${currency}` : amount;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
  });
}

/**
 * Build and render an invoice PDF with pdfmake.
 *
 * @param {object} order      – sales order header + items (from SQLite)
 * @param {string} invoiceNo  – e.g. "INV-2026-00017"
 * @param {object} [customer] – optional Northwind customer snapshot for the Bill-To block
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(order, invoiceNo, customer) {
  const currency   = order.currency_code || order.currency?.code || '';
  const taxRate    = order.netAmount > 0 ? (order.taxAmount / order.netAmount) * 100 : 0;
  const invoiceDate = new Date();
  const dueDate      = addDays(invoiceDate, DUE_DAYS);

  const items = order.items || [];

  const itemsBody = [
    [
      { text: '#', style: 'tableHeader' },
      { text: 'Product', style: 'tableHeader' },
      { text: 'Qty', style: 'tableHeader' },
      { text: 'Unit Price', style: 'tableHeader' },
      { text: 'Discount', style: 'tableHeader' },
      { text: 'Line Net', style: 'tableHeader' },
    ],
  ];

  if (items.length > 0) {
    items.forEach((item, idx) => {
      itemsBody.push([
        String(idx + 1),
        item.productName || `Product ${item.productID}`,
        String(item.quantity),
        money(item.unitPrice, currency),
        `${Number(item.discount || 0).toFixed(2)}%`,
        money(item.netAmount, currency),
      ]);
    });
  } else {
    itemsBody.push([{ text: 'No items', colSpan: 6, alignment: 'center' }, {}, {}, {}, {}, {}]);
  }

  const billToLines = [{ text: 'Bill To:\n', bold: true }];
  if (customer) {
    billToLines.push(`${customer.CompanyName || order.customerName}\n`);
    if (customer.ContactName) billToLines.push(`${customer.ContactName}\n`);
    if (customer.Address)     billToLines.push(`${customer.Address}\n`);
    const cityLine = [customer.City, customer.PostalCode].filter(Boolean).join(' ');
    if (cityLine) billToLines.push(`${cityLine}\n`);
    if (customer.Country)     billToLines.push(`${customer.Country}\n`);
  } else {
    billToLines.push(`${order.customerName || order.customerID}\n`);
  }

  const docDefinition = {
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    pageMargins: [40, 40, 40, 60],
    content: [
      { text: 'Northwind Order Hub', style: 'header' },
      { text: `Invoice No: ${invoiceNo}`, style: 'subheader' },
      { text: `Order No: ${order.orderNo}` },
      { text: `Invoice Date: ${formatDate(invoiceDate)}` },
      { text: `Due Date: ${formatDate(dueDate)}` },
      { text: '\n' },
      {
        columns: [
          { text: billToLines },
          {
            text: [
              { text: 'Seller:\n', bold: true },
              'Northwind Order Hub Ltd.\n',
              '123 Business Rd.\n',
              'London, UK',
            ],
            alignment: 'right',
          },
        ],
      },
      { text: '\n\n' },
      {
        table: {
          headerRows: 1,
          widths: [20, '*', 'auto', 'auto', 'auto', 'auto'],
          body: itemsBody,
        },
        layout: 'lightHorizontalLines',
      },
      { text: '\n' },
      {
        columns: [
          { text: '' },
          {
            table: {
              widths: [100, 100],
              body: [
                [{ text: 'Net Amount:', bold: true }, money(order.netAmount, currency)],
                [{ text: `Tax (${taxRate.toFixed(0)}%):`, bold: true }, money(order.taxAmount, currency)],
                [{ text: 'Total Gross:', bold: true }, money(order.grossAmount, currency)],
              ],
            },
            layout: 'noBorders',
            width: 200,
          },
        ],
      },
    ],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'Payment due within 30 days of the invoice date.', fontSize: 8, margin: [40, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, alignment: 'right', fontSize: 8, margin: [0, 0, 40, 0] },
      ],
    }),
    styles: {
      header:     { fontSize: 22, bold: true, margin: [0, 0, 0, 10] },
      subheader:  { fontSize: 16, bold: true, margin: [0, 0, 0, 5] },
      tableHeader: { bold: true },
    },
  };

  const doc = pdfMake.createPdf(docDefinition);
  return doc.getBuffer();
}

module.exports = {
  generateInvoicePdf,
};
