import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BudaClient } from "./client.js";
import { MemoryCache, CACHE_TTL } from "./cache.js";
import { safeTokenEqual, parseEnvInt } from "./utils.js";
import { requestContext } from "./request-context.js";
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

let PORT: number;
try {
  PORT = parseEnvInt(process.env.PORT, 3000, 1, 65535, "PORT");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const client = new BudaClient(
  undefined,
  process.env.BUDA_API_KEY,
  process.env.BUDA_API_SECRET,
);

const authEnabled = client.hasAuth();

// Schemas for the Smithery server-card — assembled from the same definitions used in register().
// Adding a new tool only requires exporting its toolSchema; no changes needed here.
const PUBLIC_TOOL_SCHEMAS = [
  markets.toolSchema,
  ticker.toolSchema,
  orderbook.toolSchema,
  trades.toolSchema,
  volume.toolSchema,
  spread.toolSchema,
  compareMarkets.toolSchema,
  priceHistory.toolSchema,
  arbitrage.toolSchema,
  marketSummary.toolSchema,
  simulateOrder.toolSchema,
  quotation.toolSchema,
  positionSize.toolSchema,
  marketSentiment.toolSchema,
  technicalIndicators.toolSchema,
  banks.toolSchema,
];

const AUTH_TOOL_SCHEMAS = [
  balances.toolSchema,
  orders.toolSchema,
  placeOrder.toolSchema,
  cancelOrder.toolSchema,
  deadMansSwitch.toolSchema,
  deadMansSwitch.renewToolSchema,
  deadMansSwitch.disarmToolSchema,
  account.toolSchema,
  balance.toolSchema,
  orderLookup.getOrderToolSchema,
  orderLookup.getOrderByClientIdToolSchema,
  networkFees.toolSchema,
  deposits.getDepositHistoryToolSchema,
  withdrawals.getWithdrawalHistoryToolSchema,
  receiveAddresses.listReceiveAddressesToolSchema,
  receiveAddresses.getReceiveAddressToolSchema,
  remittances.listRemittancesToolSchema,
  remittances.getRemittanceToolSchema,
  remittances.quoteRemittanceToolSchema,
  remittances.acceptRemittanceQuoteToolSchema,
  remittanceRecipients.listToolSchema,
  remittanceRecipients.getToolSchema,
  receiveAddresses.createReceiveAddressToolSchema,
  cancelAllOrders.toolSchema,
  cancelOrderByClientId.toolSchema,
  batchOrders.toolSchema,
  withdrawals.createWithdrawalToolSchema,
  deposits.createFiatDepositToolSchema,
  lightning.lightningWithdrawalToolSchema,
  lightning.createLightningInvoiceToolSchema,
];

function createServer(): McpServer {
  const server = new McpServer({ name: "buda-mcp", version: VERSION });

  // Per-request cache so caching works correctly for stateless HTTP
  const reqCache = new MemoryCache();

  markets.register(server, client, reqCache);
  ticker.register(server, client, reqCache);
  orderbook.register(server, client, reqCache);
  trades.register(server, client, reqCache);
  volume.register(server, client, reqCache);
  spread.register(server, client, reqCache);
  compareMarkets.register(server, client, reqCache);
  priceHistory.register(server, client, reqCache);
  arbitrage.register(server, client, reqCache);
  marketSummary.register(server, client, reqCache);
  simulateOrder.register(server, client, reqCache);
  quotation.register(server, client);
  positionSize.register(server);
  marketSentiment.register(server, client, reqCache);
  technicalIndicators.register(server, client);
  banks.register(server, client, reqCache);

  if (authEnabled) {
    balances.register(server, client);
    orders.register(server, client);
    placeOrder.register(server, client, "http");
    cancelOrder.register(server, client, "http");
    deadMansSwitch.register(server, client, "http");
    account.register(server, client);
    balance.register(server, client);
    orderLookup.register(server, client);
    networkFees.register(server, client);
    deposits.register(server, client);
    withdrawals.register(server, client, "http");
    receiveAddresses.register(server, client, "http");
    remittances.register(server, client, "http");
    remittanceRecipients.register(server, client);
    cancelAllOrders.register(server, client, "http");
    cancelOrderByClientId.register(server, client, "http");
    batchOrders.register(server, client, "http");
    lightning.register(server, client, "http");
  }

  // MCP Resources
  server.resource(
    "buda-markets",
    "buda://markets",
    async (uri) => {
      const data = await reqCache.getOrFetch<MarketsResponse>(
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
      const data = await reqCache.getOrFetch<TickerResponse>(
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
      const result = await handleMarketSummary({ market_id: marketId }, client, reqCache);
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

  return server;
}

const app = express();
app.use(helmet());
// CORS: intentionally not configured. This server is designed for server-to-server MCP
// communication only (AI agents, Claude Desktop, etc.) — not for browser clients.
// Helmet already sets X-Content-Type-Options, X-Frame-Options, and related headers.
// trust proxy: 1 = trust exactly one hop (Railway's reverse proxy).
// IMPORTANT: if a second proxy is added in front (e.g. Cloudflare), increment this value to 2.
// With an incorrect count, clients can spoof X-Forwarded-For and bypass the IP-based rate limiter.
// Affects: req.ip and express-rate-limit client IP detection.
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));

const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (authEnabled && !MCP_AUTH_TOKEN) {
  console.error(
    "[buda-mcp] FATAL: BUDA_API_KEY/BUDA_API_SECRET are set but MCP_AUTH_TOKEN is not.\n" +
    "  The /mcp endpoint would be publicly accessible with full account access.\n" +
    "  Set MCP_AUTH_TOKEN to a long random secret, or run in stdio mode instead.",
  );
  process.exit(1);
}

if (MCP_AUTH_TOKEN && MCP_AUTH_TOKEN.length < 32) {
  console.error(
    "[buda-mcp] FATAL: MCP_AUTH_TOKEN has fewer than 32 characters.\n" +
    "  Use a long random secret (e.g. openssl rand -hex 32).",
  );
  process.exit(1);
}

let rateLimitMax: number;
try {
  rateLimitMax = parseEnvInt(process.env.MCP_RATE_LIMIT, 120, 1, 10_000, "MCP_RATE_LIMIT");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const mcpRateLimiter = rateLimit({
  windowMs: 60_000,
  max: rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Retry after 60 seconds.", code: "RATE_LIMITED" },
});

const staticRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests.", code: "RATE_LIMITED" },
});

function mcpAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!MCP_AUTH_TOKEN) {
    next();
    return;
  }
  const auth = req.headers.authorization ?? "";
  if (!safeTokenEqual(auth, `Bearer ${MCP_AUTH_TOKEN}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// Health check for Railway / uptime monitors.
// version is intentionally omitted to avoid fingerprinting by unauthenticated callers.
app.get("/health", staticRateLimiter, (_req, res) => {
  res.json({ status: "ok" });
});

// Smithery static server card — assembled programmatically from tool definitions.
// Adding a new tool only requires exporting its toolSchema; this handler needs no changes.
// When auth is enabled, the server card is gated behind the same bearer token as /mcp
// to avoid leaking the full tool schema to unauthenticated callers.
app.get("/.well-known/mcp/server-card.json", staticRateLimiter, mcpAuthMiddleware, (_req, res) => {
  res.json({
    serverInfo: { name: "buda-mcp", version: VERSION },
    authentication: { required: authEnabled },
    tools: [...PUBLIC_TOOL_SCHEMAS, ...(authEnabled ? AUTH_TOOL_SCHEMAS : [])],
    resources: [
      { uri: "buda://markets", name: "All Buda.com markets", mimeType: "application/json" },
      { uri: "buda://ticker/{market}", name: "Ticker for a specific market", mimeType: "application/json" },
      { uri: "buda://summary/{market}", name: "Full market summary with liquidity rating", mimeType: "application/json" },
    ],
    prompts: [],
  });
});

// Stateless StreamableHTTP — new server instance per request (no session state needed)
app.post("/mcp", mcpRateLimiter, mcpAuthMiddleware, async (req, res) => {
  await requestContext.run({ ip: req.ip }, async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
    });

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
});

// SSE upgrade for clients that prefer streaming
app.get("/mcp", mcpRateLimiter, mcpAuthMiddleware, async (req, res) => {
  await requestContext.run({ ip: req.ip }, async () => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
    });

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
});

app.delete("/mcp", mcpRateLimiter, mcpAuthMiddleware, async (_req, res) => {
  res.status(405).json({ error: "Sessions not supported (stateless server)" });
});

app.listen(PORT, () => {
  console.log(`buda-mcp HTTP server listening on port ${PORT}`);
  console.log(`  MCP endpoint:  http://localhost:${PORT}/mcp`);
  console.log(`  Health check:  http://localhost:${PORT}/health`);
  console.log(`  Auth mode:     ${authEnabled ? "authenticated" : "public (no credentials)"}`);
});
