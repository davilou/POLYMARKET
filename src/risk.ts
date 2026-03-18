import { ActivePosition, BotConfig } from './types.js'
// fetchSpotPrice removed — risk module is legacy
import { cancelPosition, initClobClient } from './orders.js'
import { logger } from './logger.js'
import { Side, OrderType } from '@polymarket/clob-client'

// ─── Snapshot de preço para detectar movimentos ───────────────────────────

const priceSnapshots: Map<string, { price: number; time: number }> = new Map()

export async function takeSnapshot(_asset: 'BTC' | 'ETH' | 'SOL' | 'XRP'): Promise<void> {
  // Legacy — use spot.ts instead
}

export function updateSnapshot(asset: string, price: number): void {
  priceSnapshots.set(asset, { price, time: Date.now() })
}

export function getPriceMovePct(asset: string, currentPrice: number): number {
  const snapshot = priceSnapshots.get(asset)
  if (!snapshot || snapshot.price === 0) return 0
  return Math.abs(currentPrice - snapshot.price) / snapshot.price * 100
}

// ─── Detecta desequilíbrio entre os dois lados ────────────────────────────
// Retorna qual lado está "preso" (cheio mas o outro não executou)

export function detectImbalance(position: ActivePosition): {
  hasImbalance: boolean
  exposedSide: 'up' | 'down' | null
  exposedShares: number
  imbalanceRatio: number
} {
  const up   = position.upFilledSize
  const down = position.downFilledSize

  // Se nenhum foi preenchido ainda, sem desequilíbrio
  if (up === 0 && down === 0) {
    return { hasImbalance: false, exposedSide: null, exposedShares: 0, imbalanceRatio: 0 }
  }

  const total = up + down
  const upRatio   = up   / total
  const downRatio = down / total

  // Considera desequilíbrio se um lado tem >80% das shares preenchidas
  // e o outro tem menos de 20% (ou seja, quase nada do outro lado executou)
  const IMBALANCE_THRESHOLD = 0.80

  if (upRatio > IMBALANCE_THRESHOLD && down < up * 0.20) {
    return {
      hasImbalance:   true,
      exposedSide:    'up',
      exposedShares:  up - down,  // shares descobertas
      imbalanceRatio: upRatio,
    }
  }

  if (downRatio > IMBALANCE_THRESHOLD && up < down * 0.20) {
    return {
      hasImbalance:   true,
      exposedSide:    'down',
      exposedShares:  down - up,
      imbalanceRatio: downRatio,
    }
  }

  return { hasImbalance: false, exposedSide: null, exposedShares: 0, imbalanceRatio: 0 }
}

// ─── Hedge emergencial — vende o lado exposto no mercado ─────────────────
// Quando ficamos presos em só um lado, vendemos as shares descobertas
// a mercado para zerar a exposição (aceita perda no spread)

export async function emergencyHedge(
  position: ActivePosition,
  dryRun: boolean
): Promise<void> {
  const { hasImbalance, exposedSide, exposedShares } = detectImbalance(position)

  if (!hasImbalance || !exposedSide || exposedShares <= 0) return

  const tokenId = exposedSide === 'up'
    ? position.upTokenId
    : position.downTokenId

  if (!tokenId) {
    logger.error('Emergency hedge: no tokenId for exposed side', {
      slug: position.slug, exposedSide,
    })
    return
  }

  logger.warn('🚨 EMERGENCY HEDGE triggered', {
    slug:          position.slug,
    exposedSide,
    exposedShares: exposedShares.toFixed(2),
    dryRun,
  })

  if (dryRun) {
    logger.info('[DRY RUN] Would sell exposed shares at market', {
      slug:    position.slug,
      side:    exposedSide,
      shares:  exposedShares.toFixed(2),
    })
    return
  }

  try {
    const client = initClobClient()

    // Cancela a ordem pendente do lado que NÃO executou
    const pendingOrderId = exposedSide === 'up'
      ? position.downOrderId   // Up executou, Down está pendente
      : position.upOrderId

    if (pendingOrderId) {
      await client.cancelOrder({ orderID: pendingOrderId })
      logger.info('Cancelled pending order before hedge', { orderId: pendingOrderId })
    }

    // Vende as shares descobertas a mercado via FOK
    const sellOrder = await client.createAndPostMarketOrder(
      {
        tokenID:    tokenId,
        amount:     Math.floor(exposedShares * 100) / 100,
        side:       Side.SELL,
        feeRateBps: 0,
      },
      {},
      OrderType.FOK
    )

    if (sellOrder.orderID) {
      logger.info('✅ Emergency hedge executed', {
        slug:    position.slug,
        side:    exposedSide,
        orderId: sellOrder.orderID,
        shares:  exposedShares.toFixed(2),
      })
      position.status = 'cancelled'
    } else {
      logger.error('Emergency hedge order failed', {
        slug:     position.slug,
        errorMsg: sellOrder.errorMsg,
      })
    }
  } catch (err: any) {
    logger.error('Emergency hedge exception', {
      slug:  position.slug,
      error: err.message,
    })
  }
}

// ─── Verifica risco completo da posição ──────────────────────────────────

export async function checkRiskAndCancel(
  position: ActivePosition,
  config: BotConfig,
  currentPrices: Map<string, number>,
  dryRun = false
): Promise<boolean> {
  const slug  = position.slug
  const now   = Date.now()
  const ageMs = now - position.openedAt.getTime()

  // 1. Timeout — cancela se ainda aberta após 14 min
  if (position.status === 'open' && ageMs > 14 * 60 * 1000) {
    logger.warn('⏰ Position timeout — cancelling', { slug })
    if (!dryRun) await cancelPosition(position)
    else logger.info('[DRY RUN] Would cancel timed-out position', { slug })
    return true
  }

  // 2. Preço moveu demais — inventory risk
  for (const asset of config.assets) {
    const currentPrice = currentPrices.get(asset)
    const snapshot     = priceSnapshots.get(asset)

    if (currentPrice && snapshot && snapshot.price > 0) {
      const movePct = Math.abs(currentPrice - snapshot.price) / snapshot.price * 100

      if (movePct > config.cancelIfPriceMovePct) {
        logger.warn('⚡ Price moved too fast — triggering hedge check', {
          slug, asset,
          movePct:   movePct.toFixed(2) + '%',
          threshold: config.cancelIfPriceMovePct + '%',
        })

        // Tenta hedge emergencial antes de simplesmente cancelar
        await emergencyHedge(position, dryRun)

        if (!dryRun) await cancelPosition(position)
        else logger.info('[DRY RUN] Would cancel after price move', { slug })
        return true
      }
    }
  }

  // 3. Desequilíbrio detectado — um lado preencheu, o outro não
  const imbalance = detectImbalance(position)
  if (imbalance.hasImbalance) {
    const ageMinutes = ageMs / 60_000

    // Espera pelo menos 2 minutos antes de acionar hedge
    // (o outro lado pode ainda executar)
    if (ageMinutes > 2) {
      logger.warn('⚠️  Side imbalance detected — emergency hedge', {
        slug,
        exposedSide:   imbalance.exposedSide,
        exposedShares: imbalance.exposedShares.toFixed(2),
        ratio:         (imbalance.imbalanceRatio * 100).toFixed(0) + '%',
        ageMin:        ageMinutes.toFixed(1),
      })
      await emergencyHedge(position, dryRun)
      return true
    } else {
      logger.debug('Imbalance detected but waiting for fill', {
        slug,
        ageMin: ageMinutes.toFixed(1),
      })
    }
  }

  // 4. Exposição excedida
  if (position.totalSpentUsdc > config.maxExposurePerMarket) {
    logger.warn('💰 Max exposure reached — cancelling', {
      slug,
      spent: position.totalSpentUsdc.toFixed(2),
      max:   config.maxExposurePerMarket,
    })
    if (!dryRun) await cancelPosition(position)
    else logger.info('[DRY RUN] Would cancel over-exposed position', { slug })
    return true
  }

  return false
}

// ─── Kelly Criterion simplificado para sizing ─────────────────────────────

export function kellySizing(
  winRate: number,
  avgWin: number,
  avgLoss: number,
  bankroll: number,
  maxFraction = 0.05
): number {
  if (avgLoss === 0) return 0
  const b = avgWin / avgLoss
  const p = winRate
  const q = 1 - winRate
  const kellyFraction = (b * p - q) / b
  const safeFraction  = Math.min(Math.max(kellyFraction, 0), maxFraction)
  return bankroll * safeFraction
}
