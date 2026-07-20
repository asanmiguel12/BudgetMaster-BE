const cron    = require('node-cron');
const { supabase }  = require('../../config/supabase');
const { syncTransactions, syncAccounts } = require('../services/plaidService');
const logger  = require('../utils/logger');

/**
 * Nightly sync job — runs at 2 AM every day.
 * Acts as a fallback in case webhooks are missed (network hiccup, Plaid retry window, etc.)
 */
function startCronJobs() {
  // Nightly full sync — 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('Cron: starting nightly sync');

    const { data: items, error } = await supabase
      .from('plaid_items')
      .select('id, user_id, plaid_access_token')
      .eq('status', 'active');

    if (error) {
      logger.error('Cron: failed to fetch items', { error: error.message });
      return;
    }

    logger.info(`Cron: syncing ${items.length} items`);

    // Process items sequentially to avoid overwhelming Plaid rate limits
    for (const item of items) {
      try {
        await syncAccounts(item.id, item.plaid_access_token, item.user_id);
        await syncTransactions(item.id, item.user_id);
      } catch (err) {
        logger.error('Cron: item sync failed', {
          itemId: item.id,
          error:  err.message
        });
        // Continue with next item
      }

      // Small delay between items — be a good Plaid citizen
      await new Promise(r => setTimeout(r, 500));
    }

    logger.info('Cron: nightly sync complete');
  });

  // Budget alert check — 9:00 AM daily
  cron.schedule('0 9 * * *', async () => {
    logger.info('Cron: checking budget alerts');
    await checkBudgetAlerts();
  });

  logger.info('Cron jobs registered');
}

async function checkBudgetAlerts() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
  const endOfMonth   = new Date(year, month, 0).toISOString().slice(0, 10);

  const { data: budgets } = await supabase
    .from('budgets')
    .select('id, user_id, amount, category_id, name')
    .eq('period', 'monthly');

  for (const budget of budgets) {
    const { data: txns } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', budget.user_id)
      .eq('category_id', budget.category_id)
      .eq('pending', false)
      .gte('date', startOfMonth)
      .lte('date', endOfMonth)
      .lt('amount', 0);

    if (!txns) continue;

    const spent      = Math.abs(txns.reduce((s, t) => s + parseFloat(t.amount), 0));
    const percentage = (spent / budget.amount) * 100;

    // Alert at 80% and 100%
    if (percentage >= 100) {
      logger.info('Budget exceeded', { budgetId: budget.id, spent, limit: budget.amount });
      // TODO: sendPushNotification(budget.user_id, { title: `Budget exceeded: ${budget.name}`, ... })
    } else if (percentage >= 80) {
      logger.info('Budget at 80%', { budgetId: budget.id, spent, limit: budget.amount });
      // TODO: sendPushNotification(budget.user_id, { title: `Heads up: ${budget.name} at 80%`, ... })
    }
  }
}

module.exports = { startCronJobs };
