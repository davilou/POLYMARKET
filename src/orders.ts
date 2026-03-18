import { ClobClient, Side, OrderType, TickSize } from '@polymarket/clob-client'
import { ethers } from 'ethers'
import { MarketOpportunity, ActivePosition } from './types.js'
import { logger } from './logger.js'
// ─── Use ethers v5 Wallet (same version as clob-client) for signing ──────
// The clob-client bundles ethers v5 and expects v5 Wallet._signTypedData.
// Using ethers v6 Wallet with a shim produces different EIP-712 signatures.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ethersV5 = require('@polymarket/clob-client/node_modules/ethers')

function createV5Wallet(privateKey: string): any {
  return new ethersV5.Wallet(privateKey)
}

// ─── Inicializa cliente CLOB com a wallet ─────────────────────────────────

let clobClient: ClobClient | null = null

export function initClobClient(): ClobClient {
  if (clobClient) return clobClient

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) throw new Error('PRIVATE_KEY não configurada no .env')

  const wallet = createV5Wallet(privateKey)
  const host = process.env.CLOB_API_URL ?? 'https://clob.polymarket.com'

  clobClient = new ClobClient(host, 137, wallet)
  logger.info('CLOB client initialized (no creds yet)', { address: wallet.address })
  return clobClient
}

export async function initClobClientWithAuth(): Promise<ClobClient> {
  if (clobClient?.creds) return clobClient

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) throw new Error('PRIVATE_KEY não configurada no .env')

  const wallet = createV5Wallet(privateKey)
  const host = process.env.CLOB_API_URL ?? 'https://clob.polymarket.com'

  // Step 1: Create temp client to derive API keys
  const tempClient = new ClobClient(host, 137, wallet)
  logger.info('Deriving API keys...')

  const creds = await tempClient.createOrDeriveApiKey()
  logger.info('API keys derived', { apiKey: creds.key?.slice(0, 8) + '...' })

  // Step 2: Create authenticated client with creds + proxy wallet as funder
  const funderAddress = process.env.POLY_PROXY_WALLET || undefined
  // signatureType: 0=EOA, 1=POLY_PROXY (Magic/email login), 2=GNOSIS_SAFE (browser wallet proxy)
  const signatureType = funderAddress ? 2 : 0
  clobClient = new ClobClient(host, 137, wallet, creds, signatureType, funderAddress)
  logger.info('CLOB client authenticated', {
    signer: wallet.address,
    proxyWallet: funderAddress ?? 'none',
  })
  return clobClient
}

// ─── Arredonda preço para o tick size correto ─────────────────────────────

function roundToTick(price: number, tickSize: number, direction: 'up' | 'down' = 'up'): number {
  const decimals = Math.round(-Math.log10(tickSize))
  const factor   = Math.pow(10, decimals)
  if (direction === 'up') return Math.ceil(price * factor) / factor
  return Math.floor(price * factor) / factor
}

function toTickSize(n: number): TickSize {
  const map: Record<string, TickSize> = {
    '0.1': '0.1', '0.01': '0.01', '0.001': '0.001', '0.0001': '0.0001',
  }
  return map[String(n)] ?? '0.01'
}

function calcEffectiveShares(
  targetUsdc: number, price: number, minShares: number, tickSize: number
): { shares: number; usdc: number; skipped: boolean } {
  const rawShares       = targetUsdc / price
  const effectiveShares = Math.max(rawShares, minShares * 1.05)
  const roundedShares   = Math.round(effectiveShares * 100) / 100
  const roundedPrice    = roundToTick(price, tickSize, 'up')
  const effectiveUsdc   = roundedShares * roundedPrice
  const skipped         = effectiveUsdc > targetUsdc * 3
  if (skipped) logger.debug('Order skipped: min size too high', { targetUsdc: targetUsdc.toFixed(2), minShares, wouldCost: effectiveUsdc.toFixed(2) })
  return { shares: roundedShares, usdc: effectiveUsdc, skipped }
}

// ─── Posta ordens limit nos dois lados ───────────────────────────────────

export async function postBothSides(
  opportunity: MarketOpportunity, orderSizeUsdc: number
): Promise<ActivePosition | null> {
  const client   = initClobClient()
  const upCalc   = calcEffectiveShares(orderSizeUsdc, opportunity.bestUpAsk,   opportunity.upMinOrderSize,   opportunity.upTickSize)
  const downCalc = calcEffectiveShares(orderSizeUsdc, opportunity.bestDownAsk, opportunity.downMinOrderSize, opportunity.downTickSize)

  if (upCalc.skipped || downCalc.skipped) {
    logger.warn('Skipping — min order size too high', { slug: opportunity.slug, upCost: upCalc.usdc.toFixed(2), downCost: downCalc.usdc.toFixed(2) })
    return null
  }

  const upPrice   = roundToTick(opportunity.bestUpAsk,   opportunity.upTickSize,   'up')
  const downPrice = roundToTick(opportunity.bestDownAsk, opportunity.downTickSize, 'up')

  logger.info('📤 Posting orders', { slug: opportunity.slug, upPrice: upPrice.toFixed(4), downPrice: downPrice.toFixed(4), upShares: upCalc.shares.toFixed(2), downShares: downCalc.shares.toFixed(2), totalUsdc: (upCalc.usdc + downCalc.usdc).toFixed(2) })

  try {
    const [upOrder, downOrder] = await Promise.all([
      client.createAndPostOrder({ tokenID: opportunity.upTokenId,   price: upPrice,   size: upCalc.shares,   side: Side.BUY, feeRateBps: 0 }, { tickSize: toTickSize(opportunity.upTickSize) }),
      client.createAndPostOrder({ tokenID: opportunity.downTokenId, price: downPrice, size: downCalc.shares, side: Side.BUY, feeRateBps: 0 }, { tickSize: toTickSize(opportunity.downTickSize) }),
    ])

    if (upOrder.errorMsg?.includes('INVALID_ORDER_MIN_SIZE')) {
      logger.error('Up rejected: MIN_SIZE', { slug: opportunity.slug })
      if (downOrder.orderID) await client.cancelOrder({ orderID: downOrder.orderID })
      return null
    }
    if (downOrder.errorMsg?.includes('INVALID_ORDER_MIN_SIZE')) {
      logger.error('Down rejected: MIN_SIZE', { slug: opportunity.slug })
      if (upOrder.orderID) await client.cancelOrder({ orderID: upOrder.orderID })
      return null
    }

    const position: ActivePosition = {
      slug: opportunity.slug, conditionId: opportunity.conditionId,
      upOrderId: upOrder.orderID, downOrderId: downOrder.orderID,
      upTokenId: opportunity.upTokenId, downTokenId: opportunity.downTokenId,
      upFilledSize: 0, downFilledSize: 0,
      upPrice, downPrice, totalSpentUsdc: 0,
      openedAt: new Date(), status: 'open',
    }

    logger.info('✅ Orders posted', { slug: opportunity.slug, upOrderId: upOrder.orderID, downOrderId: downOrder.orderID })
    return position
  } catch (err: any) {
    logger.error('Failed to post orders', { slug: opportunity.slug, error: err.message })
    return null
  }
}

// ─── Cancela ordens ───────────────────────────────────────────────────────

export async function cancelPosition(position: ActivePosition): Promise<void> {
  const client = initClobClient()
  for (const orderId of [position.upOrderId, position.downOrderId].filter(Boolean) as string[]) {
    try {
      await client.cancelOrder({ orderID: orderId })
      logger.info('🚫 Cancelled', { orderId, slug: position.slug })
    } catch (err: any) {
      logger.warn('Cancel failed', { orderId, error: err.message })
    }
  }
}

// ─── Status de uma ordem ──────────────────────────────────────────────────

export async function checkOrderStatus(orderId: string): Promise<{ status: string; sizeMatched: number; sizeFilled: number } | null> {
  try {
    const order   = await initClobClient().getOrder(orderId)
    const matched = parseFloat(order.size_matched ?? '0')
    return { status: order.status, sizeMatched: matched, sizeFilled: matched }
  } catch (err: any) {
    logger.warn('Check order failed', { orderId, error: err.message })
    return null
  }
}
