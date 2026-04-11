import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateMarketId } from "../validation.js";
import type { TickerResponse, MarketResponse } from "../types.js";

export const toolSchema = {
  name: "simulate_order",
  description:
    "Simulates a buy or sell order on Buda.com using live ticker data — no order is placed. " +
    "Returns estimated fill price, fee, total cost, and slippage vs mid-price. " +
    "Omit 'price' for a market order simulation; supply 'price' for a limit order simulation. " +
    "All outputs are labelled simulation: true — this tool never places a real order. " +
    "Example: 'How much would it cost to buy 0.01 BTC on BTC-CLP right now?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-BTC').",
      },
      side: {
        type: "string",
        description: "'buy' or 'sell'.",
      },
      amount: {
        type: "number",
        description: "Order size in base currency (e.g. BTC for BTC-CLP).",
      },
      price: {
        type: "number",
        description:
          "Limit price in quote currency. Omit for a market order simulation.",
      },
    },
    required: ["market_id", "side", "amount"],
  },
};

type SimulateOrderArgs = {
  market_id: string;
  side: "buy" | "sell";
  amount: number;
  price?: number;
};

export async function handleSimulateOrder(
  args: SimulateOrderArgs,
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { market_id, side, amount, price } = args;

  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  try {
    const id = market_id.toLowerCase();

    const [tickerData, marketData] = await Promise.all([
      cache.getOrFetch<TickerResponse>(
        `ticker:${id}`,
        CACHE_TTL.TICKER,
        () => client.get<TickerResponse>(`/markets/${id}/ticker`),
      ),
      cache.getOrFetch<MarketResponse>(
        `market:${id}`,
        CACHE_TTL.MARKETS,
        () => client.get<MarketResponse>(`/markets/${id}`),
      ),
    ]);

    const ticker = tickerData.ticker;
    const market = marketData.market;

    const minAsk = parseFloat(ticker.min_ask[0]);
    const maxBid = parseFloat(ticker.max_bid[0]);
    const quoteCurrency = ticker.min_ask[1];

    if (isNaN(minAsk) || isNaN(maxBid) || minAsk <= 0 || maxBid <= 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "Unable to simulate: invalid or zero bid/ask values in ticker.",
              code: "INVALID_TICKER",
            }),
          },
        ],
        isError: true,
      };
    }

    const mid = (minAsk + maxBid) / 2;
    const takerFeeRate = parseFloat(market.taker_fee);
    const orderTypeAssumed = price !== undefined ? "limit" : "market";

    let estimatedFillPrice: number;

    if (orderTypeAssumed === "market") {
      estimatedFillPrice = side === "buy" ? minAsk : maxBid;
    } else {
      // Limit order: fill at provided price if it crosses the spread, otherwise at limit price
      if (side === "buy") {
        estimatedFillPrice = price! >= minAsk ? minAsk : price!;
      } else {
        estimatedFillPrice = price! <= maxBid ? maxBid : price!;
      }
    }

    const grossValue = amount * estimatedFillPrice;
    const feeAmount = parseFloat((grossValue * takerFeeRate).toFixed(8));
    const totalCost = side === "buy"
      ? parseFloat((grossValue + feeAmount).toFixed(8))
      : parseFloat((grossValue - feeAmount).toFixed(8));

    const slippageVsMidPct = parseFloat(
      (((estimatedFillPrice - mid) / mid) * 100).toFixed(4),
    );

    const result = {
      simulation: true,
      market_id: ticker.market_id,
      side,
      amount,
      order_type_assumed: orderTypeAssumed,
      estimated_fill_price: parseFloat(estimatedFillPrice.toFixed(2)),
      price_currency: quoteCurrency,
      fee_amount: feeAmount,
      fee_currency: quoteCurrency,
      fee_rate_pct: parseFloat((takerFeeRate * 100).toFixed(3)),
      total_cost: totalCost,
      slippage_vs_mid_pct: slippageVsMidPct,
      mid_price: parseFloat(mid.toFixed(2)),
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
}

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC')."),
      side: z
        .enum(["buy", "sell"])
        .describe("'buy' or 'sell'."),
      amount: z
        .number()
        .positive()
        .describe("Order size in base currency (e.g. BTC for BTC-CLP)."),
      price: z
        .number()
        .positive()
        .optional()
        .describe("Limit price in quote currency. Omit for a market order simulation."),
    },
    (args) => handleSimulateOrder(args, client, cache),
  );
}
