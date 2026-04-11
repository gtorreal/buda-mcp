import { timingSafeEqual } from "crypto";
import type { Amount, OhlcvCandle } from "./types.js";

/**
 * Constant-time string comparison to prevent timing attacks on bearer tokens.
 * Both strings are written into equal-length buffers before comparing so that
 * neither token length nor content can be inferred from execution time.
 */
export function safeTokenEqual(a: string, b: string): boolean {
  const aByteLen = Buffer.byteLength(a);
  const bByteLen = Buffer.byteLength(b);
  const maxLen = Math.max(aByteLen, bByteLen);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  return timingSafeEqual(aBuf, bBuf) && aByteLen === bByteLen;
}

/**
 * Parses a raw string (from an environment variable) as an integer within [min, max].
 * Returns the fallback when raw is undefined.
 * Throws a descriptive Error if the value is non-numeric or out of range.
 */
export function parseEnvInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < min || n > max) {
    throw new Error(
      `[buda-mcp] Invalid ${name} "${raw}". Must be an integer between ${min} and ${max}.`,
    );
  }
  return n;
}

/**
 * Flattens a Buda API Amount tuple [value_string, currency] into a typed object.
 * All numeric strings are cast to float via parseFloat.
 */
export function flattenAmount(amount: Amount): { value: number; currency: string } {
  const value = parseFloat(amount[0]);
  if (isNaN(value)) throw new Error(`Invalid amount value: "${amount[0]}"`);
  return { value, currency: amount[1] };
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

const PERIOD_MS: Record<string, number> = {
  "5m":  5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h":  60 * 60 * 1000,
  "4h":  4 * 60 * 60 * 1000,
  "1d":  24 * 60 * 60 * 1000,
};

/**
 * Aggregates raw Buda trade entries (newest-first) into OHLCV candles for the given period.
 * Entries must be in the format [timestamp_ms, amount, price, direction].
 * Returns candles sorted ascending by bucket start time.
 */
export function aggregateTradesToCandles(
  entries: [string, string, string, string][],
  period: string,
): OhlcvCandle[] {
  const periodMs = PERIOD_MS[period];
  if (!periodMs) throw new Error(`Unknown period: ${period}`);

  const sorted = [...entries].sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
  const buckets = new Map<number, OhlcvCandle>();

  for (const [tsMs, amount, price] of sorted) {
    const ts = parseInt(tsMs, 10);
    const bucketStart = Math.floor(ts / periodMs) * periodMs;
    const p = parseFloat(price);
    const v = parseFloat(amount);

    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, {
        time: new Date(bucketStart).toISOString(),
        open: p,
        high: p,
        low: p,
        close: p,
        volume: v,
        trade_count: 1,
      });
    } else {
      const candle = buckets.get(bucketStart)!;
      if (p > candle.high) candle.high = p;
      if (p < candle.low) candle.low = p;
      candle.close = p;
      candle.volume = parseFloat((candle.volume + v).toFixed(8));
      candle.trade_count++;
    }
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([, candle]) => candle);
}
