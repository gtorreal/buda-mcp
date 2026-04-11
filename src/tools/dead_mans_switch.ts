import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BudaClient, BudaApiError } from "../client.js";
import { validateMarketId } from "../validation.js";
import type { OrdersResponse, OrderResponse } from "../types.js";

// ---- Module-level timer state (persists across HTTP requests / tool invocations) ----

interface TimerEntry {
  timeout: ReturnType<typeof setTimeout>;
  expiresAt: number;
  ttlSeconds: number;
}

const timers = new Map<string, TimerEntry>();

async function cancelAllOrdersForMarket(marketId: string, client: BudaClient): Promise<void> {
  try {
    const data = await client.get<OrdersResponse>(
      `/markets/${marketId}/orders`,
      { state: "pending", per: 300 },
    );
    const orders = data.orders ?? [];
    await Promise.allSettled(
      orders.map((order) =>
        client.put<OrderResponse>(`/orders/${order.id}`, { state: "canceling" }),
      ),
    );
    timers.delete(marketId);
  } catch {
    // Swallow errors — the timer has fired; we cannot surface them to the caller
    timers.delete(marketId);
  }
}

function armTimer(marketId: string, ttlSeconds: number, client: BudaClient): TimerEntry {
  const existing = timers.get(marketId);
  if (existing) clearTimeout(existing.timeout);

  const expiresAt = Date.now() + ttlSeconds * 1000;
  const timeout = setTimeout(() => {
    void cancelAllOrdersForMarket(marketId, client);
  }, ttlSeconds * 1000);

  const entry: TimerEntry = { timeout, expiresAt, ttlSeconds };
  timers.set(marketId, entry);
  return entry;
}

// ---- Tool schemas ----

export const toolSchema = {
  name: "schedule_cancel_all",
  description:
    "WARNING: timer state is lost on server restart. Not suitable as a production dead man's switch " +
    "on hosted deployments (e.g. Railway). Use only on locally-run instances.\n\n" +
    "Arms an in-memory dead man's switch: if not renewed within ttl_seconds, all open orders for the " +
    "market are automatically cancelled. Requires confirmation_token='CONFIRM' to activate. " +
    "Use renew_cancel_timer to reset the countdown, or disarm_cancel_timer to cancel without touching orders. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID to protect (e.g. 'BTC-CLP').",
      },
      ttl_seconds: {
        type: "number",
        description: "Seconds before all orders are cancelled if not renewed (10–300).",
      },
      confirmation_token: {
        type: "string",
        description: "Must equal exactly 'CONFIRM' (case-sensitive) to arm the switch.",
      },
    },
    required: ["market_id", "ttl_seconds", "confirmation_token"],
  },
};

export const renewToolSchema = {
  name: "renew_cancel_timer",
  description:
    "Resets the dead man's switch TTL for a market, preventing automatic order cancellation. " +
    "No confirmation required. Requires an active timer set by schedule_cancel_all. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID whose timer should be renewed (e.g. 'BTC-CLP').",
      },
    },
    required: ["market_id"],
  },
};

export const disarmToolSchema = {
  name: "disarm_cancel_timer",
  description:
    "Disarms the dead man's switch for a market without cancelling any orders. " +
    "No confirmation required. Safe to call even if no timer is active. " +
    "Requires BUDA_API_KEY and BUDA_API_SECRET environment variables.",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID whose timer should be disarmed (e.g. 'BTC-CLP').",
      },
    },
    required: ["market_id"],
  },
};

// ---- Handlers (exported for unit tests) ----

type ScheduleArgs = {
  market_id: string;
  ttl_seconds: number;
  confirmation_token: string;
};

export async function handleScheduleCancelAll(
  args: ScheduleArgs,
  client: BudaClient,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const { market_id, ttl_seconds, confirmation_token } = args;

  if (confirmation_token !== "CONFIRM") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error:
              "Dead man's switch not armed. confirmation_token must equal 'CONFIRM' to activate. " +
              "Review the parameters and set confirmation_token='CONFIRM' to proceed.",
            code: "CONFIRMATION_REQUIRED",
            market_id,
            ttl_seconds,
          }),
        },
      ],
      isError: true,
    };
  }

  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  const id = market_id.toLowerCase();
  const entry = armTimer(id, ttl_seconds, client);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          active: true,
          market_id: market_id.toUpperCase(),
          expires_at: new Date(entry.expiresAt).toISOString(),
          ttl_seconds,
          warning: "in-memory only — timer is lost on server restart. Not suitable for hosted deployments.",
        }),
      },
    ],
  };
}

type MarketOnlyArgs = { market_id: string };

export function handleRenewCancelTimer(
  { market_id }: MarketOnlyArgs,
  client: BudaClient,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  const id = market_id.toLowerCase();
  const existing = timers.get(id);
  if (!existing) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `No active dead man's switch for market ${market_id.toUpperCase()}. Arm one first with schedule_cancel_all.`,
            code: "NO_ACTIVE_TIMER",
            market_id: market_id.toUpperCase(),
          }),
        },
      ],
      isError: true,
    };
  }

  const entry = armTimer(id, existing.ttlSeconds, client);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          active: true,
          market_id: market_id.toUpperCase(),
          expires_at: new Date(entry.expiresAt).toISOString(),
          ttl_seconds: entry.ttlSeconds,
        }),
      },
    ],
  };
}

export function handleDisarmCancelTimer(
  { market_id }: MarketOnlyArgs,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  const id = market_id.toLowerCase();
  const existing = timers.get(id);
  if (!existing) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            disarmed: false,
            market_id: market_id.toUpperCase(),
            note: "No active timer for this market.",
          }),
        },
      ],
    };
  }

  clearTimeout(existing.timeout);
  timers.delete(id);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          disarmed: true,
          market_id: market_id.toUpperCase(),
        }),
      },
    ],
  };
}

// ---- Registration ----

export function register(server: McpServer, client: BudaClient): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID to protect (e.g. 'BTC-CLP')."),
      ttl_seconds: z
        .number()
        .int()
        .min(10)
        .max(300)
        .describe("Seconds before all orders are cancelled if not renewed (10–300)."),
      confirmation_token: z
        .string()
        .describe("Must equal exactly 'CONFIRM' (case-sensitive) to arm the switch."),
    },
    (args) => handleScheduleCancelAll(args, client),
  );

  server.tool(
    renewToolSchema.name,
    renewToolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID whose timer should be renewed (e.g. 'BTC-CLP')."),
    },
    (args) => handleRenewCancelTimer(args, client),
  );

  server.tool(
    disarmToolSchema.name,
    disarmToolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID whose timer should be disarmed (e.g. 'BTC-CLP')."),
    },
    (args) => handleDisarmCancelTimer(args),
  );
}
