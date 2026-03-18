import 'dotenv/config'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import { logger } from './logger.js'
import { updateSpotPrices } from './spot.js'
import { startLiveTrader, getLivePosition, getLiveStats, getScalperState } from './liveTrader.js'
import { getActiveScalper } from './scalper.js'

// ─── Config ──────────────────────────────────────────────────────────────

const SPOT_MS = parseInt(process.env.SPOT_INTERVAL_MS ?? '500')

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync('logs', { recursive: true })

  if (!process.env.PRIVATE_KEY) {
    logger.error('PRIVATE_KEY not set in .env — cannot run live mode')
    process.exit(1)
  }

  logger.info('========================================')
  logger.info('   LIVE MODE — REAL MONEY TRADING')
  logger.info('========================================')
  logger.info('Config', {
    budget: process.env.LIVE_BUDGET ?? '100',
    asset: 'BTC',
    market: '5m Up/Down',
    strategy: 'BoshBashBish Scalper',
    leaderThreshold: process.env.LEADER_THRESHOLD ?? '0.52',
    primaryShares: process.env.PRIMARY_SHARES ?? '15',
    secondaryShares: process.env.SECONDARY_SHARES ?? '5',
    maxExposure: process.env.MAX_EXPOSURE_USDC ?? '30',
  })

  // Start spot price updates
  setInterval(() => updateSpotPrices(['BTC']), SPOT_MS)
  await updateSpotPrices(['BTC'])

  // Start dashboard
  startLiveDashboard()

  // Warm up spot history
  logger.info('Warming up spot price history (5s)...')
  await sleep(5000)

  // Start live trading
  await startLiveTrader()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const DASH_PORT = parseInt(process.env.DASHBOARD_PORT ?? '3456')
const liveStartTime = Date.now()

function startLiveDashboard(): void {
  const htmlPath = path.resolve(process.cwd(), 'public', 'index.html')

  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      const scalperState = getScalperState()
      const pos = scalperState?.position
      const payload = {
        timestamp: new Date().toISOString(),
        uptimeMs: Date.now() - liveStartTime,
        mode: 'LIVE — BoshBashBish Scalper',
        scalper: scalperState,
        strategies: [{
          name: 'BoshBashBish Scalper (BTC 5m)',
          stats: {
            netPnl: pos?.realizedPnl ?? 0,
            totalVolume: (pos?.upTotalSpent ?? 0) + (pos?.downTotalSpent ?? 0),
            totalMarkets: 1,
            wins: (pos?.realizedPnl ?? 0) > 0 ? 1 : 0,
            losses: (pos?.realizedPnl ?? 0) < 0 ? 1 : 0,
          },
          openPositions: scalperState ? [{
            phase: scalperState.phase,
            summary: scalperState.summary,
            openOrders: scalperState.openOrders,
            upShares: pos?.upShares ?? 0,
            downShares: pos?.downShares ?? 0,
            upAvgCost: pos?.upAvgCost ?? 0,
            downAvgCost: pos?.downAvgCost ?? 0,
            realizedPnl: pos?.realizedPnl ?? 0,
          }] : [],
        }],
        totals: {
          netPnl: pos?.realizedPnl ?? 0,
          totalVolume: (pos?.upTotalSpent ?? 0) + (pos?.downTotalSpent ?? 0),
          totalMarkets: 1,
          wins: (pos?.realizedPnl ?? 0) > 0 ? 1 : 0,
          losses: (pos?.realizedPnl ?? 0) < 0 ? 1 : 0,
          openPositionCount: scalperState?.openOrders ?? 0,
        },
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(payload))
    } else if (req.url === '/' || req.url === '/index.html') {
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      } catch {
        res.writeHead(404)
        res.end('public/index.html not found')
      }
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  server.listen(DASH_PORT, () => {
    logger.info(`Live dashboard at http://localhost:${DASH_PORT}`)
  })
}

process.on('SIGINT', async () => {
  logger.info('Shutting down live trader...')
  const scalper = getActiveScalper()
  if (scalper) {
    await scalper.shutdown()
  }
  process.exit(0)
})

main().catch(err => {
  logger.error('Fatal error', { error: err.message })
  process.exit(1)
})
