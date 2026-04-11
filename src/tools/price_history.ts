import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { TradesResponse } from "../types.js";

const PERIOD_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

interface OhlcvCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trade_count: number;
}

export const toolSchema = {
  name: "get_price_history",
  description:
    "IMPORTANT: Candles are aggregated client-side from raw trades (Buda has no native candlestick " +
    "endpoint) — fetching more trades via the 'limit' parameter gives deeper history but slower " +
    "responses. Returns OHLCV candles (open/high/low/close as floats in quote currency; volume as float " +
    "in base currency) for periods 1h, 4h, or 1d. Candle timestamps are UTC bucket boundaries. " +
    "Example: 'Show me the hourly BTC-CLP price chart for the past 24 hours.'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      period: {
        type: "string",
        description: "Candle period: '1h' (1 hour), '4h' (4 hours), or '1d' (1 day). Default: '1h'.",
      },
      limit: {
        type: "number",
        description:
          "Raw trades to fetch before aggregation (default: 100, max: 1000). " +
          "More trades = deeper history but slower response.",
      },
    },
    required: ["market_id"],
  },
};

export function register(server: McpServer, client: BudaClient, _cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
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
        .max(1000)
        .optional()
        .describe(
          "Raw trades to fetch before aggregation (default: 100, max: 1000). " +
            "More trades = deeper history but slower response.",
        ),
    },
    async ({ market_id, period, limit }) => {
      try {
        const validationError = validateMarketId(market_id);
        if (validationError) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
            isError: true,
          };
        }

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

        const candles = Array.from(buckets.entries())
          .sort(([a], [b]) => a - b)
          .map(([, candle]) => candle);

        const result = {
          market_id: market_id.toUpperCase(),
          period,
          candle_count: candles.length,
          trades_fetched: entries.length,
          note:
            "Candles derived from raw trade history. Candle timestamps are UTC bucket boundaries. " +
            "Increase 'limit' (max 1000) for deeper history.",
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
