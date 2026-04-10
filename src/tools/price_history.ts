import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache } from "../cache.js";
import type { TradesResponse } from "../types.js";

const PERIOD_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

interface OhlcvCandle {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trade_count: number;
}

export function register(server: McpServer, client: BudaClient, _cache: MemoryCache): void {
  server.tool(
    "get_price_history",
    "Get OHLCV (open/high/low/close/volume) price history for a Buda.com market, derived from " +
      "recent trade history (up to 100 trades). Buda does not provide a native candlestick endpoint; " +
      "candles are aggregated client-side from raw trades. Use the 'period' parameter to control " +
      "candle size (1h, 4h, or 1d).",
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      period: z
        .enum(["1h", "4h", "1d"])
        .default("1h")
        .describe("Candle period: '1h' (1 hour), '4h' (4 hours), or '1d' (1 day). Default: '1h'."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of raw trades to fetch before aggregation (default: 100, max: 100)."),
    },
    async ({ market_id, period, limit }) => {
      try {
        const id = market_id.toLowerCase();
        const tradesLimit = limit ?? 100;

        const data = await client.get<TradesResponse>(
          `/markets/${id}/trades`,
          { limit: tradesLimit },
        );

        const entries = data.trades.entries;
        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ market_id: market_id.toUpperCase(), period, candles: [] }),
              },
            ],
          };
        }

        // Buda returns trades newest-first; sort ascending so open = first chronological price
        // and close = last chronological price within each candle bucket.
        const sortedEntries = [...entries].sort(
          ([a], [b]) => parseInt(a, 10) - parseInt(b, 10),
        );

        const periodMs = PERIOD_MS[period];
        const buckets = new Map<number, OhlcvCandle>();

        for (const [tsMs, amount, price, _direction] of sortedEntries) {
          const ts = parseInt(tsMs, 10);
          const bucketStart = Math.floor(ts / periodMs) * periodMs;
          const p = parseFloat(price);
          const v = parseFloat(amount);

          if (!buckets.has(bucketStart)) {
            buckets.set(bucketStart, {
              time: new Date(bucketStart).toISOString(),
              open: price,
              high: price,
              low: price,
              close: price,
              volume: amount,
              trade_count: 1,
            });
          } else {
            const candle = buckets.get(bucketStart)!;
            if (p > parseFloat(candle.high)) candle.high = price;
            if (p < parseFloat(candle.low)) candle.low = price;
            candle.close = price;
            candle.volume = (parseFloat(candle.volume) + v).toFixed(8);
            candle.trade_count++;
          }
        }

        const candles = Array.from(buckets.entries())
          .sort(([a], [b]) => a - b)
          .map(([, candle]) => candle);

        const result = {
          market_id: market_id.toUpperCase(),
          period,
          candle_count: candles.length,
          note: "Candles derived from trade history (up to 100 trades). For deeper history, use pagination via the get_trades tool.",
          candles,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg =
          err instanceof BudaApiError
            ? { error: err.message, code: err.status, path: err.path }
            : { error: String(err), code: "UNKNOWN" };
        return {
          content: [{ type: "text", text: JSON.stringify(msg) }],
          isError: true,
        };
      }
    },
  );
}
