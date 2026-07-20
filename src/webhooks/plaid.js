const { supabase }       = require('../../config/supabase');
const { syncTransactions, syncAccounts } = require('../services/plaidService');
const logger             = require('../utils/logger');

/**
 * POST /webhooks/plaid
 *
 * Plaid fires this endpoint when:
 *  - New transactions arrive           → SYNC_UPDATES_AVAILABLE
 *  - Transactions are updated/removed  → SYNC_UPDATES_AVAILABLE
 *  - An Item has an error              → ITEM errors
 *  - Auth status changes               → various
 *
 * We log every event then process the important ones.
 * This is how the app gets "bank notifications while closed."
 */
async function plaidWebhookHandler(req, res) {
  const payload = req.body;

  // Log raw event for audit trail
  const { data: event, error: logErr } = await supabase
    .from('webhook_events')
    .insert({
      source:     'plaid',
      event_type: `${payload.webhook_type}.${payload.webhook_code}`,
      payload
    })
    .select()
    .single();

  if (logErr) logger.error('Failed to log webhook event', { error: logErr.message });

  // Acknowledge immediately — Plaid will retry if we don't respond within 10s
  res.status(200).json({ received: true });

  // Process asynchronously so we don't hold the response
  processWebhookEvent(payload, event?.id).catch(err => {
    logger.error('Webhook processing error', { error: err.message, payload });
  });
}

async function processWebhookEvent(payload, eventId) {
  const { webhook_type, webhook_code, item_id } = payload;

  logger.info('Processing webhook', { webhook_type, webhook_code, item_id });

  // Look up the DB item by Plaid item_id
  const { data: item, error: itemErr } = await supabase
    .from('plaid_items')
    .select('id, user_id, plaid_access_token')
    .eq('plaid_item_id', item_id)
    .single();

  if (itemErr || !item) {
    logger.warn('Webhook for unknown item', { item_id });
    return;
  }

  try {
    if (webhook_type === 'TRANSACTIONS') {
      await handleTransactionsWebhook(webhook_code, item, payload);
    } else if (webhook_type === 'ITEM') {
      await handleItemWebhook(webhook_code, item, payload);
    }

    // Mark event as processed
    if (eventId) {
      await supabase
        .from('webhook_events')
        .update({ processed: true })
        .eq('id', eventId);
    }
  } catch (err) {
    if (eventId) {
      await supabase
        .from('webhook_events')
        .update({ error: err.message })
        .eq('id', eventId);
    }
    throw err;
  }
}

// ─── TRANSACTIONS webhooks ───────────────────────────────────
async function handleTransactionsWebhook(code, item, payload) {
  switch (code) {
    case 'SYNC_UPDATES_AVAILABLE': {
      // Core: new/updated/removed transactions are available
      const stats = await syncTransactions(item.id, item.user_id);
      logger.info('Transaction sync complete', { itemId: item.id, ...stats });

      // Notify the user's device if new transactions arrived
      if (stats.added > 0) {
        await sendPushNotification(item.user_id, {
          title: '💰 New Transactions',
          body:  `${stats.added} new transaction${stats.added > 1 ? 's' : ''} synced from your bank.`,
          data:  { type: 'NEW_TRANSACTIONS', count: stats.added }
        });
      }
      break;
    }
    case 'INITIAL_UPDATE':
    case 'HISTORICAL_UPDATE':
      // Initial data after Link — also covered by SYNC_UPDATES_AVAILABLE
      await syncTransactions(item.id, item.user_id);
      break;

    default:
      logger.debug('Unhandled TRANSACTIONS webhook', { code });
  }
}

// ─── ITEM webhooks ──────────────────────────────────────────
async function handleItemWebhook(code, item, payload) {
  switch (code) {
    case 'ERROR': {
      const errorCode = payload.error?.error_code;
      await supabase
        .from('plaid_items')
        .update({ status: 'error', error_code: errorCode })
        .eq('id', item.id);

      logger.warn('Plaid item error', { itemId: item.id, errorCode });

      await sendPushNotification(item.user_id, {
        title: '⚠️ Bank Connection Issue',
        body:  'One of your bank connections needs attention. Tap to reconnect.',
        data:  { type: 'ITEM_ERROR', itemId: item.id }
      });
      break;
    }

    case 'PENDING_EXPIRATION':
      await sendPushNotification(item.user_id, {
        title: '🔄 Re-authenticate Required',
        body:  'Your bank connection will expire soon. Tap to keep it active.',
        data:  { type: 'PENDING_EXPIRATION', itemId: item.id }
      });
      break;

    case 'USER_PERMISSION_REVOKED':
    case 'ITEM_REMOVED':
      await supabase
        .from('plaid_items')
        .update({ status: 'revoked' })
        .eq('id', item.id);
      break;

    default:
      logger.debug('Unhandled ITEM webhook', { code });
  }
}

// ─── Push notification stub ─────────────────────────────────
// Replace with expo-server-sdk, FCM, or APNs in production
async function sendPushNotification(userId, { title, body, data }) {
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token, platform')
    .eq('user_id', userId);

  if (!tokens || tokens.length === 0) return;

  logger.info('Sending push notification', {
    userId,
    title,
    tokenCount: tokens.length
  });

  // Example: Expo push
  // const { Expo } = require('expo-server-sdk');
  // const expo = new Expo();
  // const messages = tokens
  //   .filter(t => Expo.isExpoPushToken(t.token))
  //   .map(t => ({ to: t.token, sound: 'default', title, body, data }));
  // await expo.sendPushNotificationsAsync(messages);
}

module.exports = { plaidWebhookHandler };
