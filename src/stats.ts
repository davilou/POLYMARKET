import { BotStats, ActivePosition } from './types.js'
import { logger } from './logger.js'
import * as fs from 'fs'

const STATS_FILE = 'logs/stats.json'

// ─── Carrega ou inicializa stats ──────────────────────────────────────────

export function loadStats(): BotStats {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, 'utf-8')
      return JSON.parse(raw)
    }
  } catch {}

  return {
    totalTrades:      0,
    totalVolumeUsdc:  0,
    totalRedeemedUsdc: 0,
    totalRebateUsdc:  0,
    netPnl:           0,
    wins:             0,
    losses:           0,
    startedAt:        new Date(),
  }
}

export function saveStats(stats: BotStats): void {
  try {
    fs.mkdirSync('logs', { recursive: true })
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
  } catch (err: any) {
    logger.error('Failed to save stats', { error: err.message })
  }
}

// ─── Registra resultado de uma posição fechada ────────────────────────────

export function recordPositionResult(
  stats: BotStats,
  position: ActivePosition,
  redeemedUsdc: number,
  rebateUsdc: number
): BotStats {
  const pnl = redeemedUsdc + rebateUsdc - position.totalSpentUsdc

  stats.totalTrades      += 1
  stats.totalVolumeUsdc  += position.totalSpentUsdc
  stats.totalRedeemedUsdc += redeemedUsdc
  stats.totalRebateUsdc  += rebateUsdc
  stats.netPnl           += pnl

  if (pnl >= 0) stats.wins++
  else stats.losses++

  saveStats(stats)

  logger.info(pnl >= 0 ? '✅ WIN' : '❌ LOSS', {
    slug:      position.slug,
    spent:     position.totalSpentUsdc.toFixed(2),
    redeemed:  redeemedUsdc.toFixed(2),
    rebate:    rebateUsdc.toFixed(2),
    pnl:       pnl.toFixed(2),
    totalPnl:  stats.netPnl.toFixed(2),
    winRate:   ((stats.wins / stats.totalTrades) * 100).toFixed(1) + '%',
  })

  return stats
}

// ─── Imprime resumo a cada N trades ───────────────────────────────────────

export function printSummary(stats: BotStats): void {
  const winRate = stats.totalTrades > 0
    ? (stats.wins / stats.totalTrades * 100).toFixed(1)
    : '0'

  const runtimeHours = (Date.now() - new Date(stats.startedAt).getTime()) / 3_600_000

  logger.info('📈 BOT SUMMARY', {
    uptime:        runtimeHours.toFixed(1) + 'h',
    totalTrades:   stats.totalTrades,
    volume:        '$' + stats.totalVolumeUsdc.toFixed(2),
    redeemed:      '$' + stats.totalRedeemedUsdc.toFixed(2),
    rebate:        '$' + stats.totalRebateUsdc.toFixed(2),
    netPnl:        '$' + stats.netPnl.toFixed(2),
    wins:          stats.wins,
    losses:        stats.losses,
    winRate:       winRate + '%',
    pnlPerHour:    '$' + (stats.netPnl / Math.max(runtimeHours, 0.1)).toFixed(2),
  })
}
