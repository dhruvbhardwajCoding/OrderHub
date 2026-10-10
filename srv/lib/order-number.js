'use strict';

/**
 * Generate a sequential order number in the format SO-YYYY-NNNNN.
 *
 * Queries the database for the highest existing order number in the
 * current year and increments the sequence.  Thread-safety relies on
 * the caller running inside a CDS transaction (which serialises writes
 * to the same SQLite database).
 *
 * @param {object} db – CDS database service (e.g. cds.connect.to('db'))
 * @returns {Promise<string>} e.g. "SO-2026-00001"
 */
async function generateOrderNumber(db) {
  const year   = new Date().getFullYear();
  const prefix = `SO-${year}-`;

  const result = await db.run(
    SELECT.one
      .from('orderhub.SalesOrders')
      .columns('orderNo')
      .where`orderNo like ${prefix + '%'}`
      .orderBy('orderNo desc')
  );

  let sequence = 1;
  if (result?.orderNo) {
    const lastSeq = parseInt(result.orderNo.substring(prefix.length), 10);
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

module.exports = { generateOrderNumber };
