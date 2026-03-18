import { ClobClient, Side, OrderType } from '@polymarket/clob-client'
import { LocalOrder, FillEvent, ScalperConfig } from './types.js'
import { logger } from './logger.js'

type TickSizeStr = '0.1' | '0.01' | '0.001' | '0.0001'

function toTickSize(n: number): TickSizeStr {
  const map: Record<string, TickSizeStr> = {
    '0.1': '0.1', '0.01': '0.01', '0.001': '0.001', '0.0001': '0.0001',
  }
  return map[String(n)] ?? '0.01'
}

function roundToTick(price: number, tickSize: number): number {
  const factor = Math.round(1 / tickSize)
  return Math.round(price * factor) / factor
}

export class OrderManager {
  private orders = new Map<string, LocalOrder>()
  private feeRateBps = 0

  constructor(
    private readonly client: ClobClient,
    private readonly upTokenId: string,
    private readonly downTokenId: string,
    private readonly tickSize: number,
    private readonly config: ScalperConfig,
  ) {}

  setFeeRate(bps: number): void {
    this.feeRateBps = bps
  }

  async placeLimit(
    tokenSide: 'Up' | 'Down',
    side: 'BUY' | 'SELL',
    price: number,
    size: number,
  ): Promise<string | null> {
    const tokenId = tokenSide === 'Up' ? this.upTokenId : this.downTokenId
    const roundedPrice = roundToTick(price, this.tickSize)
    const clobSide = side === 'BUY' ? Side.BUY : Side.SELL
    const tick = toTickSize(this.tickSize)
    try {
      const result = await this.client.createAndPostOrder(
        { tokenID: tokenId, price: roundedPrice, size, side: clobSide, feeRateBps: this.feeRateBps },
        { tickSize: tick },
      )
      if (result.errorMsg) {
        logger.warn('Order rejected', { tokenSide, side, price: roundedPrice, size, error: result.errorMsg })
        return null
      }
      const orderId = result.orderID as string
      const order: LocalOrder = {
        id: orderId, side, tokenSide, price: roundedPrice,
        size, placedAt: Date.now(), filledSize: 0,
      }
      this.orders.set(orderId, order)
      logger.debug('Order placed', { orderId: orderId.slice(0, 8), tokenSide, side, price: roundedPrice, size })
      return orderId
    } catch (err: any) {
      logger.warn('placeLimit error', { tokenSide, side, price, size, error: err.message })
      return null
    }
  }

  async placeDCALadder(
    tokenSide: 'Up' | 'Down',
    basePrice: number,
    spreadPct: number,
    numOrders: number,
    sharesEach: number,
  ): Promise<string[]> {
    const tokenId = tokenSide === 'Up' ? this.upTokenId : this.downTokenId
    const tick = toTickSize(this.tickSize)

    // Build N orders from basePrice down to basePrice * (1 - spreadPct)
    const step = (basePrice * spreadPct) / Math.max(numOrders - 1, 1)
    const signedOrders = []
    const pricePoints = []

    for (let i = 0; i < numOrders; i++) {
      const price = roundToTick(basePrice - i * step, this.tickSize)
      // Don't place orders below 0.01
      if (price < 0.01) break
      pricePoints.push(price)
      try {
        const signed = await this.client.createOrder(
          { tokenID: tokenId, price, size: sharesEach, side: Side.BUY, feeRateBps: this.feeRateBps },
          { tickSize: tick },
        )
        signedOrders.push({ order: signed, orderType: OrderType.GTC, price })
      } catch (err: any) {
        logger.warn('createOrder error in DCA', { i, price, error: err.message })
      }
    }

    if (signedOrders.length === 0) return []

    try {
      const results = await this.client.postOrders(
        signedOrders.map(s => ({ order: s.order, orderType: s.orderType }))
      )
      const ids: string[] = []
      const resultArr = Array.isArray(results) ? results : [results]

      for (let i = 0; i < resultArr.length; i++) {
        const r = resultArr[i]
        const orderId = r?.orderID ?? r?.order_id
        if (!orderId || r?.errorMsg) {
          logger.warn('DCA order rejected', { i, price: signedOrders[i]?.price, error: r?.errorMsg })
          continue
        }
        const order: LocalOrder = {
          id: orderId, side: 'BUY', tokenSide,
          price: pricePoints[i] ?? basePrice,
          size: sharesEach, placedAt: Date.now(), filledSize: 0,
        }
        this.orders.set(orderId, order)
        ids.push(orderId)
      }
      logger.info('DCA ladder placed', { tokenSide, numOrders: ids.length, basePrice, spreadPct })
      return ids
    } catch (err: any) {
      logger.warn('postOrders batch error', { error: err.message })
      // Fallback: place individually
      return this.placeDCAFallback(tokenSide, basePrice, spreadPct, numOrders, sharesEach)
    }
  }

  private async placeDCAFallback(
    tokenSide: 'Up' | 'Down',
    basePrice: number,
    spreadPct: number,
    numOrders: number,
    sharesEach: number,
  ): Promise<string[]> {
    const step = (basePrice * spreadPct) / Math.max(numOrders - 1, 1)
    const ids: string[] = []
    for (let i = 0; i < numOrders; i++) {
      const price = roundToTick(basePrice - i * step, this.tickSize)
      if (price < 0.01) break
      const id = await this.placeLimit(tokenSide, 'BUY', price, sharesEach)
      if (id) ids.push(id)
    }
    return ids
  }

  async placeSellLadder(
    tokenSide: 'Up' | 'Down',
    basePrice: number,
    targetPrice: number,
    numOrders: number,
    sharesEach: number,
  ): Promise<string[]> {
    const step = (targetPrice - basePrice) / Math.max(numOrders - 1, 1)
    const ids: string[] = []
    for (let i = 0; i < numOrders; i++) {
      const price = roundToTick(basePrice + i * step, this.tickSize)
      if (price <= 0 || price > 1) continue
      const id = await this.placeLimit(tokenSide, 'SELL', price, sharesEach)
      if (id) ids.push(id)
    }
    logger.info('Sell ladder placed', { tokenSide, numOrders: ids.length, basePrice, targetPrice })
    return ids
  }

  async reconcile(): Promise<FillEvent[]> {
    const fills: FillEvent[] = []
    if (this.orders.size === 0) return fills

    try {
      const [upOrders, downOrders] = await Promise.all([
        this.client.getOpenOrders({ asset_id: this.upTokenId }),
        this.client.getOpenOrders({ asset_id: this.downTokenId }),
      ])

      const openById = new Map<string, typeof upOrders[0]>()
      for (const o of [...upOrders, ...downOrders]) openById.set(o.id, o)

      for (const [id, local] of this.orders.entries()) {
        const remote = openById.get(id)
        if (!remote) {
          // Order no longer open — fully filled or cancelled
          const newFill = local.size - local.filledSize
          if (newFill > 0) {
            fills.push({ orderId: id, tokenSide: local.tokenSide, side: local.side, price: local.price, filledSize: newFill })
          }
          this.orders.delete(id)
          continue
        }
        const remoteFilled = parseFloat(remote.size_matched ?? '0')
        if (remoteFilled > local.filledSize) {
          const newFill = remoteFilled - local.filledSize
          fills.push({ orderId: id, tokenSide: local.tokenSide, side: local.side, price: local.price, filledSize: newFill })
          local.filledSize = remoteFilled
        }
      }
    } catch (err: any) {
      logger.warn('reconcile error', { error: err.message })
    }

    return fills
  }

  async cancelStale(maxAgeMs: number): Promise<void> {
    const now = Date.now()
    for (const [id, order] of this.orders.entries()) {
      if (now - order.placedAt > maxAgeMs && order.filledSize === 0) {
        await this.cancelById(id)
      }
    }
  }

  async cancelSide(tokenSide: 'Up' | 'Down'): Promise<void> {
    const toCancel = [...this.orders.entries()]
      .filter(([, o]) => o.tokenSide === tokenSide)
      .map(([id]) => id)
    for (const id of toCancel) await this.cancelById(id)
  }

  async cancelAll(): Promise<void> {
    try {
      await this.client.cancelAll()
      this.orders.clear()
      logger.info('All orders cancelled')
    } catch (err: any) {
      logger.warn('cancelAll error', { error: err.message })
      // Fallback: cancel individually
      for (const id of [...this.orders.keys()]) await this.cancelById(id)
    }
  }

  getOpenCount(tokenSide?: 'Up' | 'Down'): number {
    if (!tokenSide) return this.orders.size
    return [...this.orders.values()].filter(o => o.tokenSide === tokenSide).length
  }

  private async cancelById(id: string): Promise<void> {
    try {
      await this.client.cancelOrder({ orderID: id })
      this.orders.delete(id)
      logger.debug('Cancelled order', { id: id.slice(0, 8) })
    } catch (err: any) {
      logger.warn('cancelOrder error', { id: id.slice(0, 8), error: err.message })
    }
  }
}
