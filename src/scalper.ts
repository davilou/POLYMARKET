import { ClobClient } from '@polymarket/clob-client'
import { ScalperConfig, MarketContext, ScalperResult } from './types.js'
import { PositionManager } from './positionManager.js'
import { OrderManager } from './orderManager.js'
import { logger } from './logger.js'
import { getSpotMomentum } from './spot.js'

type Phase = 'monitoring' | 'entered' | 'hedged' | 'exiting' | 'lastcall'

// Singleton reference for dashboard access
let _activeScalper: Scalper | null = null
export function getActiveScalper(): Scalper | null { return _activeScalper }

export class Scalper {
  private phase: Phase = 'monitoring'
  private enteredSide: 'Up' | 'Down' | null = null
  private running = false

  private positionManager: PositionManager
  private orderManager: OrderManager

  constructor(
    private readonly config: ScalperConfig,
    private readonly client: ClobClient,
    private readonly upTokenId: string,
    private readonly downTokenId: string,
    private readonly endTimestamp: number,   // unix ms
    private readonly tickSize: number,
  ) {
    this.positionManager = new PositionManager(config)
    this.orderManager = new OrderManager(client, upTokenId, downTokenId, tickSize, config)
  }

  // ─── Public state for dashboard ─────────────────────────────────────────

  getPhase(): Phase { return this.phase }
  getPosition() { return this.positionManager.getState() }
  getOrderCount() { return this.orderManager.getOpenCount() }
  getSummary() { return this.positionManager.getSummary() }

  // ─── Main run loop ───────────────────────────────────────────────────────

  async run(): Promise<ScalperResult> {
    _activeScalper = this
    this.running = true

    // Fetch fee rate once at start
    try {
      const feeRateBps = await this.client.getFeeRateBps(this.upTokenId)
      this.orderManager.setFeeRate(feeRateBps)
    } catch {
      this.orderManager.setFeeRate(0)
    }

    logger.info('Scalper started', {
      upToken: this.upTokenId.slice(0, 10),
      downToken: this.downTokenId.slice(0, 10),
      endsAt: new Date(this.endTimestamp).toISOString(),
    })

    while (this.running) {
      const secsRemaining = (this.endTimestamp - Date.now()) / 1000
      if (secsRemaining <= this.config.stopTradingSecs) break

      const tickStart = Date.now()

      try {
        const ctx = await this.fetchContext(secsRemaining)
        if (ctx) {
          const fills = await this.orderManager.reconcile()
          for (const fill of fills) {
            if (fill.side === 'BUY') {
              this.positionManager.recordBuy(fill.tokenSide, fill.price, fill.filledSize)
            } else {
              this.positionManager.recordSell(fill.tokenSide, fill.price, fill.filledSize)
            }
            logger.info('Fill detected', {
              tokenSide: fill.tokenSide, side: fill.side,
              price: fill.price.toFixed(3), size: fill.filledSize.toFixed(2),
            })
          }
          await this.tick(ctx)
        }
      } catch (err: any) {
        logger.warn('Scalper tick error', { error: err.message })
      }

      const elapsed = Date.now() - tickStart
      const wait = Math.max(0, this.config.pollMs - elapsed)
      await sleep(wait)
    }

    await this.shutdown()
    _activeScalper = null

    const pos = this.positionManager.getState()
    return {
      finalPnl: pos.realizedPnl,
      realizedPnl: pos.realizedPnl,
      trades: pos.trades,
      upShares: pos.upShares,
      downShares: pos.downShares,
      upAvgCost: pos.upAvgCost,
      downAvgCost: pos.downAvgCost,
    }
  }

  async shutdown(): Promise<void> {
    this.running = false
    await this.orderManager.cancelAll()
    logger.info('Scalper shutdown', { summary: this.positionManager.getSummary() })
  }

  // ─── Fetch orderbooks and build context ─────────────────────────────────

  private async fetchContext(secsRemaining: number): Promise<MarketContext | null> {
    try {
      const [upBook, downBook] = await Promise.all([
        this.client.getOrderBook(this.upTokenId),
        this.client.getOrderBook(this.downTokenId),
      ])

      const upBestBid = upBook.bids.length > 0 ? parseFloat(upBook.bids[0].price) : 0
      const upBestAsk = upBook.asks.length > 0 ? parseFloat(upBook.asks[0].price) : 1
      const downBestBid = downBook.bids.length > 0 ? parseFloat(downBook.bids[0].price) : 0
      const downBestAsk = downBook.asks.length > 0 ? parseFloat(downBook.asks[0].price) : 1

      const upMid = (upBestBid + upBestAsk) / 2
      const downMid = (downBestBid + downBestAsk) / 2

      return {
        upMid, downMid,
        upBestBid, upBestAsk,
        downBestBid, downBestAsk,
        secsRemaining,
        spotMomentum: getSpotMomentum('BTC'),
      }
    } catch (err: any) {
      logger.warn('fetchContext error', { error: err.message })
      return null
    }
  }

  // ─── Decision tick ───────────────────────────────────────────────────────

  private async tick(ctx: MarketContext): Promise<void> {
    const pos = this.positionManager.getState()

    logger.debug('Tick', {
      phase: this.phase,
      upMid: ctx.upMid.toFixed(3),
      downMid: ctx.downMid.toFixed(3),
      secsLeft: ctx.secsRemaining.toFixed(0),
      summary: this.positionManager.getSummary(),
    })

    // ─── CLEANUP: Cancel stale orders each tick ──────────────────────────
    await this.orderManager.cancelStale(this.config.staleOrderMaxAgeMs)

    // ─── 1. LAST CALL: Contrarian bet in final minutes ───────────────────
    if (ctx.secsRemaining < this.config.lastCallSecs && this.phase !== 'lastcall') {
      const losingSide = ctx.upMid < ctx.downMid ? 'Up' : 'Down'
      const losingPrice = losingSide === 'Up' ? ctx.upBestAsk : ctx.downBestAsk
      if (losingPrice <= this.config.lastCallMaxPrice && losingPrice > 0.01) {
        if (this.positionManager.canBuy(losingSide, this.config.lastCallShares, losingPrice)) {
          logger.info('LAST CALL — contrarian bet', {
            side: losingSide, price: losingPrice.toFixed(3),
            shares: this.config.lastCallShares,
          })
          await this.orderManager.placeLimit(losingSide, 'BUY', losingPrice, this.config.lastCallShares)
          this.phase = 'lastcall'
        }
      }
    }

    // ─── 2. MONITORING: Look for mispricing to enter ─────────────────────
    if (this.phase === 'monitoring') {
      const openCount = this.orderManager.getOpenCount()
      if (openCount >= this.config.maxOpenOrders) return

      if (ctx.upMid < this.config.entryThresholdUp && ctx.upBestAsk > 0.01) {
        logger.info('ENTRY signal — Up underpriced', {
          upMid: ctx.upMid.toFixed(3), threshold: this.config.entryThresholdUp,
        })
        await this.enterDCA('Up', ctx.upBestAsk)
        this.phase = 'entered'
        this.enteredSide = 'Up'
      } else if (ctx.downMid < this.config.entryThresholdDown && ctx.downBestAsk > 0.01) {
        logger.info('ENTRY signal — Down underpriced', {
          downMid: ctx.downMid.toFixed(3), threshold: this.config.entryThresholdDown,
        })
        await this.enterDCA('Down', ctx.downBestAsk)
        this.phase = 'entered'
        this.enteredSide = 'Down'
      }
      return
    }

    if (!this.enteredSide) return

    // ─── 3. HEDGE: Opposite side spiked ─────────────────────────────────
    if (this.phase === 'entered') {
      const oppositeMid = this.enteredSide === 'Up' ? ctx.downMid : ctx.upMid
      if (oppositeMid > this.config.hedgeThreshold) {
        const hedgeSide = this.enteredSide === 'Up' ? 'Down' : 'Up'
        const hedgeAsk = hedgeSide === 'Up' ? ctx.upBestAsk : ctx.downBestAsk
        logger.info('HEDGE — opposite side spiked', {
          hedgeSide, oppositeMid: oppositeMid.toFixed(3), threshold: this.config.hedgeThreshold,
        })
        await this.orderManager.placeLimit(hedgeSide, 'BUY', hedgeAsk, this.config.sharesPerOrder)
        this.phase = 'hedged'
      }
    }

    // ─── 4. TAKE PROFIT: Entered side gained enough ──────────────────────
    if (this.phase === 'entered' || this.phase === 'hedged') {
      const enteredMid = this.enteredSide === 'Up' ? ctx.upMid : ctx.downMid
      const avgCost = this.enteredSide === 'Up' ? pos.upAvgCost : pos.downAvgCost
      const shares = this.enteredSide === 'Up' ? pos.upShares : pos.downShares

      if (avgCost > 0 && shares > 0) {
        const gain = (enteredMid - avgCost) / avgCost
        if (gain >= this.config.profitTargetPct) {
          logger.info('PROFIT TARGET hit — exiting', {
            side: this.enteredSide, gain: `${(gain * 100).toFixed(1)}%`,
            avgCost: avgCost.toFixed(3), currentMid: enteredMid.toFixed(3),
          })
          await this.exitLadder(this.enteredSide, avgCost, enteredMid, shares)
          this.phase = 'exiting'
        }
      }

      // If all positions exited, return to monitoring
      if (pos.upShares === 0 && pos.downShares === 0 && this.orderManager.getOpenCount() === 0) {
        this.phase = 'monitoring'
        this.enteredSide = null
      }
    }
  }

  // ─── Action helpers ──────────────────────────────────────────────────────

  private async enterDCA(side: 'Up' | 'Down', bestAsk: number): Promise<void> {
    await this.orderManager.placeDCALadder(
      side, bestAsk,
      this.config.dcaSpreadPct,
      this.config.dcaOrders,
      this.config.sharesPerOrder,
    )
  }

  private async exitLadder(
    side: 'Up' | 'Down',
    avgCost: number,
    currentMid: number,
    totalShares: number,
  ): Promise<void> {
    const sharesPerSell = Math.max(
      this.config.sharesPerOrder,
      Math.floor(totalShares / this.config.profitLadderOrders),
    )
    const basePrice = Math.max(avgCost + 0.01, currentMid - 0.02)
    const targetPrice = Math.min(0.98, currentMid + 0.03)
    await this.orderManager.placeSellLadder(
      side, basePrice, targetPrice,
      this.config.profitLadderOrders, sharesPerSell,
    )
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
