const { pool } = require('../../config/database');

async function getUserProfile(userId) {
  const { rows } = await pool.query(
    `SELECT id, email, full_name, avatar_url, currency, timezone, created_at
     FROM public.users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function insertPlaidItem(row) {
  const { rows } = await pool.query(
    `INSERT INTO public.plaid_items (
       user_id, plaid_item_id, plaid_access_token, institution_id,
       institution_name, status
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      row.user_id,
      row.plaid_item_id,
      row.plaid_access_token,
      row.institution_id,
      row.institution_name,
      row.status || 'active',
    ]
  );
  return rows[0];
}

async function getPlaidItemById(id, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM public.plaid_items WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0] || null;
}

async function getPlaidItemByPlaidId(plaidItemId) {
  const { rows } = await pool.query(
    `SELECT * FROM public.plaid_items WHERE plaid_item_id = $1`,
    [plaidItemId]
  );
  return rows[0] || null;
}

async function listPlaidItems(userId) {
  const { rows } = await pool.query(
    `SELECT id, institution_name, institution_id, status, error_code, last_synced_at, created_at
     FROM public.plaid_items WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function updatePlaidItem(id, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE public.plaid_items SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rows[0];
}

async function deletePlaidItem(id) {
  await pool.query(`DELETE FROM public.plaid_items WHERE id = $1`, [id]);
}

async function upsertAccounts(rows) {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO public.accounts (
         user_id, plaid_item_id, plaid_account_id, name, official_name,
         type, subtype, mask, balance_current, balance_available,
         balance_limit, iso_currency_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (plaid_account_id) DO UPDATE SET
         name = EXCLUDED.name,
         official_name = EXCLUDED.official_name,
         balance_current = EXCLUDED.balance_current,
         balance_available = EXCLUDED.balance_available,
         balance_limit = EXCLUDED.balance_limit,
         updated_at = NOW()`,
      [
        row.user_id, row.plaid_item_id, row.plaid_account_id, row.name,
        row.official_name, row.type, row.subtype, row.mask,
        row.balance_current, row.balance_available, row.balance_limit,
        row.iso_currency_code,
      ]
    );
  }
}

async function getAccountsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, plaid_account_id, name, mask, type, subtype,
            balance_current, balance_available, iso_currency_code
     FROM public.accounts WHERE user_id = $1`,
    [userId]
  );
  return rows;
}

async function upsertTransactions(rows) {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO public.transactions (
         user_id, account_id, plaid_transaction_id, amount, currency_code,
         name, merchant_name, pending, date, datetime, payment_channel,
         location, plaid_category
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (plaid_transaction_id) DO UPDATE SET
         amount = EXCLUDED.amount,
         name = EXCLUDED.name,
         merchant_name = EXCLUDED.merchant_name,
         pending = EXCLUDED.pending,
         date = EXCLUDED.date,
         datetime = EXCLUDED.datetime,
         payment_channel = EXCLUDED.payment_channel,
         location = EXCLUDED.location,
         plaid_category = EXCLUDED.plaid_category,
         updated_at = NOW()`,
      [
        row.user_id, row.account_id, row.plaid_transaction_id, row.amount,
        row.currency_code, row.name, row.merchant_name, row.pending,
        row.date, row.datetime, row.payment_channel,
        row.location ? JSON.stringify(row.location) : null,
        row.plaid_category,
      ]
    );
  }
}

async function deleteTransactionsByPlaidIds(ids) {
  if (!ids.length) return;
  await pool.query(
    `DELETE FROM public.transactions WHERE plaid_transaction_id = ANY($1::text[])`,
    [ids]
  );
}

async function listTransactions(userId, { page = 1, limit = 50, start_date, end_date, pending } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * pageSize;

  const conditions = ['t.user_id = $1'];
  const params = [userId];
  let i = 2;

  if (start_date) { conditions.push(`t.date >= $${i++}`); params.push(start_date); }
  if (end_date)   { conditions.push(`t.date <= $${i++}`); params.push(end_date); }
  if (pending !== undefined) { conditions.push(`t.pending = $${i++}`); params.push(pending === 'true'); }

  const where = conditions.join(' AND ');
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM public.transactions t WHERE ${where}`,
    params
  );

  const { rows } = await pool.query(
    `SELECT t.id, t.amount, t.currency_code, t.name, t.merchant_name, t.pending,
            t.date, t.datetime, t.payment_channel, t.notes, t.is_recurring,
            t.plaid_category,
            a.id AS account_id, a.name AS account_name, a.mask AS account_mask, a.type AS account_type
     FROM public.transactions t
     LEFT JOIN public.accounts a ON a.id = t.account_id
     WHERE ${where}
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT $${i++} OFFSET $${i}`,
    [...params, pageSize, offset]
  );

  const total = countRes.rows[0].total;
  return {
    data: rows.map(r => ({
      ...r,
      accounts: r.account_id ? {
        id: r.account_id,
        name: r.account_name,
        mask: r.account_mask,
        type: r.account_type,
      } : null,
    })),
    pagination: {
      total,
      page: pageNum,
      limit: pageSize,
      pages: Math.ceil(total / pageSize),
    },
  };
}

async function insertWebhookEvent(source, eventType, payload) {
  const { rows } = await pool.query(
    `INSERT INTO public.webhook_events (source, event_type, payload)
     VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [source, eventType, JSON.stringify(payload)]
  );
  return rows[0]?.id;
}

async function markWebhookEvent(id, { processed, error }) {
  await pool.query(
    `UPDATE public.webhook_events SET processed = $2, error = $3 WHERE id = $1`,
    [id, processed, error || null]
  );
}

module.exports = {
  getUserProfile,
  insertPlaidItem,
  getPlaidItemById,
  getPlaidItemByPlaidId,
  listPlaidItems,
  updatePlaidItem,
  deletePlaidItem,
  upsertAccounts,
  getAccountsForUser,
  upsertTransactions,
  deleteTransactionsByPlaidIds,
  listTransactions,
  insertWebhookEvent,
  markWebhookEvent,
};
