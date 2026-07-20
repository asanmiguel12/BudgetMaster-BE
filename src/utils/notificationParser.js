/**
 * Extracts charge amount and merchant from iOS bank push notification text.
 * Handles common US bank formats (Chase, BofA, Wells Fargo, Amex, etc.).
 */

const AMOUNT_PATTERNS = [
  /\$\s*([\d,]+\.\d{2})/,
  /USD\s*([\d,]+\.\d{2})/i,
  /([\d,]+\.\d{2})\s*USD/i,
  /(?:charged|spent|debited|purchase(?:d)?|payment|withdrawal|transaction)\s*(?:of\s*)?\$?\s*([\d,]+\.\d{2})/i,
  /\$?\s*([\d,]+\.\d{2})\s*(?:was|has been)\s*(?:charged|debited|spent)/i
];

const MERCHANT_PATTERNS = [
  /\bat\s+(.+?)(?:\.|$|\son\s|\d)/i,
  /\bfrom\s+(.+?)(?:\.|$|\son\s|\bwas\b|\d)/i,
  /\bto\s+(.+?)(?:\.|$|\son\s|\d)/i,
  /\bpurchase\s+(?:at|from)\s+(.+?)(?:\.|$|\bwas\b)/i,
  /\bmerchant[:\s]+(.+?)(?:\.|$)/i
];

const DATE_PATTERNS = [
  /\bon\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?)/i
];

function parseAmount(raw) {
  if (raw == null || raw === '') return null;

  const text = String(raw);
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!Number.isNaN(value) && value > 0) {
        return -value; // negative = expense (matches transactions convention)
      }
    }
  }
  return null;
}

function parseMerchant(raw) {
  if (!raw) return null;

  const text = String(raw).trim();
  for (const pattern of MERCHANT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const merchant = match[1].trim().replace(/\s+/g, ' ');
      if (merchant.length >= 2 && merchant.length <= 120) {
        return merchant;
      }
    }
  }
  return null;
}

function parseDate(raw) {
  if (!raw) return null;

  const text = String(raw);
  const now = new Date();

  const slashMatch = text.match(/\bon\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day   = parseInt(slashMatch[2], 10);
    let year    = slashMatch[3] ? parseInt(slashMatch[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const parsed = new Date(match[1]);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

/**
 * @param {{ title?: string, body?: string, amount?: number }} input
 * @returns {{ amount: number|null, merchant_name: string|null, charged_at: string|null, parse_status: string }}
 */
function parseBankNotification({ title = '', body = '', amount } = {}) {
  const combined = [title, body].filter(Boolean).join(' ').trim();

  let parsedAmount = amount != null ? -Math.abs(Number(amount)) : null;
  if (parsedAmount != null && Number.isNaN(parsedAmount)) {
    parsedAmount = null;
  }

  if (parsedAmount == null) {
    parsedAmount = parseAmount(combined);
  }

  const merchant_name = parseMerchant(combined);
  const charged_at = parseDate(combined);

  let parse_status = 'failed';
  if (parsedAmount != null && merchant_name) {
    parse_status = 'parsed';
  } else if (parsedAmount != null || merchant_name) {
    parse_status = 'partial';
  }

  return {
    amount: parsedAmount,
    merchant_name,
    charged_at: charged_at || new Date().toISOString().slice(0, 10),
    parse_status
  };
}

module.exports = { parseBankNotification, parseAmount, parseMerchant };
