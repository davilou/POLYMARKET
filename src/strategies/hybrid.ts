import { BaseStrategy } from './base.js'
import { MarketData, StrategyDecision } from '../types.js'

export class HybridStrategy extends BaseStrategy {
  constructor(budget: number) {
    super('Hybrid', budget)
  }

  evaluate(data: MarketData): StrategyDecision {
    const momentum = data.spotMomentum
    const bestUpAsk = data.upBook.asks.length ? parseFloat(data.upBook.asks[0].price) : 1
    const bestDownAsk = data.downBook.asks.length ? parseFloat(data.downBook.asks[0].price) : 1
    const currentSum = bestUpAsk + bestDownAsk

    // Hybrid: combine arb + momentum signals
    // If current asks are already cheap (sum < 0.95), be more aggressive
    // Otherwise, use momentum to pick direction and bid conservatively

    let upLimit: number, downLimit: number, upPct: number, downPct: number

    if (currentSum < 0.95) {
      // Arb opportunity — bid near current asks
      upLimit = Math.min(bestUpAsk, 0.50)
      downLimit = Math.min(bestDownAsk, 0.50)
      upPct = bestUpAsk / currentSum
      downPct = bestDownAsk / currentSum
      return {
        action: 'buy',
        upBudgetPct: upPct,
        downBudgetPct: downPct,
        maxPriceUp: upLimit,
        maxPriceDown: downLimit,
        reason: `hybrid-arb sum=${currentSum.toFixed(3)} Up@${upLimit.toFixed(2)} Down@${downLimit.toFixed(2)}`,
      }
    }

    // Momentum-based with conservative limits
    if (momentum > 0.0005) {
      upLimit = 0.50
      downLimit = 0.44
      upPct = 0.60
      downPct = 0.40
    } else if (momentum < -0.0005) {
      upLimit = 0.44
      downLimit = 0.50
      upPct = 0.40
      downPct = 0.60
    } else {
      upLimit = 0.47
      downLimit = 0.47
      upPct = 0.50
      downPct = 0.50
    }

    return {
      action: 'buy',
      upBudgetPct: upPct,
      downBudgetPct: downPct,
      maxPriceUp: upLimit,
      maxPriceDown: downLimit,
      reason: `hybrid-mom ${(momentum * 100).toFixed(3)}% Up@${upLimit} Down@${downLimit} sum=${(upLimit + downLimit).toFixed(2)}`,
    }
  }
}
