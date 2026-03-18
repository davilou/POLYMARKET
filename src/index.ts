import 'dotenv/config'
import * as fs from 'fs'
import { logger } from './logger.js'
import { updateSpotPrices } from './spot.js'
import { fetchUpDownMarkets, buildMarketData } from './markets.js'
import { resolveMarketOutcome } from './tracker.js'
import { printDashboard } from './dashboard.js'
import { BaseStrategy } from './strategies/base.js'
import { startDashboardServer } from './server.js'
import { MomentumStrategy } from './strategies/momentum.js'
import { MeanReversionStrategy } from './strategies/meanReversion.js'
import { PureArbStrategy } from './strategies/pureArb.js'
import { HybridStrategy } from './strategies/hybrid.js'
import { StrategyPosition } from './types.js'

// ─── Config ─────────────────────────────────────────────────────────────

const BUDGET      = parseFloat(process.env.BUDGET_PER_MARKET ?? '750')
const POLL_MS     = parseInt(process.env.POLL_INTERVAL_MS ?? '3000')
const SPOT_MS     = parseInt(process.env.SPOT_INTERVAL_MS ?? '1000')
const ASSETS      = (process.env.ASSETS ?? 'BTC,ETH').split(',')
const DASHBOARD_EVERY = 100  // ticks (~5 min at 3s)

// ─── Initialize strategies ──────────────────────────────────────────────

const strategies: BaseStrategy[] = [
  new MomentumStrategy(BUDGET),
  new MeanReversionStrategy(BUDGET),
  new PureArbStrategy(BUDGET),
  new HybridStrategy(BUDGET),
]

// ─── Track processed markets ────────────────────────────────────────────

const pendingResolution = new Map<string, { conditionId: string; expiresAt: Date; slug: string }>()
let tickCount = 0

// ─── Main loop ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync('logs', { recursive: true })

  // Start web dashboard
  startDashboardServer(strategies)

  logger.info('Multi-Strategy Bot starting in DRY RUN mode', {
    strategies: strategies.map(s => s.name),
    budget: BUDGET,
    assets: ASSETS,
    pollMs: POLL_MS,
  })

  // Start spot price updates on a faster interval
  setInterval(() => updateSpotPrices(ASSETS), SPOT_MS)
  await updateSpotPrices(ASSETS)

  // Wait a few seconds for spot price history to build
  logger.info('Warming up spot price history (5s)...')
  await sleep(5000)

  while (true) {
    try {
      await tick()
    } catch (err: any) {
      logger.error('Main loop error', { error: err.message })
    }
    await sleep(POLL_MS)
  }
}

// ─── One tick ───────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  tickCount++

  // 1. Fetch active markets
  const markets = await fetchUpDownMarkets(ASSETS)

  // 2. Build market data with orderbooks
  for (const market of markets) {
    const data = await buildMarketData(market)
    if (!data) continue
    if (data.minsToExpiry < 2) continue

    // 3. Pass to each strategy
    for (const strategy of strategies) {
      strategy.process(data)
    }

    // Track for resolution
    if (!pendingResolution.has(market.slug)) {
      pendingResolution.set(market.slug, {
        conditionId: market.conditionId,
        expiresAt: data.endTime,
        slug: market.slug,
      })
    }
  }

  // 4. Check for resolved markets
  await checkResolutions()

  // 5. Dashboard
  if (tickCount % DASHBOARD_EVERY === 0) {
    showDashboard()
  }
}

// ─── Resolution checker ─────────────────────────────────────────────────

async function checkResolutions(): Promise<void> {
  const now = Date.now()

  for (const [slug, info] of pendingResolution) {
    // Only check after market should have ended (add 2 min buffer for resolution)
    if (now < info.expiresAt.getTime() + 2 * 60 * 1000) continue

    const outcome = await resolveMarketOutcome(info.conditionId)
    if (!outcome) continue

    logger.info(`Market resolved: ${slug} → ${outcome}`)

    for (const strategy of strategies) {
      strategy.resolveMarket(slug, outcome)
    }

    pendingResolution.delete(slug)

    // Show dashboard after every resolution
    showDashboard()
  }
}

// ─── Dashboard ──────────────────────────────────────────────────────────

function showDashboard(): void {
  const allStats = strategies.map(s => s.getStats())
  const openPositions = new Map<string, StrategyPosition[]>()
  for (const s of strategies) {
    openPositions.set(s.name, s.getOpenPositions())
  }
  printDashboard(allStats, openPositions)
}

// ─── Utils ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

process.on('SIGINT', () => {
  logger.info('Shutting down...')
  showDashboard()
  process.exit(0)
})

main().catch(err => {
  logger.error('Fatal error', { error: err.message })
  process.exit(1)
})
