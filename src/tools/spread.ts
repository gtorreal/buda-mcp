import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { MemoryCache, CACHE_TTL } from "../cache.js";
import type { TickerResponse } from "../types.js";

export function register(server: McpServer, client: BudaClient, cache: MemoryCache): void {
  server.tool(
    "get_spread",
    "Calculate the bid/ask spread for a Buda.com market. " +
      "Returns the best bid, best ask, absolute spread, and spread as a percentage of the ask price.",
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-BTC', 'BTC-COP')."),
    },
    async ({ market_id }) => {
      try {
        const id = market_id.toLowerCase();
        const data = await cache.getOrFetch<TickerResponse>(
          `ticker:${id}`,
          CACHE_TTL.TICKER,
          () => client.get<TickerResponse>(`/markets/${id}/ticker`),
        );

        const ticker = data.ticker;
        const bid = parseFloat(ticker.max_bid[0]);
        const ask = parseFloat(ticker.min_ask[0]);
        const currency = ticker.max_bid[1];

        if (isNaN(bid) || isNaN(ask) || ask === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: "Unable to calculate spread: invalid bid/ask values" }),
              },
            ],
            isError: true,
          };
        }

        const spreadAbs = ask - bid;
        const spreadPct = (spreadAbs / ask) * 100;

        const result = {
          market_id: ticker.market_id,
          currency,
          best_bid: bid.toString(),
          best_ask: ask.toString(),
          spread_absolute: spreadAbs.toFixed(2),
          spread_percentage: spreadPct.toFixed(4) + "%",
          last_price: ticker.last_price[0],
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
