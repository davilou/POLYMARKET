import { BaseStrategy } from './base.js'
import { MarketData, StrategyDecision } from '../types.js'

export class MeanReversionStrategy extends BaseStrategy {
  constructor(budget: number) {
    super('MeanRevert', budget)
  }

  evaluate(data: MarketData): StrategyDecision {
    const bestUpAsk = data.upBook.asks.length ? parseFloat(data.upBook.asks[0].price) : 1
    const bestDownAsk = data.downBook.asks.length ? parseFloat(data.downBook.asks[0].price) : 1
    const momentum = data.spotMomentum

    // Mean reversion: when one side is expensive (momentum-driven),
    // bid aggressively on the cheap side, conservatively on the expensive side
    let upLimit: number, downLimit: number, upPct: number, downPct: number

    if (momentum > 0.0005 && bestDownAsk < 0.50) {
      // Spot up → Down is cheap → bid more on Down
      upLimit = 0.40
      downLimit = 0.50
      upPct = 0.35
      downPct = 0.65
    } else if (momentum < -0.0005 && bestUpAsk < 0.50) {
      // Spot down → Up is cheap → bid more on Up
      upLimit = 0.50
      downLimit = 0.40
      upPct = 0.65
      downPct = 0.35
    } else {
      // No clear reversion signal → balanced conservative
      upLimit = 0.45
      downLimit = 0.45
      upPct = 0.5
      downPct = 0.5
    }

    return {
      action: 'buy',
      upBudgetPct: upPct,
      downBudgetPct: downPct,
      maxPriceUp: upLimit,
      maxPriceDown: downLimit,
      reason: `revert Up@${upLimit} Down@${downLimit} sum=${(upLimit + downLimit).toFixed(2)}`,
    }
  }
}
