const MARKET_ID_RE = /^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/i;

/**
 * Validates a market ID against the expected BASE-QUOTE format.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateMarketId(id: string): string | null {
  if (!MARKET_ID_RE.test(id)) {
    return (
      `Invalid market ID. ` +
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
      `Invalid currency. ` +
      `Expected 2–10 alphanumeric characters (e.g. "BTC", "CLP", "USDC").`
    );
  }
  return null;
}
