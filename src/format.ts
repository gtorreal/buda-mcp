/**
 * Shared formatting utilities for buda-mcp tool outputs.
 * All formatters produce markdown strings so any MCP client renders consistent output.
 */

export function liquidityBadge(spreadPct: number): string {
  if (spreadPct < 0.5) return "✅";
  if (spreadPct < 2.0) return "🟡";
  return "🔴";
}

export function fmtSlippage(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(3)}%`;
}

export function fmtTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
