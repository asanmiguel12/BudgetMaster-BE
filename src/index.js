require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const os         = require('os');

const logger     = require('./utils/logger');
const { validateEnv } = require('./config/env');
const { testConnection } = require('../config/supabase');
const { testDatabaseConnection, ensureFrontendSchema } = require('../config/database');
const { startCronJobs }  = require('./services/cronJobs');
const { errorHandler }   = require('./middleware/errorHandler');

// ── Routes ──────────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const plaidRoutes        = require('./routes/plaid');
const accountsRoutes     = require('./routes/accounts');
const transactionsRoutes = require('./routes/transactions');
const spendingBudgetsRoutes = require('./routes/budgets');
const categoriesRoutes   = require('./routes/categories');
const notificationChargesRoutes = require('./routes/notificationCharges');
const appBudgetsRoutes   = require('./routes/appBudgets');
const appUsersRoutes     = require('./routes/appUsers');

// ── Webhooks (no auth middleware — Plaid calls these) ────────
const { plaidWebhookHandler } = require('./webhooks/plaid');

const config = validateEnv();
const app  = express();
const PORT = config.port;
const HOST = process.env.HOST || '0.0.0.0';

const defaultOrigins = [
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
];

// ── Security & logging ───────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean)
    || defaultOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'Accept'],
}));
app.use(morgan('combined', {
  stream: { write: msg => logger.info(msg.trim()) }
}));

// ── Rate limiting ────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 100,
  message:  { error: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

// ── Raw body for webhook signature verification ──────────────
app.post('/webhooks/plaid',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.body = JSON.parse(req.body.toString());
    }
    next();
  },
  plaidWebhookHandler
);

// ── JSON body parser ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Health & API info ────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    authReady: config.authReady,
  })
);

app.get('/api', (req, res) => {
  res.json({
    name: 'BudgetMaster API',
    version: '1.0.0',
    auth: {
      jwt: 'Authorization: Bearer <supabase-access-token>',
      dev: 'X-User-Id: <client-user-id> (development)',
    },
    routes: {
      frontend: ['/api/budgets'],
      spending: ['/api/spending-budgets', '/api/transactions', '/api/accounts'],
      plaid: ['/api/plaid'],
      auth: ['/api/auth/me'],
      notifications: ['/api/notification-charges'],
    },
  });
});

// ── API Routes ───────────────────────────────────────────────
app.use('/api/budgets', appBudgetsRoutes);
app.use('/api/users', appUsersRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/plaid',        plaidRoutes);
app.use('/api/accounts',     accountsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/spending-budgets', spendingBudgetsRoutes);
app.use('/api/categories',   categoriesRoutes);
app.use('/api/notification-charges', notificationChargesRoutes);

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ─────────────────────────────────────
app.use(errorHandler);

function getLanAddress() {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

// ── Start ────────────────────────────────────────────────────
async function start() {
  if (config.warnings.length) {
    logger.warn(`Optional env vars missing: ${config.warnings.join(', ')}`);
  }

  await testDatabaseConnection();
  logger.info('PostgreSQL connected');

  await ensureFrontendSchema();
  logger.info('Frontend schema ready');

  await testConnection();
  startCronJobs();

  app.listen(PORT, HOST, () => {
    const lan = getLanAddress();
    logger.info(`Budget API running on port ${PORT} [${config.nodeEnv}]`);
    logger.info(`  Local:   http://localhost:${PORT}`);
    if (lan) logger.info(`  Network: http://${lan}:${PORT} (physical device)`);
    logger.info('Frontend routes: GET/PUT/POST /api/budgets (X-User-Id or Bearer JWT)');
    logger.info('Spending routes: /api/spending-budgets, /api/transactions, /api/plaid');
  });
}

start().catch(err => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

module.exports = app;
