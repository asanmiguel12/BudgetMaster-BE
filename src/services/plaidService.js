const { plaidClient } = require('../../config/plaid');
const { supabase }    = require('../../config/supabase');
const logger          = require('../utils/logger');

const PRODUCTS    = ['transactions'];
const COUNTRY_CODES = ['US'];

// ─── Link Token ──────────────────────────────────────────────────────────────
async function createLinkToken(userId) {
  const response = await plaidClient.linkTokenCreate({
    user:          { client_user_id: userId },
    client_name:   'Budget App',
    products:      PRODUCTS,
    country_codes: COUNTRY_CODES,
    language:      'en',
    webhook:       process.env.PLAID_WEBHOOK_URL
  });
  return response.data.link_token;
}

// ─── Exchange public token after Link flow ───────────────────────────────────
async function exchangePublicToken(publicToken, userId) {
  const exchangeRes = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken
  });

  const { access_token, item_id } = exchangeRes.data;

  // Fetch institution info
  const itemRes = await plaidClient.itemGet({ access_token });
  const institutionId = itemRes.data.item.institution_id;

  let institutionName = null;
  if (institutionId) {
    const instRes = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes:  COUNTRY_CODES
    });
    institutionName = instRes.data.institution.name;
  }

  // Save to DB
  const { data: item, error } = await supabase
    .from('plaid_items')
    .insert({
      user_id:            userId,
      plaid_item_id:      item_id,
      plaid_access_token: access_token,  // encrypt in prod with KMS/Vault
      institution_id:     institutionId,
      institution_name:   institutionName,
      status:             'active'
    })
    .select()
    .single();

  if (error) throw new Error(`DB insert failed: ${error.message}`);

  // Sync accounts + initial transactions right away
  await syncAccounts(item.id, access_token, userId);
  await syncTransactions(item.id, userId);

  return item;
}

// ─── Sync accounts for an item ───────────────────────────────────────────────
async function syncAccounts(plaidItemDbId, accessToken, userId) {
  const res = await plaidClient.accountsGet({ access_token: accessToken });

  const rows = res.data.accounts.map(acc => ({
    user_id:           userId,
    plaid_item_id:     plaidItemDbId,
    plaid_account_id:  acc.account_id,
    name:              acc.name,
    official_name:     acc.official_name,
    type:              acc.type,
    subtype:           acc.subtype,
    mask:              acc.mask,
    balance_current:   acc.balances.current,
    balance_available: acc.balances.available,
    balance_limit:     acc.balances.limit,
    iso_currency_code: acc.balances.iso_currency_code
  }));

  const { error } = await supabase
    .from('accounts')
    .upsert(rows, { onConflict: 'plaid_account_id' });

  if (error) throw new Error(`Accounts sync failed: ${error.message}`);
  logger.info('Accounts synced', { plaidItemDbId, count: rows.length });
  return rows.length;
}

// ─── Incremental transaction sync using Plaid cursor ────────────────────────
async function syncTransactions(plaidItemDbId, userId) {
  // Fetch item to get access token + cursor
  const { data: item, error: itemErr } = await supabase
    .from('plaid_items')
    .select('plaid_access_token, cursor')
    .eq('id', plaidItemDbId)
    .single();

  if (itemErr) throw new Error(itemErr.message);

  const accessToken = item.plaid_access_token;
  let cursor = item.cursor || undefined;

  let added    = [];
  let modified = [];
  let removed  = [];
  let hasMore  = true;

  // Paginate through all pages of updates
  while (hasMore) {
    const res = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor
    });

    added    = added.concat(res.data.added);
    modified = modified.concat(res.data.modified);
    removed  = removed.concat(res.data.removed);
    hasMore  = res.data.has_more;
    cursor   = res.data.next_cursor;
  }

  // Fetch account map: plaid_account_id → db UUID
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, plaid_account_id')
    .eq('user_id', userId);

  const accountMap = Object.fromEntries(
    accounts.map(a => [a.plaid_account_id, a.id])
  );

  // Upsert added + modified
  const toUpsert = [...added, ...modified]
    .filter(tx => accountMap[tx.account_id])
    .map(tx => ({
      user_id:              userId,
      account_id:           accountMap[tx.account_id],
      plaid_transaction_id: tx.transaction_id,
      amount:               -tx.amount,   // Plaid: positive = debit; we flip to negative expense
      currency_code:        tx.iso_currency_code || 'USD',
      name:                 tx.name,
      merchant_name:        tx.merchant_name,
      pending:              tx.pending,
      date:                 tx.date,
      datetime:             tx.datetime,
      payment_channel:      tx.payment_channel,
      location:             tx.location,
      plaid_category:       tx.category
    }));

  if (toUpsert.length > 0) {
    const { error: upsertErr } = await supabase
      .from('transactions')
      .upsert(toUpsert, { onConflict: 'plaid_transaction_id' });

    if (upsertErr) throw new Error(`Transaction upsert failed: ${upsertErr.message}`);
  }

  // Remove deleted transactions
  if (removed.length > 0) {
    const removedIds = removed.map(r => r.transaction_id);
    await supabase
      .from('transactions')
      .delete()
      .in('plaid_transaction_id', removedIds);
  }

  // Save new cursor + last synced timestamp
  await supabase
    .from('plaid_items')
    .update({ cursor, last_synced_at: new Date().toISOString() })
    .eq('id', plaidItemDbId);

  logger.info('Transactions synced', {
    plaidItemDbId,
    added:   added.length,
    modified: modified.length,
    removed: removed.length
  });

  return { added: added.length, modified: modified.length, removed: removed.length };
}

// ─── Refresh all account balances for a user ────────────────────────────────
async function refreshBalances(userId) {
  const { data: items } = await supabase
    .from('plaid_items')
    .select('id, plaid_access_token')
    .eq('user_id', userId)
    .eq('status', 'active');

  for (const item of items) {
    await syncAccounts(item.id, item.plaid_access_token, userId);
  }
}

// ─── Remove a bank connection ────────────────────────────────────────────────
async function removeItem(plaidItemDbId, userId) {
  const { data: item } = await supabase
    .from('plaid_items')
    .select('plaid_access_token')
    .eq('id', plaidItemDbId)
    .eq('user_id', userId)
    .single();

  if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });

  // Revoke at Plaid
  await plaidClient.itemRemove({ access_token: item.plaid_access_token });

  // Delete from DB (cascades to accounts & transactions)
  await supabase.from('plaid_items').delete().eq('id', plaidItemDbId);
  logger.info('Plaid item removed', { plaidItemDbId, userId });
}

module.exports = {
  createLinkToken,
  exchangePublicToken,
  syncAccounts,
  syncTransactions,
  refreshBalances,
  removeItem
};
