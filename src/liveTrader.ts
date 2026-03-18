import { initClobClientWithAuth } from './orders.js'
import { fetchUpDownMarkets, buildMarketData } from './markets.js'
import { Scalper, getActiveScalper } from './scalper.js'
import { ScalperConfig } from './types.js'
import { logger } from './logger.js'

// ─── Config ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ScalperConfig = {
  pollMs: 500,
  leaderThreshold:          parseFloat(process.env.LEADER_THRESHOLD         ?? '0.52'),
  primaryShares:            parseInt (process.env.PRIMARY_SHARES             ?? '15'),
  secondaryShares:          parseInt (process.env.SECONDARY_SHARES           ?? '5'),
  dcaDropTriggerPct:        parseFloat(process.env.DCA_DROP_TRIGGER_PCT      ?? '0.25'),
  dcaReactiveShares:        parseInt (process.env.DCA_REACTIVE_SHARES        ?? '10'),
  maxDcaCount:              parseInt (process.env.MAX_DCA_COUNT              ?? '3'),
  momentumFlipThreshold:    parseFloat(process.env.MOMENTUM_FLIP_THRESHOLD   ?? '0.78'),
  momentumAddShares:        parseInt (process.env.MOMENTUM_ADD_SHARES        ?? '5'),
  lastCallMaxPrice:         parseFloat(process.env.LAST_CALL_MAX_PRICE       ?? '0.09'),
  lastCallShares:           parseInt (process.env.LAST_CALL_SHARES           ?? '10'),
  profitTargetPct:          parseFloat(process.env.PROFIT_TARGET_PCT         ?? '0.20'),
  profitLadderOrders:       parseInt (process.env.PROFIT_LADDER_ORDERS       ?? '3'),
  maxExposureUsdc:          parseFloat(process.env.MAX_EXPOSURE_USDC         ?? '30'),
  maxExposurePerSide:       parseInt (process.env.MAX_EXPOSURE_PER_SIDE      ?? '50'),
  stopTradingSecs:          parseInt (process.env.STOP_TRADING_SECS          ?? '15'),
  staleOrderMaxAgeMs:       parseInt (process.env.STALE_ORDER_MAX_AGE_MS     ?? '15000'),
  maxOpenOrders:            parseInt (process.env.MAX_OPEN_ORDERS            ?? '20'),
}

const ASSET = 'BTC'
const DURATION = 5  // 5m markets only

// ─── Exported for dashboard ──────────────────────────────────────────────

export function getScalperState() {
  const scalper = getActiveScalper()
  if (!scalper) return null
  return {
    phase: scalper.getPhase(),
    position: scalper.getPosition(),
    openOrders: scalper.getOrderCount(),
    summary: scalper.getSummary(),
    leaderSide: scalper.getLeaderSide(),
    loserSide: scalper.getLoserSide(),
  }
}

// Keep legacy exports compatible with live.ts
export function getLivePosition() { return null }
export function getLiveStats() {
  return {
    primaryShares: DEFAULT_CONFIG.primaryShares,
    secondaryShares: DEFAULT_CONFIG.secondaryShares,
    asset: ASSET,
    duration: DURATION,
    hasPosition: getActiveScalper() !== null,
    positionStatus: getActiveScalper()?.getPhase() ?? 'idle',
  }
}

// ─── Main live loop ──────────────────────────────────────────────────────

export async function startLiveTrader(): Promise<void> {
  const client = await initClobClientWithAuth()
  logger.info('Live Trader (BoshBashBish Scalper) started', {
    asset: ASSET,
    duration: `${DURATION}m`,
    leaderThreshold: DEFAULT_CONFIG.leaderThreshold,
    primaryShares: DEFAULT_CONFIG.primaryShares,
    secondaryShares: DEFAULT_CONFIG.secondaryShares,
    maxExposure: `$${DEFAULT_CONFIG.maxExposureUsdc}`,
  })

  while (true) {
    try {
      const now = Math.floor(Date.now() / 1000)
      const interval = DURATION * 60
      const nextStart = Math.ceil(now / interval) * interval
      const secsUntilStart = nextStart - now

      // Wait until 5s before market opens
      if (secsUntilStart > 30) {
        await sleep(Math.min((secsUntilStart - 25) * 1000, 10_000))
        continue
      }

      const slug = `btc-updown-${DURATION}m-${nextStart}`
      const endTimestamp = (nextStart + DURATION * 60) * 1000

      logger.info(`Looking for market: ${slug} (opens in ${secsUntilStart}s)`)

      const markets = await fetchUpDownMarkets([ASSET])
      const market = markets.find(m => m.slug === slug)

      if (!market) {
        logger.info(`Market not yet available: ${slug}`)
        await sleep(2000)
        continue
      }

      const data = await buildMarketData(market)
      if (!data) {
        logger.warn(`Could not build market data: ${slug}`)
        await sleep(2000)
        continue
      }

      const tickSize = parseFloat(data.upBook.tick_size ?? '0.01')

      // Wait until market actually opens
      const waitMs = Math.max(0, (nextStart * 1000) - Date.now())
      if (waitMs > 0) {
        logger.info(`Waiting ${(waitMs / 1000).toFixed(1)}s for market to open...`)
        await sleep(waitMs)
      }

      logger.info('Starting scalper', {
        slug,
        upToken: data.upTokenId.slice(0, 10),
        downToken: data.downTokenId.slice(0, 10),
        tickSize,
      })

      const scalper = new Scalper(
        DEFAULT_CONFIG,
        client,
        data.upTokenId,
        data.downTokenId,
        endTimestamp,
        tickSize,
      )

      const result = await scalper.run()

      logger.info('Scalper cycle complete', {
        slug,
        finalPnl: `$${result.finalPnl.toFixed(2)}`,
        trades: result.trades.length,
        upShares: result.upShares.toFixed(1),
        downShares: result.downShares.toFixed(1),
      })

      // Brief pause before looking for next market
      await sleep(3000)
    } catch (err: any) {
      logger.error('Live trader error', { error: err.message })
      await sleep(5000)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
