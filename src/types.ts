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
  pollMs: number               // 500ms tick
  // Entry
  leaderThreshold: number      // 0.52 — side must be above this to be "leader"
  primaryShares: number        // 15 — shares on the leading (likely winner) side
  secondaryShares: number      // 5  — shares on the losing side (lottery)
  // DCA on loser
  dcaDropTriggerPct: number    // 0.25 — DCA when loser drops 25% from our avg cost
  dcaReactiveShares: number    // 10  — shares per reactive DCA
  maxDcaCount: number          // 3   — max DCA rounds on loser
  // Momentum
  momentumFlipThreshold: number // 0.78 — add to leader when it reaches this
  momentumAddShares: number     // 5   — extra shares added to leader on momentum
  // Last call
  lastCallMaxPrice: number      // 0.09 — only buy if loser price < this
  lastCallShares: number        // 10  — shares on last call
  // Take profit on loser
  profitTargetPct: number       // 0.20 — sell loser when it gains 20%+
  profitLadderOrders: number    // 3   — sell ladder steps
  // Risk
  maxExposureUsdc: number       // 30  — max USDC per candle (test budget)
  maxExposurePerSide: number    // 50  — max shares per side
  stopTradingSecs: number       // 15  — stop 15s before close
  staleOrderMaxAgeMs: number    // 15000
  maxOpenOrders: number         // 20
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
