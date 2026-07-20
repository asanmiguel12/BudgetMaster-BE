const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const ENV_MAP = {
  sandbox:     PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production:  PlaidEnvironments.production
};

const plaidEnv = process.env.PLAID_ENV || 'sandbox';

const configuration = new Configuration({
  basePath: ENV_MAP[plaidEnv] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET':    process.env.PLAID_SECRET
    }
  }
});

const plaidClient = new PlaidApi(configuration);

module.exports = { plaidClient };
