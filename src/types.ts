// ─── Polymarket market types ───────────────────────────────────────────────

export interface Market {
  conditionId: string
  question: string
  slug: string
  endDateIso: string
  clobTokenIds: string   // JSON string: ["tokenId0", "tokenId1"]
  outcomes: string       // JSON string: ["Up", "Down"]
  active: boolean
  closed: boolean
  volume: number
  liquidity: number
}

export interface OrderBook {
  market: string         // token_id
  asset_id: string
  bids: PriceLevel[]
  asks: PriceLevel[]
  timestamp: number
  min_order_size: string  // mínimo de shares por ordem (ex: "5")
  tick_size: string       // incremento mínimo de preço (ex: "0.01")
}

export interface PriceLevel {
  price: string
  size: string
}

// ─── Bot state types ────────────────────────────────────────────────────────

export interface MarketOpportunity {
  slug: string
  conditionId: string
  title: string
  upTokenId: string
  downTokenId: string
  bestUpAsk: number       // melhor preço para comprar Up
  bestDownAsk: number     // melhor preço para comprar Down
  sum: number             // upAsk + downAsk
  potentialProfit: number // 1 - sum (antes de fees)
  expiresAt: Date
  upMinOrderSize: number  // mínimo de shares para ordem Up
  downMinOrderSize: number // mínimo de shares para ordem Down
  upTickSize: number      // tick size do mercado Up (pode mudar dinamicamente)
  downTickSize: number    // tick size do mercado Down
}

export interface ActivePosition {
  slug: string
  conditionId: string
  upOrderId?: string
  downOrderId?: string
  upTokenId?: string    // necessário para hedge emergencial
  downTokenId?: string
  upFilledSize: number
  downFilledSize: number
  upPrice: number
  downPrice: number
  totalSpentUsdc: number
  openedAt: Date
  status: 'open' | 'partial' | 'filled' | 'expired' | 'cancelled'
}

export interface BotStats {
  totalTrades: number
  totalVolumeUsdc: number
  totalRedeemedUsdc: number
  totalRebateUsdc: number
  netPnl: number
  wins: number
  losses: number
  startedAt: Date
}

// ─── Config type ────────────────────────────────────────────────────────────

export interface BotConfig {
  maxExposurePerMarket: number
  minSpreadToEnter: number
  maxSumToEnter: number
  cancelIfPriceMovePct: number
  orderSizeUsdc: number
  pollIntervalMs: number
  assets: string[]
}

// ─── Strategy types ──────────────────────────────────────────────────────

export interface MarketData {
  market: Market
  upTokenId: string
  downTokenId: string
  upBook: OrderBook
  downBook: OrderBook
  spotPrice: number
  spotMomentum: number
  minsToExpiry: number
  endTime: Date
}

export interface StrategyDecision {
  action: 'buy' | 'skip'
  upBudgetPct: number
  downBudgetPct: number
  maxPriceUp: number
  maxPriceDown: number
  reason: string
}

export interface SimulatedFill {
  side: 'Up' | 'Down'
  shares: number
  avgPrice: number
  usdcSpent: number
}

export interface StrategyPosition {
  strategyName: string
  marketSlug: string
  conditionId: string
  title: string
  upShares: number
  downShares: number
  upAvgPrice: number
  downAvgPrice: number
  totalSpent: number
  sum: number
  enteredAt: Date
  expiresAt: Date
  resolved: boolean
  outcome: 'Up' | 'Down' | null
  pnl: number
}

export interface StrategyStats {
  strategyName: string
  totalMarkets: number
  totalVolume: number
  wins: number
  losses: number
  netPnl: number
  avgSum: number
  bestSum: number
  positions: StrategyPosition[]
}

export interface SpotSnapshot {
  price: number
  timestamp: number
}

// ─── Scalper types ──────────────────────────────────────────────────────────

export interface ScalperConfig {
  pollMs: number              // 500
  entryThresholdUp: number    // 0.35 — buy Up when mid < this
  entryThresholdDown: number  // 0.30 — buy Down when mid < this
  dcaOrders: number           // 10 — number of DCA orders
  dcaSpreadPct: number        // 0.10 — total spread (e.g. 0.30 to 0.27)
  sharesPerOrder: number      // 5 — minimum shares per order
  hedgeThreshold: number      // 0.55 — if opposite side > this, hedge
  profitTargetPct: number     // 0.10 — take profit at 10%+
  profitLadderOrders: number  // 5 — number of SELL ladder orders
  lastCallSecs: number        // 120 — last 2 minutes
  lastCallMaxPrice: number    // 0.20 — only buy if price < this
  lastCallShares: number      // 5 — shares for contrarian bet
  maxExposureUsdc: number     // 50 — max $50 at risk
  maxExposurePerSide: number  // 30 — max 30 shares per side
  stopTradingSecs: number     // 15 — stop 15s before close
  maxOpenOrders: number       // 20 — max simultaneous open orders
  staleOrderMaxAgeMs: number  // 15000 — cancel orders > 15s unfilled
}

export interface LocalOrder {
  id: string
  side: 'BUY' | 'SELL'
  tokenSide: 'Up' | 'Down'
  price: number
  size: number
  placedAt: number
  filledSize: number
}

export interface TradeRecord {
  timestamp: number
  tokenSide: 'Up' | 'Down'
  side: 'BUY' | 'SELL'
  price: number
  size: number
}

export interface PositionState {
  upShares: number
  downShares: number
  upAvgCost: number           // weighted average of all Up buys
  downAvgCost: number
  upTotalSpent: number
  downTotalSpent: number
  realizedPnl: number         // profit from sells
  trades: TradeRecord[]
}

export interface MarketContext {
  upMid: number               // midpoint Up
  downMid: number             // midpoint Down
  upBestBid: number
  upBestAsk: number
  downBestBid: number
  downBestAsk: number
  secsRemaining: number       // seconds until candle closes
  spotMomentum: number        // BTC spot momentum
}

export interface FillEvent {
  orderId: string
  tokenSide: 'Up' | 'Down'
  side: 'BUY' | 'SELL'
  price: number
  filledSize: number
}

export interface ScalperResult {
  finalPnl: number
  realizedPnl: number
  trades: TradeRecord[]
  upShares: number
  downShares: number
  upAvgCost: number
  downAvgCost: number
}
