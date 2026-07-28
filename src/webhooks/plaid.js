const db = require('../db/repository');
const { syncTransactions } = require('../services/plaidService');
const logger = require('../utils/logger');

async function plaidWebhookHandler(req, res) {
  const payload = req.body;
  const eventId = await db.insertWebhookEvent(
    'plaid',
    `${payload.webhook_type}.${payload.webhook_code}`,
    payload
  );

  res.status(200).json({ received: true });

  processWebhookEvent(payload, eventId).catch(err => {
    logger.error('Webhook processing error', { error: err.message, payload });
  });
}

async function processWebhookEvent(payload, eventId) {
  const { webhook_type, webhook_code, item_id } = payload;
  logger.info('Processing webhook', { webhook_type, webhook_code, item_id });

  const item = await db.getPlaidItemByPlaidId(item_id);
  if (!item) {
    logger.warn('Webhook for unknown item', { item_id });
    return;
  }

  try {
    if (webhook_type === 'TRANSACTIONS') {
      await handleTransactionsWebhook(webhook_code, item);
    } else if (webhook_type === 'ITEM') {
      await handleItemWebhook(webhook_code, item, payload);
    }

    if (eventId) await db.markWebhookEvent(eventId, { processed: true });
  } catch (err) {
    if (eventId) await db.markWebhookEvent(eventId, { processed: false, error: err.message });
    throw err;
  }
}

async function handleTransactionsWebhook(code, item) {
  switch (code) {
    case 'SYNC_UPDATES_AVAILABLE':
    case 'INITIAL_UPDATE':
    case 'HISTORICAL_UPDATE': {
      const stats = await syncTransactions(item.id, item.user_id);
      logger.info('Transaction sync complete', { itemId: item.id, ...stats });
      break;
    }
    default:
      logger.debug('Unhandled TRANSACTIONS webhook', { code });
  }
}

async function handleItemWebhook(code, item, payload) {
  switch (code) {
    case 'ERROR':
      await db.updatePlaidItem(item.id, {
        status: 'error',
        error_code: payload.error?.error_code || null,
      });
      break;
    case 'USER_PERMISSION_REVOKED':
    case 'ITEM_REMOVED':
      await db.updatePlaidItem(item.id, { status: 'revoked' });
      break;
    default:
      logger.debug('Unhandled ITEM webhook', { code });
  }
}

module.exports = { plaidWebhookHandler };
