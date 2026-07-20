require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const logger     = require('./utils/logger');
const { testConnection } = require('../config/supabase');
const { startCronJobs }  = require('./services/cronJobs');
const { errorHandler }   = require('./middleware/errorHandler');

// ── Routes ──────────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const plaidRoutes        = require('./routes/plaid');
const accountsRoutes     = require('./routes/accounts');
const transactionsRoutes = require('./routes/transactions');
const budgetsRoutes      = require('./routes/budgets');
const categoriesRoutes   = require('./routes/categories');

// ── Webhooks (no auth middleware — Plaid calls these) ────────
const { plaidWebhookHandler } = require('./webhooks/plaid');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & logging ───────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
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
// Must come BEFORE express.json() for the webhook route
app.post('/webhooks/plaid',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    // Parse after capturing raw body
    if (Buffer.isBuffer(req.body)) {
      req.body = JSON.parse(req.body.toString());
    }
    next();
  },
  plaidWebhookHandler
);

// ── JSON body parser ─────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── API Routes ───────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/plaid',        plaidRoutes);
app.use('/api/accounts',     accountsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/budgets',      budgetsRoutes);
app.use('/api/categories',   categoriesRoutes);

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ─────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────
async function start() {
  await testConnection();
  startCronJobs();

  app.listen(PORT, () => {
    logger.info(`Budget API running on port ${PORT} [${process.env.NODE_ENV}]`);
    logger.info('Routes:');
    logger.info('  POST /webhooks/plaid');
    logger.info('  GET  /health');
    logger.info('  /api/auth, /api/plaid, /api/accounts, /api/transactions, /api/budgets, /api/categories');
  });
}

start().catch(err => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

module.exports = app;
