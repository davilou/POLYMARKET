import { PositionState, TradeRecord, ScalperConfig } from './types.js'

export class PositionManager {
  private state: PositionState = {
    upShares: 0,
    downShares: 0,
    upAvgCost: 0,
    downAvgCost: 0,
    upTotalSpent: 0,
    downTotalSpent: 0,
    realizedPnl: 0,
    trades: [],
  }

  constructor(private readonly config: ScalperConfig) {}

  recordBuy(tokenSide: 'Up' | 'Down', price: number, size: number): void {
    const record: TradeRecord = { timestamp: Date.now(), tokenSide, side: 'BUY', price, size }
    this.state.trades.push(record)

    if (tokenSide === 'Up') {
      const oldTotal = this.state.upShares * this.state.upAvgCost
      this.state.upShares += size
      this.state.upAvgCost = this.state.upShares > 0
        ? (oldTotal + price * size) / this.state.upShares
        : 0
      this.state.upTotalSpent += price * size
    } else {
      const oldTotal = this.state.downShares * this.state.downAvgCost
      this.state.downShares += size
      this.state.downAvgCost = this.state.downShares > 0
        ? (oldTotal + price * size) / this.state.downShares
        : 0
      this.state.downTotalSpent += price * size
    }
  }

  recordSell(tokenSide: 'Up' | 'Down', price: number, size: number): void {
    const record: TradeRecord = { timestamp: Date.now(), tokenSide, side: 'SELL', price, size }
    this.state.trades.push(record)

    if (tokenSide === 'Up') {
      const avgCost = this.state.upAvgCost
      this.state.upShares = Math.max(0, this.state.upShares - size)
      this.state.realizedPnl += (price - avgCost) * size
    } else {
      const avgCost = this.state.downAvgCost
      this.state.downShares = Math.max(0, this.state.downShares - size)
      this.state.realizedPnl += (price - avgCost) * size
    }
  }

  canBuy(tokenSide: 'Up' | 'Down', size: number, price: number): boolean {
    const cost = size * price
    const totalExposure = this.state.upTotalSpent + this.state.downTotalSpent
    if (totalExposure + cost > this.config.maxExposureUsdc) return false
    const currentShares = tokenSide === 'Up' ? this.state.upShares : this.state.downShares
    if (currentShares + size > this.config.maxExposurePerSide) return false
    return true
  }

  getUnrealizedPnl(upMid: number, downMid: number): number {
    const upPnl = (upMid - this.state.upAvgCost) * this.state.upShares
    const downPnl = (downMid - this.state.downAvgCost) * this.state.downShares
    return upPnl + downPnl
  }

  getState(): PositionState {
    return { ...this.state, trades: [...this.state.trades] }
  }

  getSummary(): string {
    const up = `Up: ${this.state.upShares.toFixed(1)}@${this.state.upAvgCost.toFixed(3)}`
    const down = `Down: ${this.state.downShares.toFixed(1)}@${this.state.downAvgCost.toFixed(3)}`
    const pnl = `PnL: ${this.state.realizedPnl >= 0 ? '+' : ''}$${this.state.realizedPnl.toFixed(2)}`
    return `${up} ${down} ${pnl}`
  }
}
