import { BaseStrategy } from './base.js'
import { MarketData, StrategyDecision } from '../types.js'

export class MomentumStrategy extends BaseStrategy {
  private weight: number

  constructor(budget: number, weight: number = 0.65) {
    super('Momentum', budget)
    this.weight = weight
  }

  evaluate(data: MarketData): StrategyDecision {
    const momentum = data.spotMomentum

    // Directional bias based on spot momentum, but still buy both sides
    let upPct: number, downPct: number
    let upLimit: number, downLimit: number

    if (momentum > 0.0005) {
      // Spot going up → Up more likely → bid higher on Up, lower on Down
      upPct = this.weight
      downPct = 1 - this.weight
      upLimit = 0.52
      downLimit = 0.42
    } else if (momentum < -0.0005) {
      // Spot going down → Down more likely
      upPct = 1 - this.weight
      downPct = this.weight
      upLimit = 0.42
      downLimit = 0.52
    } else {
      // Flat → balanced
      upPct = 0.5
      downPct = 0.5
      upLimit = 0.47
      downLimit = 0.47
    }

    return {
      action: 'buy',
      upBudgetPct: upPct,
      downBudgetPct: downPct,
      maxPriceUp: upLimit,
      maxPriceDown: downLimit,
      reason: `momentum ${(momentum * 100).toFixed(3)}% → Up@${upLimit} Down@${downLimit} sum=${(upLimit + downLimit).toFixed(2)}`,
    }
  }
}
