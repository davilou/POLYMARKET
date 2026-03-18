import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { BaseStrategy } from './strategies/base.js'
import { logger } from './logger.js'

const PORT = parseInt(process.env.DASHBOARD_PORT ?? '3456')

let strategies: BaseStrategy[]
let startTime: number
let htmlPath: string

export function startDashboardServer(strats: BaseStrategy[]): void {
  strategies = strats
  startTime = Date.now()

  htmlPath = path.resolve(process.cwd(), 'public', 'index.html')

  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      serveApiStats(res)
    } else if (req.url === '/' || req.url === '/index.html') {
      // Read fresh each time so changes are picked up without restart
      const html = fs.readFileSync(htmlPath, 'utf-8')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  server.listen(PORT, () => {
    logger.info(`Dashboard running at http://localhost:${PORT}`)
  })
}

function serveApiStats(res: http.ServerResponse): void {
  try {
    const strategyViews = strategies.map(s => ({
      name: s.name,
      stats: s.getStats(),
      openPositions: s.getOpenPositions(),
    }))

    const totals = {
      netPnl: strategyViews.reduce((sum, sv) => sum + sv.stats.netPnl, 0),
      totalVolume: strategyViews.reduce((sum, sv) => sum + sv.stats.totalVolume, 0),
      totalMarkets: strategyViews.reduce((sum, sv) => sum + sv.stats.totalMarkets, 0),
      wins: strategyViews.reduce((sum, sv) => sum + sv.stats.wins, 0),
      losses: strategyViews.reduce((sum, sv) => sum + sv.stats.losses, 0),
      openPositionCount: strategyViews.reduce((sum, sv) => sum + sv.openPositions.length, 0),
    }

    const payload = {
      timestamp: new Date().toISOString(),
      uptimeMs: Date.now() - startTime,
      strategies: strategyViews,
      totals,
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify(payload))
  } catch (err: any) {
    res.writeHead(500)
    res.end(JSON.stringify({ error: err.message }))
  }
}
