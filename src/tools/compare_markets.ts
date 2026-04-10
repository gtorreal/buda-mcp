import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import type { AllTickersResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    "compare_markets",
    "Compare ticker data for all trading pairs of a given base currency across Buda.com's " +
      "supported quote currencies (CLP, COP, PEN, BTC, USDC, ETH). " +
      "For example, passing 'BTC' returns side-by-side data for BTC-CLP, BTC-COP, BTC-PEN, etc.",
    {
      base_currency: z
        .string()
        .describe(
          "Base currency to compare across all available markets (e.g. 'BTC', 'ETH', 'XRP').",
        ),
    },
    async ({ base_currency }) => {
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
            last_price: t.last_price[0],
            currency: t.last_price[1],
            best_bid: t.max_bid ? t.max_bid[0] : null,
            best_ask: t.min_ask ? t.min_ask[0] : null,
            volume_24h: t.volume ? t.volume[0] : null,
            price_change_24h: t.price_variation_24h
              ? (parseFloat(t.price_variation_24h) * 100).toFixed(2) + "%"
              : null,
            price_change_7d: t.price_variation_7d
              ? (parseFloat(t.price_variation_7d) * 100).toFixed(2) + "%"
              : null,
          })),
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
