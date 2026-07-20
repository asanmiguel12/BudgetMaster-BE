# Budget App — Backend

Node.js / Express / Supabase / Plaid backend for the budget app.
Handles real-time bank transaction ingestion, account management, budgeting, and push notifications while the app is closed.

---

## Architecture

```
Client (React Native)
  │
  │  JWT in Authorization header
  ▼
Express API  (:3000)
  ├── /api/auth          — user profile, push tokens
  ├── /api/plaid         — Link flow, bank management
  ├── /api/accounts      — balance summary
  ├── /api/transactions  — list, filter, categorize
  ├── /api/budgets       — CRUD + spend tracking
  └── /api/categories    — system + custom categories

  POST /webhooks/plaid   ← Plaid fires this for new transactions
                            (no auth — Plaid calls this directly)

Background (node-cron)
  ├── 2:00 AM — nightly full transaction sync (webhook fallback)
  └── 9:00 AM — budget alert check

Supabase (Postgres)
  ├── users, plaid_items, accounts
  ├── transactions, categories, budgets
  ├── push_tokens, webhook_events
  └── Row Level Security on all tables
```

---

## How "Background Bank Notifications" Work

```
Bank → Plaid → POST /webhooks/plaid → syncTransactions() → sendPushNotification()
                                              ↑
                                  SYNC_UPDATES_AVAILABLE event
                                  fires within seconds of a transaction
```

1. Plaid monitors the user's bank 24/7.
2. When a new transaction lands, Plaid sends `SYNC_UPDATES_AVAILABLE` to your webhook.
3. Your backend calls `transactionsSync`, stores new rows, then fires a push notification.
4. User sees the notification on their lock screen — even if the app is closed.

---

## Quick Start

### 1. Clone & install

```bash
npm install
cp .env.example .env
# → fill in .env values
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run `src/db/schema.sql`
3. Copy your **Project URL**, **anon key**, **service role key**, and **JWT secret** into `.env`

### 3. Set up Plaid

1. Create an account at [dashboard.plaid.com](https://dashboard.plaid.com)
2. Create an app, copy **Client ID** and **Sandbox Secret** into `.env`
3. Set `PLAID_ENV=sandbox` for development
4. Configure your webhook URL in Plaid dashboard → **Developers → Webhooks**
   - Use [ngrok](https://ngrok.com) locally: `ngrok http 3000`
   - Set webhook URL to: `https://your-ngrok-id.ngrok.io/webhooks/plaid`

### 4. Run

```bash
npm run dev    # development (nodemon)
npm start      # production
```

---

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/auth/me | Get current user profile |
| PATCH  | /api/auth/me | Update profile |
| POST   | /api/auth/push-token | Register push notification token |
| DELETE | /api/auth/push-token | Remove push token on logout |

> **Note:** Signup and login are handled by Supabase Auth on the client.
> Your client gets a JWT from Supabase, which it sends in `Authorization: Bearer <token>`.

### Plaid
| Method | Path | Description |
|--------|------|-------------|
| POST   | /api/plaid/link-token | Create Link token (start bank connection) |
| POST   | /api/plaid/exchange | Exchange public token after Link flow |
| GET    | /api/plaid/items | List connected banks |
| POST   | /api/plaid/items/:id/sync | Manual sync trigger |
| POST   | /api/plaid/balances/refresh | Refresh all balances |
| DELETE | /api/plaid/items/:id | Disconnect a bank |

### Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/accounts | All accounts with balances |
| GET    | /api/accounts/summary | Net worth breakdown |
| PATCH  | /api/accounts/:id | Hide/show account |

### Transactions
| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/transactions | Paginated list with filters |
| GET    | /api/transactions/spending | Monthly spending by category |
| GET    | /api/transactions/:id | Single transaction |
| POST   | /api/transactions | Create manual transaction |
| PATCH  | /api/transactions/:id | Update category/notes |
| DELETE | /api/transactions/:id | Delete manual transaction |

**GET /api/transactions query params:**
```
account_id, category_id, start_date, end_date,
pending, search, page, limit, sort (field:asc|desc)
```

### Budgets
| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/budgets | List budgets with live progress |
| POST   | /api/budgets | Create budget |
| PATCH  | /api/budgets/:id | Update budget |
| DELETE | /api/budgets/:id | Delete budget |

### Categories
| Method | Path | Description |
|--------|------|-------------|
| GET    | /api/categories | System + custom categories |
| POST   | /api/categories | Create custom category |
| DELETE | /api/categories/:id | Delete custom category |

### Notification Charges (iOS bank alerts)
| Method | Path | Description |
|--------|------|-------------|
| POST   | /api/notification-charges | Ingest a bank push notification |
| GET    | /api/notification-charges | List saved charges |
| GET    | /api/notification-charges/summary | Total charges for a date range |
| GET    | /api/notification-charges/:id | Single charge |
| PATCH  | /api/notification-charges/:id | Fix amount/merchant after failed parse |
| DELETE | /api/notification-charges/:id | Delete a charge |

**POST /api/notification-charges body:**
```json
{
  "title": "Chase",
  "body": "You spent $45.67 at STARBUCKS on 07/20.",
  "source_app": "Chase",
  "notification_id": "optional-ios-id-for-dedup"
}
```

The backend parses amount and merchant from the notification text automatically.
Send `amount` and/or `merchant_name` to override parsing. Amounts are stored as
negative numbers (expenses), matching the transactions table.

---

## iOS Bank Notification Capture

iOS does not let third-party apps read other apps' notifications in the background.
Use one of these flows to forward bank alerts to this API:

### Option A — iOS Shortcuts (recommended, no app code)

1. Open **Shortcuts → Automation → + → Personal Automation**
2. Choose **Notification** → select your bank app (e.g. Chase)
3. Add action **Get Contents of Notification**
4. Add action **Get contents of URL** (POST):
   - URL: `https://your-api.com/api/notification-charges`
   - Method: POST
   - Headers: `Authorization: Bearer <supabase-jwt>`, `Content-Type: application/json`
   - Request Body (JSON):
     ```json
     {
       "title": "[Notification Title]",
       "body": "[Notification Body]",
       "source_app": "Chase"
     }
     ```

### Option B — BudgetMaster iOS app

Your app receives forwarded notification data (Share Sheet, manual paste, or a
Shortcut that opens your app with the payload) and POSTs to the same endpoint.

After you set up Supabase, run the updated `src/db/schema.sql` — it includes the
`notification_charges` table.

---

### Webhooks
| Method | Path | Description |
|--------|------|-------------|
| POST   | /webhooks/plaid | Plaid event receiver (no auth) |

---

## Adding Push Notifications

The `sendPushNotification()` function in `src/webhooks/plaid.js` is a stub.
To wire it up with **Expo**:

```bash
npm install expo-server-sdk
```

```js
// In src/webhooks/plaid.js
const { Expo } = require('expo-server-sdk');
const expo = new Expo();

async function sendPushNotification(userId, { title, body, data }) {
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId);

  const messages = tokens
    .filter(t => Expo.isExpoPushToken(t.token))
    .map(t => ({ to: t.token, sound: 'default', title, body, data }));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    await expo.sendPushNotificationsAsync(chunk);
  }
}
```

---

## Production Checklist

- [ ] Encrypt `plaid_access_token` at rest (AWS KMS, HashiCorp Vault, or Supabase Vault)
- [ ] Verify Plaid webhook signatures (`plaid-verification` header)
- [ ] Add HTTPS / TLS termination (nginx, Caddy, or your cloud provider)
- [ ] Set `NODE_ENV=production`
- [ ] Restrict `ALLOWED_ORIGINS` to your frontend domain
- [ ] Set up database backups in Supabase
- [ ] Switch Plaid to `development` / `production` and update secrets
- [ ] Deploy to Railway, Render, Fly.io, or your own VPS
- [ ] Point your Plaid webhook URL to the production URL

---

## File Structure

```
budget-backend/
├── src/
│   ├── index.js              ← Express app entry point
│   ├── routes/
│   │   ├── auth.js
│   │   ├── plaid.js
│   │   ├── accounts.js
│   │   ├── transactions.js
│   │   ├── budgets.js
│   │   ├── categories.js
│   │   └── notificationCharges.js
│   ├── services/
│   │   ├── plaidService.js   ← all Plaid API calls
│   │   └── cronJobs.js       ← nightly sync + budget alerts
│   ├── webhooks/
│   │   └── plaid.js          ← webhook handler (background notifications)
│   ├── middleware/
│   │   ├── auth.js           ← JWT verification
│   │   └── errorHandler.js
│   ├── db/
│   │   └── schema.sql        ← run this in Supabase SQL editor
│   └── utils/
│       ├── logger.js
│       └── notificationParser.js  ← parses bank push notification text
├── config/
│   ├── supabase.js
│   └── plaid.js
├── .env.example
└── package.json
```
