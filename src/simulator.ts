import { OrderBook, StrategyDecision, SimulatedFill, MarketData } from './types.js'

export function simulateFills(
  data: MarketData,
  decision: StrategyDecision,
  totalBudget: number
): { up: SimulatedFill | null; down: SimulatedFill | null } {
  const upBudget = totalBudget * decision.upBudgetPct
  const downBudget = totalBudget * decision.downBudgetPct

  const up = upBudget > 0
    ? simulateLimitOrder(data.upBook, upBudget, decision.maxPriceUp, 'Up')
    : null

  const down = downBudget > 0
    ? simulateLimitOrder(data.downBook, downBudget, decision.maxPriceDown, 'Down')
    : null

  return { up, down }
}

/**
 * Estimate fill rate for a resting limit order based on its position in the book.
 *
 * - Above best bid → aggressive, high chance of fill (~80%)
 * - At best bid → competing with other makers (~40%)
 * - Below best bid by 1-2 ticks → unlikely fill (~15%)
 * - Far below best bid → very unlikely (~5%)
 */
function estimateFillRate(book: OrderBook, limitPrice: number): number {
  const bids = book.bids
    .map(b => parseFloat(b.price))
    .filter(p => p > 0)
    .sort((a, b) => b - a)  // highest first

  if (bids.length === 0) return 0.30  // empty book, moderate chance

  const bestBid = bids[0]

  if (limitPrice > bestBid + 0.02) return 0.85  // well above best bid
  if (limitPrice > bestBid) return 0.70          // above best bid
  if (limitPrice >= bestBid - 0.01) return 0.40  // at or near best bid
  if (limitPrice >= bestBid - 0.03) return 0.15  // 1-3 cents below
  return 0.05                                     // far below
}

/**
 * Simulate a limit order fill with realistic fill rate estimation.
 *
 * Phase 1: Eat any asks at or below our limit price (immediate fill, 100%).
 * Phase 2: Remaining budget rests as a limit bid. Estimate what % would fill
 *          based on our position relative to the current book.
 */
function simulateLimitOrder(
  book: OrderBook,
  budget: number,
  limitPrice: number,
  side: 'Up' | 'Down'
): SimulatedFill | null {
  if (limitPrice <= 0) return null

  let remaining = budget
  let totalShares = 0
  let totalSpent = 0

  // Phase 1: Eat any asks at or below our limit price (immediate fills — 100%)
  const cheapAsks = book.asks
    .map(a => ({ price: parseFloat(a.price), size: parseFloat(a.size) }))
    .filter(a => a.price <= limitPrice && a.price > 0)
    .sort((a, b) => a.price - b.price)

  for (const ask of cheapAsks) {
    if (remaining <= 0) break
    const costForAll = ask.size * ask.price
    if (costForAll <= remaining) {
      totalShares += ask.size
      totalSpent += costForAll
      remaining -= costForAll
    } else {
      const shares = remaining / ask.price
      totalShares += shares
      totalSpent += remaining
      remaining = 0
    }
  }

  // Phase 2: Remaining budget rests as limit order — apply fill rate
  if (remaining > 0) {
    const fillRate = estimateFillRate(book, limitPrice)
    const effectiveBudget = remaining * fillRate
    if (effectiveBudget > 0) {
      const pendingShares = effectiveBudget / limitPrice
      totalShares += pendingShares
      totalSpent += effectiveBudget
    }
  }

  if (totalShares === 0) return null

  return {
    side,
    shares: Math.round(totalShares * 100) / 100,
    avgPrice: Math.round((totalSpent / totalShares) * 10000) / 10000,
    usdcSpent: Math.round(totalSpent * 100) / 100,
  }
}
