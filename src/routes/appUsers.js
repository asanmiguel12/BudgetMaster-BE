const express = require('express');
const { body, validationResult } = require('express-validator');
const { createProfile, getProfile } = require('../services/appUserStore');
const { setUserState } = require('../services/appBudgetStore');
const { insertCharge, findDuplicate, getChargeById } = require('../services/notificationChargeStore');
const { parseBankNotification } = require('../utils/notificationParser');

const router = express.Router();

// POST /users — register a dev user with profile + starter data
router.post('/',
  body('full_name').notEmpty().isString().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('currency').optional().isString().isLength({ min: 3, max: 3 }),
  body('timezone').optional().isString(),
  body('client_user_id').optional().isString().trim(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      full_name,
      email,
      currency = 'USD',
      timezone = 'America/Los_Angeles',
      client_user_id,
    } = req.body;

    const userId = client_user_id
      || full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      || `user-${Date.now()}`;

    try {
      const profile = await createProfile({
        client_user_id: userId,
        full_name,
        email: email || `${userId}@budgetmaster.local`,
        currency,
        timezone,
      });

      const budgets = [
        {
          id: `${userId}-budget-main`,
          name: full_name,
          amount: 2500,
          timeframe: { unit: 'months', duration: 1 },
          periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
          transactions: [
            {
              id: `${userId}-tx-1`,
              amount: -52.30,
              description: 'Target',
              date: new Date().toISOString(),
            },
            {
              id: `${userId}-tx-2`,
              amount: -18.75,
              description: 'Chipotle',
              date: new Date(Date.now() - 86400000).toISOString(),
            },
            {
              id: `${userId}-tx-3`,
              amount: 3200.00,
              description: 'Direct Deposit',
              date: new Date(Date.now() - 7 * 86400000).toISOString(),
            },
          ],
        },
        {
          id: `${userId}-budget-food`,
          name: 'Food & Dining',
          amount: 500,
          timeframe: { unit: 'months', duration: 1 },
          periodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
          transactions: [],
        },
      ];

      const budgetState = await setUserState(userId, {
        budgets,
        activeBudgetIndex: 0,
      });

      const notificationBody = 'You spent $24.50 at STARBUCKS on 07/23.';
      const parsed = parseBankNotification({ title: 'Chase', body: notificationBody });
      const welcomeNotificationId = `${userId}-welcome-charge`;

      let welcomeCharge = null;
      const existingCharge = await findDuplicate(userId, userId, welcomeNotificationId, true);
      if (existingCharge) {
        welcomeCharge = await getChargeById(userId, userId, true, existingCharge.id);
      } else {
        welcomeCharge = await insertCharge(userId, userId, {
          amount: parsed.amount,
          currency_code: currency,
          merchant_name: parsed.merchant_name,
          raw_title: 'Chase',
          raw_body: notificationBody,
          source_app: 'Chase',
          notification_id: welcomeNotificationId,
          charged_at: parsed.charged_at,
          parse_status: parsed.parse_status,
        }, true);
      }

      res.status(201).json({
        profile,
        budgetState,
        welcomeCharge,
        headers: { 'X-User-Id': userId },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /users/:clientUserId
router.get('/:clientUserId', async (req, res, next) => {
  try {
    const profile = await getProfile(req.params.clientUserId);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
