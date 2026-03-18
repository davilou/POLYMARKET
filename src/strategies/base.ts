import { MarketData, StrategyDecision, StrategyPosition, StrategyStats, SimulatedFill } from '../types.js'
import { simulateFills } from '../simulator.js'
import { logger } from '../logger.js'

export abstract class BaseStrategy {
  readonly name: string
  protected budget: number
  protected positions: Map<string, StrategyPosition> = new Map()
  protected stats: StrategyStats

  constructor(name: string, budget: number) {
    this.name = name
    this.budget = budget
    this.stats = {
      strategyName: name,
      totalMarkets: 0,
      totalVolume: 0,
      wins: 0,
      losses: 0,
      netPnl: 0,
      avgSum: 0,
      bestSum: 999,
      positions: [],
    }
  }

  abstract evaluate(data: MarketData): StrategyDecision

  process(data: MarketData): void {
    const slug = data.market.slug
    if (this.positions.has(slug)) return
    if (data.minsToExpiry < 1) return       // too close to expiry — price already converged
    // Extract market duration from slug (5m or 15m)
    const durMatch = slug.match(/(\d+)m-\d+$/)
    const marketDuration = durMatch ? parseInt(durMatch[1]) : 5
    // Allow entry up to 5 min before market starts (pre-market limit orders)
    if (data.minsToExpiry > marketDuration + 5) return

    const decision = this.evaluate(data)
    if (decision.action === 'skip') return

    const { up, down } = simulateFills(data, decision, this.budget)
    if (!up && !down) return

    const upShares = up?.shares ?? 0
    const downShares = down?.shares ?? 0
    const upSpent = up?.usdcSpent ?? 0
    const downSpent = down?.usdcSpent ?? 0
    const upAvg = up?.avgPrice ?? 0
    const downAvg = down?.avgPrice ?? 0
    const totalSpent = upSpent + downSpent
    const sum = (upShares > 0 && downShares > 0) ? upAvg + downAvg : 0

    // Only enter if sum is below threshold — like BoshBashBish
    if (sum > 0 && sum >= 0.99) {
      logger.info(`[${this.name}] Skipped — sum too high`, {
        slug, sum: sum.toFixed(3), reason: decision.reason,
      })
      return
    }

    const position: StrategyPosition = {
      strategyName: this.name,
      marketSlug: slug,
      conditionId: data.market.conditionId,
      title: data.market.question,
      upShares,
      downShares,
      upAvgPrice: upAvg,
      downAvgPrice: downAvg,
      totalSpent,
      sum,
      enteredAt: new Date(),
      expiresAt: data.endTime,
      resolved: false,
      outcome: null,
      pnl: 0,
    }

    this.positions.set(slug, position)
    this.stats.totalMarkets++
    this.stats.totalVolume += totalSpent
    if (sum > 0 && sum < this.stats.bestSum) this.stats.bestSum = sum

    logger.info(`[${this.name}] Position opened`, {
      slug,
      upShares: upShares.toFixed(1),
      downShares: downShares.toFixed(1),
      sum: sum > 0 ? sum.toFixed(3) : 'n/a',
      spent: totalSpent.toFixed(2),
      reason: decision.reason,
    })
  }

  resolveMarket(slug: string, outcome: 'Up' | 'Down'): void {
    const pos = this.positions.get(slug)
    if (!pos || pos.resolved) return

    const payout = outcome === 'Up' ? pos.upShares : pos.downShares
    const pnl = payout - pos.totalSpent
    pos.resolved = true
    pos.outcome = outcome
    pos.pnl = Math.round(pnl * 100) / 100

    if (pnl >= 0) this.stats.wins++
    else this.stats.losses++
    this.stats.netPnl += pos.pnl

    const resolvedPositions = [...this.positions.values()].filter(p => p.resolved && p.sum > 0)
    if (resolvedPositions.length > 0) {
      this.stats.avgSum = resolvedPositions.reduce((s, p) => s + p.sum, 0) / resolvedPositions.length
    }

    this.stats.positions.push(pos)
    this.positions.delete(slug)

    logger.info(`[${this.name}] Market resolved`, {
      slug, outcome,
      pnl: pos.pnl.toFixed(2),
      totalPnl: this.stats.netPnl.toFixed(2),
    })
  }

  getOpenPositions(): StrategyPosition[] {
    return [...this.positions.values()]
  }

  getStats(): StrategyStats {
    return { ...this.stats }
  }

  getOpenSlugs(): string[] {
    return [...this.positions.keys()]
  }
}
