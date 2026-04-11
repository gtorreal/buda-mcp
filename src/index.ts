#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BudaClient } from "./client.js";
import { cache, CACHE_TTL } from "./cache.js";
import { VERSION } from "./version.js";
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
import * as balances from "./tools/balances.js";
import * as orders from "./tools/orders.js";
import * as placeOrder from "./tools/place_order.js";
import * as cancelOrder from "./tools/cancel_order.js";
import * as simulateOrder from "./tools/simulate_order.js";
import * as positionSize from "./tools/calculate_position_size.js";
import * as marketSentiment from "./tools/market_sentiment.js";
import * as technicalIndicators from "./tools/technical_indicators.js";
import * as deadMansSwitch from "./tools/dead_mans_switch.js";
import * as banks from "./tools/banks.js";
import * as account from "./tools/account.js";
import * as balance from "./tools/balance.js";
import * as orderLookup from "./tools/order_lookup.js";
import * as networkFees from "./tools/fees.js";
import * as deposits from "./tools/deposits.js";
import * as withdrawals from "./tools/withdrawals.js";
import * as receiveAddresses from "./tools/receive_addresses.js";
import * as remittances from "./tools/remittances.js";
import * as remittanceRecipients from "./tools/remittance_recipients.js";
import * as quotation from "./tools/quotation.js";
import * as cancelAllOrders from "./tools/cancel_all_orders.js";
import * as cancelOrderByClientId from "./tools/cancel_order_by_client_id.js";
import * as batchOrders from "./tools/batch_orders.js";
import * as lightning from "./tools/lightning.js";
import { handleMarketSummary } from "./tools/market_summary.js";

const client = new BudaClient(
  undefined,
  process.env.BUDA_API_KEY,
  process.env.BUDA_API_SECRET,
);

const server = new McpServer({
  name: "buda-mcp",
  version: VERSION,
});

// Public tools
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

// Auth-gated tools — only registered when API credentials are present
if (client.hasAuth()) {
  balances.register(server, client);
  orders.register(server, client);
  placeOrder.register(server, client);
  cancelOrder.register(server, client);
  deadMansSwitch.register(server, client);
  account.register(server, client);
  balance.register(server, client);
  orderLookup.register(server, client);
  networkFees.register(server, client);
  deposits.register(server, client);
  withdrawals.register(server, client);
  receiveAddresses.register(server, client);
  remittances.register(server, client);
  remittanceRecipients.register(server, client);
  cancelAllOrders.register(server, client);
  cancelOrderByClientId.register(server, client);
  batchOrders.register(server, client);
  lightning.register(server, client);
}

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
    const marketId = (params.market as string).toLowerCase();
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
    const marketId = (params.market as string).toUpperCase();
    const result = await handleMarketSummary({ market_id: marketId }, client, cache);
    const text = result.content[0].text;
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
