import type { Amount } from "./types.js";

/**
 * Flattens a Buda API Amount tuple [value_string, currency] into a typed object.
 * All numeric strings are cast to float via parseFloat.
 */
export function flattenAmount(amount: Amount): { value: number; currency: string } {
  return { value: parseFloat(amount[0]), currency: amount[1] };
}

/**
 * Returns a liquidity rating based on the bid/ask spread percentage.
 * < 0.3%  → "high"
 * 0.3–1%  → "medium"
 * > 1%    → "low"
 */
export function getLiquidityRating(spreadPct: number): "high" | "medium" | "low" {
  if (spreadPct < 0.3) return "high";
  if (spreadPct <= 1.0) return "medium";
  return "low";
}
