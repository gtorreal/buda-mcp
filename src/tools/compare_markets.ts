import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import { validateCurrency } from "../validation.js";
import type { AllTickersResponse } from "../types.js";

export const toolSchema = {
  name: "compare_markets",
  description:
    "Returns side-by-side ticker data for all trading pairs of a given base currency across Buda.com's " +
    "supported quote currencies (CLP, COP, PEN, BTC, USDC, ETH). All prices are floats; " +
    "price_change_24h and price_change_7d are floats in percent (e.g. 1.23 means +1.23%). " +
    "Example: 'In which country is Bitcoin currently most expensive on Buda?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      base_currency: {
        type: "string",
        description:
          "Base currency to compare across all available markets (e.g. 'BTC', 'ETH', 'XRP').",
      },
    },
    required: ["base_currency"],
  },
};

export async function handleCompareMarkets(
  args: { base_currency: string },
  client: BudaClient,
  cache: MemoryCache,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { base_currency } = args;

  const currencyError = validateCurrency(base_currency);
  if (currencyError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: currencyError, code: "INVALID_CURRENCY" }) }],
      isError: true,
    };
  }

  try {
    const base = base_currency.toUpperCase();
    const data = await cache.getOrFetch<AllTickersResponse>(
      "tickers:all",
      CACHE_TTL.TICKER,
      () => client.get<AllTickersResponse>("/tickers"),
    );

    const matching = data.tickers.filter((t) => {
      const [tickerBase] = t.market_id.split("-");
      return tickerBase === base;
    });

    if (matching.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: `No markets found for base currency '${base}'.`,
              code: "NOT_FOUND",
            }),
          },
        ],
        isError: true,
      };
    }

    const result = {
      base_currency: base,
      markets: matching.map((t) => ({
        market_id: t.market_id,
        last_price: parseFloat(t.last_price[0]),
        last_price_currency: t.last_price[1],
        best_bid: t.max_bid ? parseFloat(t.max_bid[0]) : null,
        best_ask: t.min_ask ? parseFloat(t.min_ask[0]) : null,
        volume_24h: t.volume ? parseFloat(t.volume[0]) : null,
        price_change_24h: t.price_variation_24h
          ? parseFloat((parseFloat(t.price_variation_24h) * 100).toFixed(4))
          : null,
        price_change_7d: t.price_variation_7d
          ? parseFloat((parseFloat(t.price_variation_7d) * 100).toFixed(4))
          : null,
      })),
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
        .describe(
          "Base currency to compare across all available markets (e.g. 'BTC', 'ETH', 'XRP').",
        ),
    },
    (args) => handleCompareMarkets(args, client, cache),
  );
}
