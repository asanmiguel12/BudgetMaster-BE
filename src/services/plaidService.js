const { plaidClient } = require('../../config/plaid');
const db = require('../db/repository');
const logger = require('../utils/logger');

const PRODUCTS = ['transactions'];
const COUNTRY_CODES = ['US'];

function assertPlaidConfigured() {
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    const err = new Error('Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env');
    err.status = 503;
    throw err;
  }
}

async function createLinkToken(userId) {
  assertPlaidConfigured();
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'Budget Master',
    products: PRODUCTS,
    country_codes: COUNTRY_CODES,
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
  });
  return response.data.link_token;
}

async function exchangePublicToken(publicToken, userId) {
  assertPlaidConfigured();
  const exchangeRes = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const { access_token, item_id } = exchangeRes.data;
  const itemRes = await plaidClient.itemGet({ access_token });
  const institutionId = itemRes.data.item.institution_id;

  let institutionName = null;
  if (institutionId) {
    const instRes = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: COUNTRY_CODES,
    });
    institutionName = instRes.data.institution.name;
  }

  const item = await db.insertPlaidItem({
    user_id: userId,
    plaid_item_id: item_id,
    plaid_access_token: access_token,
    institution_id: institutionId,
    institution_name: institutionName,
    status: 'active',
  });

  await syncAccounts(item.id, access_token, userId);
  await syncTransactions(item.id, userId);
  return item;
}

async function connectSandboxBank(userId, institutionId = 'ins_109508') {
  assertPlaidConfigured();
  const sandboxRes = await plaidClient.sandboxPublicTokenCreate({
    institution_id: institutionId,
    initial_products: PRODUCTS,
  });
  return exchangePublicToken(sandboxRes.data.public_token, userId);
}

async function syncAccounts(plaidItemDbId, accessToken, userId) {
  const res = await plaidClient.accountsGet({ access_token: accessToken });
  const rows = res.data.accounts.map(acc => ({
    user_id: userId,
    plaid_item_id: plaidItemDbId,
    plaid_account_id: acc.account_id,
    name: acc.name,
    official_name: acc.official_name,
    type: acc.type,
    subtype: acc.subtype,
    mask: acc.mask,
    balance_current: acc.balances.current,
    balance_available: acc.balances.available,
    balance_limit: acc.balances.limit,
    iso_currency_code: acc.balances.iso_currency_code || 'USD',
  }));

  await db.upsertAccounts(rows);
  logger.info('Accounts synced', { plaidItemDbId, count: rows.length });
  return rows.length;
}

async function syncTransactions(plaidItemDbId, userId) {
  const item = await db.getPlaidItemById(plaidItemDbId, userId);
  if (!item) throw new Error('Plaid item not found');

  let cursor = item.cursor || undefined;
  let added = [];
  let modified = [];
  let removed = [];
  let hasMore = true;

  while (hasMore) {
    const res = await plaidClient.transactionsSync({
      access_token: item.plaid_access_token,
      cursor,
    });
    added = added.concat(res.data.added);
    modified = modified.concat(res.data.modified);
    removed = removed.concat(res.data.removed);
    hasMore = res.data.has_more;
    cursor = res.data.next_cursor;
  }

  const accounts = await db.getAccountsForUser(userId);
  const accountMap = Object.fromEntries(accounts.map(a => [a.plaid_account_id, a.id]));

  const toUpsert = [...added, ...modified]
    .filter(tx => accountMap[tx.account_id])
    .map(tx => ({
      user_id: userId,
      account_id: accountMap[tx.account_id],
      plaid_transaction_id: tx.transaction_id,
      amount: -tx.amount,
      currency_code: tx.iso_currency_code || 'USD',
      name: tx.name,
      merchant_name: tx.merchant_name,
      pending: tx.pending,
      date: tx.date,
      datetime: tx.datetime,
      payment_channel: tx.payment_channel,
      location: tx.location,
      plaid_category: tx.category,
    }));

  if (toUpsert.length) await db.upsertTransactions(toUpsert);
  if (removed.length) {
    await db.deleteTransactionsByPlaidIds(removed.map(r => r.transaction_id));
  }

  await db.updatePlaidItem(plaidItemDbId, {
    cursor,
    last_synced_at: new Date().toISOString(),
  });

  logger.info('Transactions synced', {
    plaidItemDbId,
    added: added.length,
    modified: modified.length,
    removed: removed.length,
  });

  return { added: added.length, modified: modified.length, removed: removed.length };
}

async function refreshBalances(userId) {
  const items = await db.listPlaidItems(userId);
  for (const item of items.filter(i => i.status === 'active')) {
    const full = await db.getPlaidItemById(item.id, userId);
    if (full) await syncAccounts(item.id, full.plaid_access_token, userId);
  }
}

async function removeItem(plaidItemDbId, userId) {
  const item = await db.getPlaidItemById(plaidItemDbId, userId);
  if (!item) {
    const err = new Error('Item not found');
    err.status = 404;
    throw err;
  }

  await plaidClient.itemRemove({ access_token: item.plaid_access_token });
  await db.deletePlaidItem(plaidItemDbId);
  logger.info('Plaid item removed', { plaidItemDbId, userId });
}

module.exports = {
  createLinkToken,
  exchangePublicToken,
  connectSandboxBank,
  syncAccounts,
  syncTransactions,
  refreshBalances,
  removeItem,
};
