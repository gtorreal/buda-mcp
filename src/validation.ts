const MARKET_ID_RE = /^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i;

/**
 * Validates a market ID against the expected BASE-QUOTE format.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateMarketId(id: string): string | null {
  if (!MARKET_ID_RE.test(id)) {
    return (
      `Invalid market ID "${id}". ` +
      `Expected format: BASE-QUOTE with 2–10 alphanumeric characters per part ` +
      `(e.g. "BTC-CLP", "ETH-BTC").`
    );
  }
  return null;
}

const CURRENCY_RE = /^[A-Z0-9]{2,10}$/i;

/**
 * Validates a currency code (e.g. "BTC", "CLP", "USDC").
 * Returns an error message string if invalid, or null if valid.
 */
export function validateCurrency(id: string): string | null {
  if (!CURRENCY_RE.test(id)) {
    return (
      `Invalid currency "${id}". ` +
      `Expected 2–10 alphanumeric characters (e.g. "BTC", "CLP", "USDC").`
    );
  }
  return null;
}

// Per-currency address format rules.
// Unknown currencies pass through (undefined rule) — the exchange validates those.
const ADDRESS_RULES: Record<string, RegExp> = {
  BTC:  /^(bc1[a-z0-9]{6,87}|[13][a-zA-HJ-NP-Z0-9]{25,34})$/,
  ETH:  /^0x[0-9a-fA-F]{40}$/,
  USDC: /^0x[0-9a-fA-F]{40}$/,
  USDT: /^0x[0-9a-fA-F]{40}$/,
  LTC:  /^(ltc1[a-z0-9]{6,87}|[LM3][a-zA-HJ-NP-Z0-9]{25,34})$/,
  BCH:  /^(bitcoincash:)?[qp][a-z0-9]{41}$/,
  XRP:  /^r[1-9A-HJ-NP-Za-km-z]{24,33}$/,
};

/**
 * Validates a crypto withdrawal address against known per-currency formats.
 * Returns an error message string if the address is invalid, or null if valid
 * (including null for unknown currencies, where the exchange is the last line of defence).
 */
export function validateCryptoAddress(address: string, currency: string): string | null {
  const rule = ADDRESS_RULES[currency.toUpperCase()];
  if (!rule) return null;
  if (!rule.test(address)) {
    return (
      `Invalid ${currency.toUpperCase()} address format. ` +
      `Double-check the destination address — crypto withdrawals are irreversible.`
    );
  }
  return null;
}
