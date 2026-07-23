const { pool } = require('../../config/database');

function ownerClause(clientUserId, userId, isDev) {
  if (!isDev && userId) {
    return { column: 'user_id', value: userId };
  }
  return { column: 'client_user_id', value: clientUserId };
}

async function findDuplicate(clientUserId, userId, notificationId, isDev) {
  const owner = ownerClause(clientUserId, userId, isDev);
  const { rows } = await pool.query(
    `SELECT id FROM public.notification_charges
     WHERE ${owner.column} = $1 AND notification_id = $2
     LIMIT 1`,
    [owner.value, notificationId]
  );
  return rows[0] || null;
}

async function insertCharge(clientUserId, userId, row, isDev) {
  const { rows } = await pool.query(
    `INSERT INTO public.notification_charges (
       user_id, client_user_id, amount, currency_code, merchant_name,
       raw_title, raw_body, source_app, notification_id, charged_at, parse_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      isDev ? null : userId,
      clientUserId,
      row.amount,
      row.currency_code,
      row.merchant_name,
      row.raw_title,
      row.raw_body,
      row.source_app,
      row.notification_id,
      row.charged_at,
      row.parse_status,
    ]
  );

  return rows[0];
}

async function listCharges(clientUserId, userId, isDev, filters) {
  const owner = ownerClause(clientUserId, userId, isDev);
  const { start_date, end_date, source_app, parse_status, page, limit } = filters;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * pageSize;

  const conditions = [`${owner.column} = $1`];
  const params = [owner.value];
  let i = 2;

  if (start_date) {
    conditions.push(`charged_at >= $${i++}`);
    params.push(start_date);
  }
  if (end_date) {
    conditions.push(`charged_at <= $${i++}`);
    params.push(end_date);
  }
  if (source_app) {
    conditions.push(`source_app = $${i++}`);
    params.push(source_app);
  }
  if (parse_status) {
    conditions.push(`parse_status = $${i++}`);
    params.push(parse_status);
  }

  const where = conditions.join(' AND ');
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM public.notification_charges WHERE ${where}`,
    params
  );

  const { rows } = await pool.query(
    `SELECT * FROM public.notification_charges
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${i++} OFFSET $${i}`,
    [...params, pageSize, offset]
  );

  const total = countResult.rows[0].total;
  return {
    data: rows,
    pagination: {
      total,
      page: pageNum,
      limit: pageSize,
      pages: Math.ceil(total / pageSize),
    },
  };
}

async function getSummary(clientUserId, userId, isDev, start, end) {
  const owner = ownerClause(clientUserId, userId, isDev);
  const { rows } = await pool.query(
    `SELECT amount, parse_status FROM public.notification_charges
     WHERE ${owner.column} = $1
       AND charged_at >= $2 AND charged_at <= $3
       AND amount IS NOT NULL`,
    [owner.value, start, end]
  );

  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  return {
    period: { start_date: start, end_date: end },
    count: rows.length,
    total_charges: parseFloat(total.toFixed(2)),
    failed_parse_count: rows.filter(r => r.parse_status === 'failed').length,
  };
}

async function getChargeById(clientUserId, userId, isDev, id) {
  const owner = ownerClause(clientUserId, userId, isDev);
  const { rows } = await pool.query(
    `SELECT * FROM public.notification_charges
     WHERE id = $1 AND ${owner.column} = $2`,
    [id, owner.value]
  );
  return rows[0] || null;
}

async function updateCharge(clientUserId, userId, isDev, id, updates) {
  const owner = ownerClause(clientUserId, userId, isDev);
  const fields = [];
  const params = [id, owner.value];
  let i = 3;

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${i++}`);
    params.push(value);
  }

  const { rows } = await pool.query(
    `UPDATE public.notification_charges SET ${fields.join(', ')}
     WHERE id = $1 AND ${owner.column} = $2
     RETURNING *`,
    params
  );

  return rows[0] || null;
}

async function deleteCharge(clientUserId, userId, isDev, id) {
  const owner = ownerClause(clientUserId, userId, isDev);
  const { rows } = await pool.query(
    `DELETE FROM public.notification_charges
     WHERE id = $1 AND ${owner.column} = $2
     RETURNING id`,
    [id, owner.value]
  );
  return rows[0] || null;
}

module.exports = {
  findDuplicate,
  insertCharge,
  listCharges,
  getSummary,
  getChargeById,
  updateCharge,
  deleteCharge,
};
