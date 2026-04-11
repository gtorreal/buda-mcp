import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import type { AllTickersResponse, Ticker } from "../types.js";

export const toolSchema = {
  name: "get_arbitrage_opportunities",
  description:
    "Detects cross-country price discrepancies for a given asset across Buda's CLP, COP, and PEN markets, " +
    "normalized to USDC. Fetches all relevant tickers, converts each local price to USDC using the " +
    "current USDC-CLP / USDC-COP / USDC-PEN rates, then computes pairwise discrepancy percentages. " +
    "Results above threshold_pct are returned sorted by opportunity size. Note: Buda taker fee is 0.8% " +
    "per leg (~1.6% round-trip) — always deduct fees before acting on any discrepancy. " +
    "Example: 'Is there an arbitrage opportunity for BTC between Chile and Peru right now?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      base_currency: {
        type: "string",
        description: "Base asset to scan (e.g. 'BTC', 'ETH', 'XRP').",
      },
      threshold_pct: {
        type: "number",
        description:
          "Minimum price discrepancy percentage to include in results (default: 0.5). " +
          "Buda taker fee is 0.8% per leg, so a round-trip requires > 1.6% to be profitable.",
      },
    },
    required: ["base_currency"],
  },
};

interface ArbitrageOpportunity {
  market_a: string;
  market_b: string;
  price_a_usdc: number;
  price_b_usdc: number;
  discrepancy_pct: number;
  higher_market: string;
  lower_market: string;
}

interface ArbitrageInput {
  base_currency: string;
  threshold_pct?: number;
}

export async function handleArbitrageOpportunities(
  { base_currency, threshold_pct = 0.5 }: ArbitrageInput,
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const base = base_currency.toUpperCase();
    const data = await cache.getOrFetch<AllTickersResponse>(
      "tickers:all",
      CACHE_TTL.TICKER,
      () => client.get<AllTickersResponse>("/tickers"),
    );

    const tickerMap = new Map<string, Ticker>();
    for (const t of data.tickers) {
      tickerMap.set(t.market_id, t);
    }

    // Find USDC conversion rates for each fiat currency
    const usdcClpTicker = tickerMap.get("USDC-CLP");
    const usdcCopTicker = tickerMap.get("USDC-COP");
    const usdcPenTicker = tickerMap.get("USDC-PEN");

    // Build list of markets for the requested base currency with USDC-normalized prices
    interface MarketPrice {
      market_id: string;
      local_price: number;
      usdc_rate: number;
      price_usdc: number;
    }

    const marketPrices: MarketPrice[] = [];

    const candidates: Array<{ suffix: string; usdcTicker: Ticker | undefined }> = [
      { suffix: "CLP", usdcTicker: usdcClpTicker },
      { suffix: "COP", usdcTicker: usdcCopTicker },
      { suffix: "PEN", usdcTicker: usdcPenTicker },
    ];

    for (const { suffix, usdcTicker } of candidates) {
      const marketId = `${base}-${suffix}`;
      const baseTicker = tickerMap.get(marketId);

      if (!baseTicker || !usdcTicker) continue;

      const localPrice = parseFloat(baseTicker.last_price[0]);
      const usdcRate = parseFloat(usdcTicker.last_price[0]);

      if (isNaN(localPrice) || isNaN(usdcRate) || usdcRate === 0) continue;

      marketPrices.push({
        market_id: marketId,
        local_price: localPrice,
        usdc_rate: usdcRate,
        price_usdc: localPrice / usdcRate,
      });
    }

    if (marketPrices.length < 2) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `Not enough markets found for base currency '${base}' to compute arbitrage. ` +
                `Need at least 2 of: ${base}-CLP, ${base}-COP, ${base}-PEN with USDC rates available.`,
              code: "INSUFFICIENT_MARKETS",
            }),
          },
        ],
        isError: true,
      };
    }

    // Compute all pairwise discrepancies
    const opportunities: ArbitrageOpportunity[] = [];

    for (let i = 0; i < marketPrices.length; i++) {
      for (let j = i + 1; j < marketPrices.length; j++) {
        const a = marketPrices[i];
        const b = marketPrices[j];
        const minPrice = Math.min(a.price_usdc, b.price_usdc);
        const discrepancyPct = (Math.abs(a.price_usdc - b.price_usdc) / minPrice) * 100;

        if (discrepancyPct < threshold_pct) continue;

        const higherMarket = a.price_usdc > b.price_usdc ? a.market_id : b.market_id;
        const lowerMarket = a.price_usdc < b.price_usdc ? a.market_id : b.market_id;

        opportunities.push({
          market_a: a.market_id,
          market_b: b.market_id,
          price_a_usdc: parseFloat(a.price_usdc.toFixed(4)),
          price_b_usdc: parseFloat(b.price_usdc.toFixed(4)),
          discrepancy_pct: parseFloat(discrepancyPct.toFixed(4)),
          higher_market: higherMarket,
          lower_market: lowerMarket,
        });
      }
    }

    opportunities.sort((a, b) => b.discrepancy_pct - a.discrepancy_pct);

    const result = {
      base_currency: base,
      threshold_pct,
      markets_analyzed: marketPrices.map((m) => ({
        market_id: m.market_id,
        price_usdc: parseFloat(m.price_usdc.toFixed(4)),
        local_price: m.local_price,
        usdc_rate: m.usdc_rate,
      })),
      opportunities_found: opportunities.length,
      opportunities,
      fees_note:
        "Buda taker fee is 0.8% per leg. A round-trip arbitrage (buy on one market, sell on another) " +
        "costs approximately 1.6% in fees. Only discrepancies well above 1.6% are likely profitable.",
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const msg =
      err instanceof BudaApiError
        ? { error: err.message, code: err.status }
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
      base_currency: z
        .string()
        .describe("Base asset to scan (e.g. 'BTC', 'ETH', 'XRP')."),
      threshold_pct: z
        .number()
        .min(0)
        .default(0.5)
        .describe(
          "Minimum price discrepancy percentage to include in results (default: 0.5). " +
            "Buda taker fee is 0.8% per leg, so a round-trip requires > 1.6% to be profitable.",
        ),
    },
    (args) => handleArbitrageOpportunities(args, client, cache),
  );
}
