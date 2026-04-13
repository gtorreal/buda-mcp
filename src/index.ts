#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BudaClient } from "./client.js";
import { cache, CACHE_TTL } from "./cache.js";
import { VERSION } from "./version.js";
import { validateMarketId } from "./validation.js";
import type { MarketsResponse, TickerResponse } from "./types.js";
import * as markets from "./tools/markets.js";
import * as ticker from "./tools/ticker.js";
import * as orderbook from "./tools/orderbook.js";
import * as trades from "./tools/trades.js";
import * as volume from "./tools/volume.js";
import * as spread from "./tools/spread.js";
import * as compareMarkets from "./tools/compare_markets.js";
import * as priceHistory from "./tools/price_history.js";
import * as arbitrage from "./tools/arbitrage.js";
import * as marketSummary from "./tools/market_summary.js";
import * as simulateOrder from "./tools/simulate_order.js";
import * as positionSize from "./tools/calculate_position_size.js";
import * as marketSentiment from "./tools/market_sentiment.js";
import * as technicalIndicators from "./tools/technical_indicators.js";
import * as banks from "./tools/banks.js";
import * as quotation from "./tools/quotation.js";
import * as stableLiquidity from "./tools/stable_liquidity.js";
import { handleMarketSummary } from "./tools/market_summary.js";

const client = new BudaClient();

const server = new McpServer({
  name: "buda-mcp",
  version: VERSION,
});

markets.register(server, client, cache);
ticker.register(server, client, cache);
orderbook.register(server, client, cache);
trades.register(server, client, cache);
volume.register(server, client, cache);
spread.register(server, client, cache);
compareMarkets.register(server, client, cache);
priceHistory.register(server, client, cache);
arbitrage.register(server, client, cache);
marketSummary.register(server, client, cache);
simulateOrder.register(server, client, cache);
quotation.register(server, client);
positionSize.register(server);
marketSentiment.register(server, client, cache);
technicalIndicators.register(server, client);
banks.register(server, client, cache);
stableLiquidity.register(server, client, cache);

// MCP Resources
server.resource(
  "buda-markets",
  "buda://markets",
  async (uri) => {
    const data = await cache.getOrFetch<MarketsResponse>(
      "markets",
      CACHE_TTL.MARKETS,
      () => client.get<MarketsResponse>("/markets"),
    );
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(data.markets, null, 2),
        },
      ],
    };
  },
);

server.resource(
  "buda-ticker",
  new ResourceTemplate("buda://ticker/{market}", { list: undefined }),
  async (uri, params) => {
    const raw = params.market as string;
    const validationError = validateMarketId(raw);
    if (validationError) throw new Error(validationError);
    const marketId = raw.toLowerCase();
    const data = await cache.getOrFetch<TickerResponse>(
      `ticker:${marketId}`,
      CACHE_TTL.TICKER,
      () => client.get<TickerResponse>(`/markets/${marketId}/ticker`),
    );
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(data.ticker, null, 2),
        },
      ],
    };
  },
);

server.resource(
  "buda-summary",
  new ResourceTemplate("buda://summary/{market}", { list: undefined }),
  async (uri, params) => {
    const raw = params.market as string;
    const validationError = validateMarketId(raw);
    if (validationError) throw new Error(validationError);
    const marketId = raw.toUpperCase();
    const result = await handleMarketSummary({ market_id: marketId }, client, cache);
    const text = result.content[0]?.text ?? JSON.stringify({ error: "No content returned" });
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
