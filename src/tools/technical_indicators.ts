import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaApiError, BudaClient, formatApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import { aggregateTradesToCandles } from "../utils.js";
import type { TradesResponse } from "../types.js";

export const toolSchema = {
  name: "get_technical_indicators",
  description:
    "Computes RSI (14), MACD (12/26/9), Bollinger Bands (20, 2σ), SMA 20, and SMA 50 " +
    "from Buda trade history — no external data or libraries. " +
    "Supports periods: 5m, 15m, 30m, 1h, 4h, 1d. Use shorter periods (5m/15m) for intraday analysis. " +
    "Uses at least 500 trades for reliable results (set limit=1000 for maximum depth). " +
    "Returns latest indicator values and signal interpretations (overbought/oversold, crossover, band position). " +
    "If fewer than 20 candles are available after aggregation, returns a structured warning instead. " +
    "Example: 'Is BTC-CLP RSI overbought on the 4-hour chart?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      period: {
        type: "string",
        description: "Candle period: '5m', '15m', '30m', '1h', '4h', or '1d'. Default: '1h'.",
      },
      limit: {
        type: "number",
        description:
          "Number of raw trades to fetch (default: 500, max: 1000). " +
          "More trades = more candles = more reliable indicators.",
      },
    },
    required: ["market_id"],
  },
};

// ---- Pure math helpers ----

function sma(values: number[], n: number): number {
  const slice = values.slice(-n);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Seed with SMA of first `period` values
  result.push(values.slice(0, period).reduce((s, v) => s + v, 0) / period);
  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function rsi(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  // Use simple average for initial, then Wilder's smoothing
  let avgGain = gains.slice(0, period).reduce((s, v) => s + v, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

interface MacdResult {
  line: number;
  signal: number;
  histogram: number;
  prev_histogram: number | null;
}

function macd(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9,
): MacdResult | null {
  if (closes.length < slow + signalPeriod) return null;
  const ema12 = ema(closes, fast);
  const ema26 = ema(closes, slow);
  // Align: ema26 starts at index (slow-1) of closes; ema12 starts at index (fast-1)
  // The MACD line length = ema26.length (shorter)
  const offset = slow - fast;
  const macdLine: number[] = ema26.map((e26, i) => ema12[i + offset] - e26);
  const signalLine = ema(macdLine, signalPeriod);
  if (signalLine.length === 0) return null;
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const histogram = lastMacd - lastSignal;
  const prevHistogram =
    macdLine.length > 1 && signalLine.length > 1
      ? macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2]
      : null;
  return {
    line: parseFloat(lastMacd.toFixed(2)),
    signal: parseFloat(lastSignal.toFixed(2)),
    histogram: parseFloat(histogram.toFixed(2)),
    prev_histogram: prevHistogram !== null ? parseFloat(prevHistogram.toFixed(2)) : null,
  };
}

interface BollingerResult {
  upper: number;
  mid: number;
  lower: number;
}

function bollingerBands(closes: number[], period: number = 20, stdMult: number = 2): BollingerResult | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mid = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: parseFloat((mid + stdMult * std).toFixed(2)),
    mid: parseFloat(mid.toFixed(2)),
    lower: parseFloat((mid - stdMult * std).toFixed(2)),
  };
}

// ---- Tool handler ----

const MIN_CANDLES = 20;

type TechnicalIndicatorsArgs = {
  market_id: string;
  period: "5m" | "15m" | "30m" | "1h" | "4h" | "1d";
  limit?: number;
};

export async function handleTechnicalIndicators(
  args: TechnicalIndicatorsArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { market_id, period, limit } = args;

  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  try {
    const id = market_id.toLowerCase();
    const tradesLimit = Math.max(limit ?? 500, 500);

    const data = await client.get<TradesResponse>(
      `/markets/${id}/trades`,
      { limit: tradesLimit },
    );

    const candles = aggregateTradesToCandles(data.trades.entries, period);
    const closes = candles.map((c) => c.close);

    if (candles.length < MIN_CANDLES) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              market_id: market_id.toUpperCase(),
              period,
              indicators: null,
              warning: "insufficient_data",
              candles_available: candles.length,
              minimum_required: MIN_CANDLES,
            }),
          },
        ],
      };
    }

    const rsiValue = rsi(closes, 14);
    const macdResult = macd(closes, 12, 26, 9);
    const bbResult = bollingerBands(closes, 20, 2);
    const sma20 = parseFloat(sma(closes, 20).toFixed(2));
    const sma50 = closes.length >= 50 ? parseFloat(sma(closes, 50).toFixed(2)) : null;
    const lastClose = closes[closes.length - 1];

    // Signal interpretations
    const rsiSignal: "overbought" | "oversold" | "neutral" =
      rsiValue !== null && rsiValue > 70
        ? "overbought"
        : rsiValue !== null && rsiValue < 30
          ? "oversold"
          : "neutral";

    let macdSignal: "bullish_crossover" | "bearish_crossover" | "neutral" = "neutral";
    if (macdResult && macdResult.prev_histogram !== null) {
      if (macdResult.histogram > 0 && macdResult.prev_histogram <= 0) {
        macdSignal = "bullish_crossover";
      } else if (macdResult.histogram < 0 && macdResult.prev_histogram >= 0) {
        macdSignal = "bearish_crossover";
      }
    }

    const bbSignal: "above_upper" | "below_lower" | "within_bands" =
      bbResult && lastClose > bbResult.upper
        ? "above_upper"
        : bbResult && lastClose < bbResult.lower
          ? "below_lower"
          : "within_bands";

    const result = {
      market_id: market_id.toUpperCase(),
      period,
      candles_used: candles.length,
      indicators: {
        rsi: rsiValue,
        macd: macdResult
          ? { line: macdResult.line, signal: macdResult.signal, histogram: macdResult.histogram }
          : null,
        bollinger_bands: bbResult,
        sma_20: sma20,
        sma_50: sma50,
        sma_50_warning: sma50 === null ? `insufficient data (need 50 candles, have ${closes.length})` : undefined,
      },
      signals: {
        rsi_signal: rsiSignal,
        macd_signal: macdSignal,
        bb_signal: bbSignal,
      },
      disclaimer:
        "Technical indicators are computed from Buda trade history. Not investment advice.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg = formatApiError(err);
    return {
      content: [{ type: "text", text: JSON.stringify(msg) }],
      isError: true,
    };
  }
}

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      period: z
        .enum(["5m", "15m", "30m", "1h", "4h", "1d"])
        .default("1h")
        .describe("Candle period: '5m', '15m', '30m', '1h', '4h', or '1d'. Default: '1h'."),
      limit: z
        .number()
        .int()
        .min(500)
        .max(1000)
        .optional()
        .describe(
          "Number of raw trades to fetch (default: 500, max: 1000). " +
            "More trades = more candles = more reliable indicators.",
        ),
    },
    (args) => handleTechnicalIndicators(args, client),
  );
}
