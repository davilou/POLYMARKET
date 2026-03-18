import { BaseStrategy } from './base.js'
import { MarketData, StrategyDecision } from '../types.js'

export class PureArbStrategy extends BaseStrategy {
  private targetSum: number

  constructor(budget: number, targetSum: number = 0.92) {
    super('PureArb', budget)
    this.targetSum = targetSum
  }

  evaluate(data: MarketData): StrategyDecision {
    // Place balanced limit orders on both sides
    // Target: Up at targetSum/2, Down at targetSum/2 → guaranteed profit
    const halfPrice = this.targetSum / 2

    return {
      action: 'buy',
      upBudgetPct: 0.5,
      downBudgetPct: 0.5,
      maxPriceUp: halfPrice,
      maxPriceDown: halfPrice,
      reason: `arb limits Up@${halfPrice.toFixed(2)} + Down@${halfPrice.toFixed(2)} = ${this.targetSum}`,
    }
  }
}
