// Buda.com REST API v2 — shared response types
// All monetary amounts are returned as [amount_string, currency_string] tuples.

export type Amount = [string, string];

// ----- Markets -----

export interface Market {
  id: string;
  name: string;
  base_currency: string;
  quote_currency: string;
  minimum_order_amount: Amount;
  taker_fee: string;
  maker_fee: string;
  max_orders_per_minute: number;
  maker_discount_percentage: string;
  taker_discount_percentage: string;
  maker_discount_tiers: Record<string, number>;
  taker_discount_tiers: Record<string, number>;
}

export interface MarketsResponse {
  markets: Market[];
}

export interface MarketResponse {
  market: Market;
}

// ----- Ticker -----

export interface Ticker {
  market_id: string;
  last_price: Amount;
  min_ask: Amount;
  max_bid: Amount;
  volume: Amount;
  price_variation_24h: string;
  price_variation_7d: string;
}

export interface TickerResponse {
  ticker: Ticker;
}

export interface AllTickersResponse {
  tickers: Ticker[];
}

// ----- Order Book -----

export interface OrderBook {
  asks: [string, string][];
  bids: [string, string][];
}

export interface OrderBookResponse {
  order_book: OrderBook;
}

// ----- Trades -----

export interface Trades {
  timestamp: string;
  last_timestamp: string;
  market_id: string;
  /** Each entry: [timestamp_ms, amount, price, direction] */
  entries: [string, string, string, string][];
}

export interface TradesResponse {
  trades: Trades;
}

// ----- Volume -----

export interface MarketVolume {
  market_id: string;
  ask_volume_24h: Amount;
  ask_volume_7d: Amount;
  bid_volume_24h: Amount;
  bid_volume_7d: Amount;
}

export interface VolumeResponse {
  volume: MarketVolume;
}

// ----- OHLCV Candles -----

export interface OhlcvCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trade_count: number;
}

// ----- Pagination -----

export interface PaginationMeta {
  current_page: number;
  total_count: number;
  total_pages: number;
}

// ----- Quotations (public) -----

export interface Quotation {
  id: number | null;
  type: string;
  market_id: string;
  amount: Amount;
  limit: Amount | null;
  base_balance_change: Amount;
  quote_balance_change: Amount;
  fee_amount: Amount;
  order_amount: Amount;
}

export interface QuotationResponse {
  quotation: Quotation;
}

// ----- Banks (public) -----

export interface Bank {
  id: string;
  name: string;
  country: string | null;
}

export interface BanksResponse {
  banks: Bank[];
}
