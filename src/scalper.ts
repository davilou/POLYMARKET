import { ClobClient } from '@polymarket/clob-client'
import { ScalperConfig, MarketContext, ScalperResult } from './types.js'
import { PositionManager } from './positionManager.js'
import { OrderManager } from './orderManager.js'
import { logger } from './logger.js'
import { getSpotMomentum } from './spot.js'

type Phase = 'waiting' | 'entered' | 'lastcall'

let _activeScalper: Scalper | null = null
export function getActiveScalper(): Scalper | null { return _activeScalper }

export class Scalper {
  private phase: Phase = 'waiting'
  private leaderSide: 'Up' | 'Down' | null = null
  private loserSide: 'Up' | 'Down' | null = null
  private running = false
  private dcaCount = 0
  private lastDcaPrice = 0         // loser price at last DCA
  private momentumDone = false     // already added to leader
  private lastCallDone = false
  private enteredAt = 0            // timestamp when we entered

  private positionManager: PositionManager
  private orderManager: OrderManager

  constructor(
    private readonly config: ScalperConfig,
    private readonly client: ClobClient,
    private readonly upTokenId: string,
    private readonly downTokenId: string,
    private readonly endTimestamp: number,
    private readonly tickSize: number,
  ) {
    this.positionManager = new PositionManager(config)
    this.orderManager = new OrderManager(client, upTokenId, downTokenId, tickSize, config)
  }

  getPhase(): Phase { return this.phase }
  getPosition() { return this.positionManager.getState() }
  getOrderCount() { return this.orderManager.getOpenCount() }
  getSummary() { return this.positionManager.getSummary() }
  getLeaderSide() { return this.leaderSide }
  getLoserSide() { return this.loserSide }

  async run(): Promise<ScalperResult> {
    _activeScalper = this
    this.running = true

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
      config: {
        primaryShares: this.config.primaryShares,
        secondaryShares: this.config.secondaryShares,
        maxExposure: `$${this.config.maxExposureUsdc}`,
        leaderThreshold: this.config.leaderThreshold,
      },
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
            logger.info('Fill', {
              side: fill.side, token: fill.tokenSide,
              price: fill.price.toFixed(3), size: fill.filledSize.toFixed(2),
              summary: this.positionManager.getSummary(),
            })
          }
          await this.tick(ctx)
        }
      } catch (err: any) {
        logger.warn('Tick error', { error: err.message })
      }

      const elapsed = Date.now() - tickStart
      await sleep(Math.max(0, this.config.pollMs - elapsed))
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

      const upMid = upBook.bids.length > 0 && upBook.asks.length > 0
        ? (upBestBid + upBestAsk) / 2 : upBestAsk
      const downMid = downBook.bids.length > 0 && downBook.asks.length > 0
        ? (downBestBid + downBestAsk) / 2 : downBestAsk

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

  private async tick(ctx: MarketContext): Promise<void> {
    const pos = this.positionManager.getState()
    const sum = ctx.upMid + ctx.downMid

    logger.info('Tick', {
      phase: this.phase,
      upMid: ctx.upMid.toFixed(3),
      downMid: ctx.downMid.toFixed(3),
      sum: sum.toFixed(3),
      secsLeft: ctx.secsRemaining.toFixed(0),
      leader: this.leaderSide ?? '-',
      loser: this.loserSide ?? '-',
      dcaCount: this.dcaCount,
      summary: this.positionManager.getSummary(),
    })

    // Sanity check: if sum is way off, skip (bad book)
    if (sum < 0.5 || sum > 1.5) {
      logger.warn('Book sanity check failed, skipping tick', { sum: sum.toFixed(3) })
      return
    }

    // Cancel stale orders every tick
    await this.orderManager.cancelStale(this.config.staleOrderMaxAgeMs)

    // ─── PHASE: WAITING — identify leader and enter ────────────────────────
    if (this.phase === 'waiting') {
      await this.handleWaiting(ctx)
      return
    }

    // ─── PHASE: ENTERED — manage positions ────────────────────────────────
    if (this.phase === 'entered' || this.phase === 'lastcall') {
      await this.handleEntered(ctx, pos)
    }
  }

  // ─── WAITING: Find clear leader and enter ──────────────────────────────

  private async handleWaiting(ctx: MarketContext): Promise<void> {
    // Determine leader: side clearly above leaderThreshold
    const upIsLeader = ctx.upMid >= this.config.leaderThreshold
    const downIsLeader = ctx.downMid >= this.config.leaderThreshold

    // Don't enter if market is too balanced (no clear leader yet)
    // unless we're in the last 60s (force entry with whatever leader exists)
    const timeoutForce = ctx.secsRemaining < 60

    if (!upIsLeader && !downIsLeader && !timeoutForce) {
      logger.debug('No clear leader yet', {
        upMid: ctx.upMid.toFixed(3),
        downMid: ctx.downMid.toFixed(3),
        threshold: this.config.leaderThreshold,
      })
      return
    }

    // Pick the leader (higher mid)
    const leader: 'Up' | 'Down' = ctx.upMid >= ctx.downMid ? 'Up' : 'Down'
    const loser: 'Up' | 'Down' = leader === 'Up' ? 'Down' : 'Up'
    const leaderAsk = leader === 'Up' ? ctx.upBestAsk : ctx.downBestAsk
    const loserAsk = loser === 'Up' ? ctx.upBestAsk : ctx.downBestAsk
    const leaderMid = leader === 'Up' ? ctx.upMid : ctx.downMid

    logger.info('LEADER identified — entering', {
      leader, leaderMid: leaderMid.toFixed(3),
      loser, loserMid: (leader === 'Up' ? ctx.downMid : ctx.upMid).toFixed(3),
    })

    // Enter PRIMARY on leader (large)
    if (this.positionManager.canBuy(leader, this.config.primaryShares, leaderAsk)) {
      await this.orderManager.placeLimit(leader, 'BUY', leaderAsk, this.config.primaryShares)
      logger.info('PRIMARY entry', {
        side: leader, price: leaderAsk.toFixed(3), shares: this.config.primaryShares,
        cost: `$${(leaderAsk * this.config.primaryShares).toFixed(2)}`,
      })
    }

    // Enter SECONDARY on loser (small lottery)
    if (loserAsk > 0.01 && this.positionManager.canBuy(loser, this.config.secondaryShares, loserAsk)) {
      await this.orderManager.placeLimit(loser, 'BUY', loserAsk, this.config.secondaryShares)
      logger.info('SECONDARY entry (lottery)', {
        side: loser, price: loserAsk.toFixed(3), shares: this.config.secondaryShares,
        cost: `$${(loserAsk * this.config.secondaryShares).toFixed(2)}`,
      })
    }

    this.leaderSide = leader
    this.loserSide = loser
    this.lastDcaPrice = loserAsk
    this.enteredAt = Date.now()
    this.phase = 'entered'
  }

  // ─── ENTERED: Manage positions reactively ──────────────────────────────

  private async handleEntered(ctx: MarketContext, pos: ReturnType<PositionManager['getState']>): Promise<void> {
    if (!this.leaderSide || !this.loserSide) return

    const loserMid = this.loserSide === 'Up' ? ctx.upMid : ctx.downMid
    const loserAsk = this.loserSide === 'Up' ? ctx.upBestAsk : ctx.downBestAsk
    const loserShares = this.loserSide === 'Up' ? pos.upShares : pos.downShares
    const loserAvgCost = this.loserSide === 'Up' ? pos.upAvgCost : pos.downAvgCost

    const leaderMid = this.leaderSide === 'Up' ? ctx.upMid : ctx.downMid
    const leaderAsk = this.leaderSide === 'Up' ? ctx.upBestAsk : ctx.downBestAsk

    // ── 1. LAST CALL: loser at extreme low ──────────────────────────────
    if (loserAsk <= this.config.lastCallMaxPrice && loserAsk > 0.01 && !this.lastCallDone) {
      if (this.positionManager.canBuy(this.loserSide, this.config.lastCallShares, loserAsk)) {
        logger.info('LAST CALL — loser at extreme price', {
          side: this.loserSide, price: loserAsk.toFixed(3),
          shares: this.config.lastCallShares,
          potentialReturn: `${(1 / loserAsk).toFixed(1)}x`,
        })
        await this.orderManager.placeLimit(this.loserSide, 'BUY', loserAsk, this.config.lastCallShares)
        this.lastCallDone = true
        this.phase = 'lastcall'
      }
    }

    // ── 2. DCA REACTIVE: loser dropped from our avg cost ────────────────
    if (
      this.dcaCount < this.config.maxDcaCount &&
      loserAvgCost > 0 &&
      loserAsk > this.config.lastCallMaxPrice && // not last-call territory (handled above)
      loserAsk < this.lastDcaPrice * (1 - this.config.dcaDropTriggerPct) // dropped 25%+
    ) {
      if (this.positionManager.canBuy(this.loserSide, this.config.dcaReactiveShares, loserAsk)) {
        logger.info('DCA REACTIVE — loser dropped', {
          side: this.loserSide,
          prevPrice: this.lastDcaPrice.toFixed(3),
          newPrice: loserAsk.toFixed(3),
          drop: `${((1 - loserAsk / this.lastDcaPrice) * 100).toFixed(1)}%`,
          shares: this.config.dcaReactiveShares,
          round: this.dcaCount + 1,
        })
        await this.orderManager.placeLimit(this.loserSide, 'BUY', loserAsk, this.config.dcaReactiveShares)
        this.lastDcaPrice = loserAsk
        this.dcaCount++
      }
    }

    // ── 3. MOMENTUM FLIP: leader at very high price ──────────────────────
    if (leaderMid >= this.config.momentumFlipThreshold && !this.momentumDone) {
      if (this.positionManager.canBuy(this.leaderSide, this.config.momentumAddShares, leaderAsk)) {
        logger.info('MOMENTUM FLIP — adding to leader', {
          side: this.leaderSide, price: leaderAsk.toFixed(3),
          shares: this.config.momentumAddShares,
        })
        await this.orderManager.placeLimit(this.leaderSide, 'BUY', leaderAsk, this.config.momentumAddShares)
        this.momentumDone = true
      }
    }

    // ── 4. TAKE PROFIT: loser recovered ─────────────────────────────────
    if (loserAvgCost > 0 && loserShares > 0) {
      const gain = (loserMid - loserAvgCost) / loserAvgCost
      if (gain >= this.config.profitTargetPct) {
        logger.info('TAKE PROFIT — loser recovered', {
          side: this.loserSide,
          avgCost: loserAvgCost.toFixed(3),
          currentMid: loserMid.toFixed(3),
          gain: `+${(gain * 100).toFixed(1)}%`,
          shares: loserShares.toFixed(1),
        })
        await this.sellLadder(this.loserSide, loserAvgCost, loserMid, loserShares)
      }
    }
  }

  private async sellLadder(side: 'Up' | 'Down', avgCost: number, currentMid: number, totalShares: number): Promise<void> {
    const sharesPerSell = Math.max(5, Math.floor(totalShares / this.config.profitLadderOrders))
    const basePrice = Math.max(avgCost * 1.10, currentMid - 0.01)
    const targetPrice = Math.min(0.95, currentMid + 0.05)
    await this.orderManager.placeSellLadder(side, basePrice, targetPrice, this.config.profitLadderOrders, sharesPerSell)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
