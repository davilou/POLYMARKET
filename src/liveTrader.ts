import { initClobClientWithAuth } from './orders.js'
import { fetchUpDownMarkets, buildMarketData } from './markets.js'
import { Scalper, getActiveScalper } from './scalper.js'
import { ScalperConfig } from './types.js'
import { logger } from './logger.js'

// ─── Config ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: ScalperConfig = {
  pollMs: 500,
  entryThresholdUp: parseFloat(process.env.ENTRY_THRESHOLD_UP ?? '0.35'),
  entryThresholdDown: parseFloat(process.env.ENTRY_THRESHOLD_DOWN ?? '0.30'),
  dcaOrders: parseInt(process.env.DCA_ORDERS ?? '10'),
  dcaSpreadPct: parseFloat(process.env.DCA_SPREAD_PCT ?? '0.10'),
  sharesPerOrder: parseInt(process.env.SHARES_PER_ORDER ?? '5'),
  hedgeThreshold: parseFloat(process.env.HEDGE_THRESHOLD ?? '0.55'),
  profitTargetPct: parseFloat(process.env.PROFIT_TARGET_PCT ?? '0.10'),
  profitLadderOrders: parseInt(process.env.PROFIT_LADDER_ORDERS ?? '5'),
  lastCallSecs: parseInt(process.env.LAST_CALL_SECS ?? '120'),
  lastCallMaxPrice: parseFloat(process.env.LAST_CALL_MAX_PRICE ?? '0.20'),
  lastCallShares: parseInt(process.env.LAST_CALL_SHARES ?? '5'),
  maxExposureUsdc: parseFloat(process.env.MAX_EXPOSURE_USDC ?? '50'),
  maxExposurePerSide: parseInt(process.env.MAX_EXPOSURE_PER_SIDE ?? '30'),
  stopTradingSecs: parseInt(process.env.STOP_TRADING_SECS ?? '15'),
  maxOpenOrders: parseInt(process.env.MAX_OPEN_ORDERS ?? '20'),
  staleOrderMaxAgeMs: parseInt(process.env.STALE_ORDER_MAX_AGE_MS ?? '15000'),
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
  }
}

// Keep legacy exports compatible with live.ts
export function getLivePosition() { return null }
export function getLiveStats() {
  return { sharesPerSide: DEFAULT_CONFIG.sharesPerOrder, asset: ASSET, duration: DURATION, hasPosition: getActiveScalper() !== null, positionStatus: getActiveScalper()?.getPhase() ?? 'idle' }
}

// ─── Main live loop ──────────────────────────────────────────────────────

export async function startLiveTrader(): Promise<void> {
  const client = await initClobClientWithAuth()
  logger.info('Live Trader (BoshBashBish Scalper) started', {
    asset: ASSET,
    duration: `${DURATION}m`,
    entryUp: DEFAULT_CONFIG.entryThresholdUp,
    entryDown: DEFAULT_CONFIG.entryThresholdDown,
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
