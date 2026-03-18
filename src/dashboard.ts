import { StrategyStats, StrategyPosition } from './types.js'
import { logger } from './logger.js'

export function printDashboard(allStats: StrategyStats[], openPositions: Map<string, StrategyPosition[]>): void {
  const line = '═'.repeat(78)

  console.log('\n' + '╔' + line + '╗')
  console.log('║' + ' Strategy Comparison Dashboard'.padEnd(78) + '║')
  console.log('╠' + line + '╣')
  console.log('║' + ' Strategy'.padEnd(14) + '│' + ' Markets'.padEnd(9) + '│' + ' Volume'.padEnd(10) + '│' + ' Wins'.padEnd(6) + '│' + ' Loss'.padEnd(6) + '│' + ' Net P&L'.padEnd(11) + '│' + ' AvgSum'.padEnd(8) + '│' + ' Best'.padEnd(8) + '║')
  console.log('╠' + line + '╣')

  for (const s of allStats) {
    const pnlStr = (s.netPnl >= 0 ? '+' : '') + s.netPnl.toFixed(2)
    console.log('║' +
      (' ' + s.strategyName).padEnd(14) + '│' +
      (' ' + s.totalMarkets).toString().padEnd(9) + '│' +
      (' $' + s.totalVolume.toFixed(0)).padEnd(10) + '│' +
      (' ' + s.wins).toString().padEnd(6) + '│' +
      (' ' + s.losses).toString().padEnd(6) + '│' +
      (' $' + pnlStr).padEnd(11) + '│' +
      (' ' + (s.avgSum > 0 ? s.avgSum.toFixed(3) : '-')).padEnd(8) + '│' +
      (' ' + (s.bestSum < 999 ? s.bestSum.toFixed(3) : '-')).padEnd(8) + '║'
    )
  }
  console.log('╚' + line + '╝')

  let totalOpen = 0
  for (const [name, positions] of openPositions) {
    if (positions.length > 0) {
      totalOpen += positions.length
      for (const p of positions) {
        const pnlUp = (p.upShares - p.totalSpent).toFixed(2)
        const pnlDn = (p.downShares - p.totalSpent).toFixed(2)
        logger.info('[' + name + '] Open: ' + p.title.slice(0, 50), {
          sum: p.sum > 0 ? p.sum.toFixed(3) : 'n/a',
          spent: '$' + p.totalSpent.toFixed(2),
          ifUp: '$' + pnlUp,
          ifDown: '$' + pnlDn,
        })
      }
    }
  }

  if (totalOpen === 0) {
    logger.info('No open positions across any strategy')
  }
}
