import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateMarketId } from "../validation.js";

export const toolSchema = {
  name: "calculate_position_size",
  description:
    "Calculates position size based on your capital, risk tolerance, entry price, and stop-loss. " +
    "Determines how many units to buy or sell so that a stop-loss hit costs exactly risk_pct% of capital. " +
    "Fully client-side — no API call is made. " +
    "Example: 'How many BTC can I buy on BTC-CLP if I have 1,000,000 CLP, risk 2%, entry 80,000,000 CLP, stop at 78,000,000 CLP?'",
  inputSchema: {
    type: "object" as const,
    properties: {
      market_id: {
        type: "string",
        description: "Market ID (e.g. 'BTC-CLP', 'ETH-COP'). Used to derive the quote currency.",
      },
      capital: {
        type: "number",
        description: "Total available capital in the quote currency (e.g. CLP for BTC-CLP).",
      },
      risk_pct: {
        type: "number",
        description: "Percentage of capital to risk on this trade (0.1–10, e.g. 2 = 2%).",
      },
      entry_price: {
        type: "number",
        description: "Planned entry price in quote currency.",
      },
      stop_loss_price: {
        type: "number",
        description:
          "Stop-loss price in quote currency. Must be below entry for buys, above entry for sells.",
      },
    },
    required: ["market_id", "capital", "risk_pct", "entry_price", "stop_loss_price"],
  },
};

type CalculatePositionSizeArgs = {
  market_id: string;
  capital: number;
  risk_pct: number;
  entry_price: number;
  stop_loss_price: number;
};

export function handleCalculatePositionSize(
  args: CalculatePositionSizeArgs,
): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
  const { market_id, capital, risk_pct, entry_price, stop_loss_price } = args;

  const validationError = validateMarketId(market_id);
  if (validationError) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: validationError, code: "INVALID_MARKET_ID" }) }],
      isError: true,
    };
  }

  if (stop_loss_price === entry_price) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "stop_loss_price must differ from entry_price.",
            code: "INVALID_STOP_LOSS",
          }),
        },
      ],
      isError: true,
    };
  }

  const quoteCurrency = market_id.split("-")[1].toUpperCase();
  const baseCurrency = market_id.split("-")[0].toUpperCase();
  const side: "buy" | "sell" = stop_loss_price < entry_price ? "buy" : "sell";

  const capitalAtRisk = capital * (risk_pct / 100);
  const riskPerUnit = Math.abs(entry_price - stop_loss_price);
  const units = capitalAtRisk / riskPerUnit;
  const positionValue = units * entry_price;
  const feeImpact = parseFloat((positionValue * 0.008).toFixed(8));

  const riskRewardNote =
    `${side === "buy" ? "Buy" : "Sell"} ${units.toFixed(8)} ${baseCurrency} at ${entry_price} ${quoteCurrency} ` +
    `with stop at ${stop_loss_price} ${quoteCurrency}. ` +
    `Risking ${risk_pct}% of capital (${capitalAtRisk.toFixed(2)} ${quoteCurrency}) ` +
    `on a ${riskPerUnit.toFixed(2)} ${quoteCurrency}/unit move. ` +
    `Estimated entry fee: ${feeImpact.toFixed(2)} ${quoteCurrency} (0.8% taker, conservative estimate).`;

  const result = {
    market_id: market_id.toUpperCase(),
    side,
    units: parseFloat(units.toFixed(8)),
    base_currency: baseCurrency,
    capital_at_risk: parseFloat(capitalAtRisk.toFixed(2)),
    position_value: parseFloat(positionValue.toFixed(2)),
    fee_impact: feeImpact,
    fee_currency: quoteCurrency,
    risk_reward_note: riskRewardNote,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

export function register(server: McpServer): void {
  server.tool(
    toolSchema.name,
    toolSchema.description,
    {
      market_id: z
        .string()
        .describe("Market ID (e.g. 'BTC-CLP', 'ETH-COP'). Used to derive the quote currency."),
      capital: z
        .number()
        .positive()
        .describe("Total available capital in the quote currency (e.g. CLP for BTC-CLP)."),
      risk_pct: z
        .number()
        .min(0.1)
        .max(10)
        .describe("Percentage of capital to risk on this trade (0.1–10, e.g. 2 = 2%)."),
      entry_price: z
        .number()
        .positive()
        .describe("Planned entry price in quote currency."),
      stop_loss_price: z
        .number()
        .positive()
        .describe(
          "Stop-loss price in quote currency. Must be below entry for buys, above entry for sells.",
        ),
    },
    (args) => handleCalculatePositionSize(args),
  );
}
