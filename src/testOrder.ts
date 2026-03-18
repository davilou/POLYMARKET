import 'dotenv/config'
import { initClobClientWithAuth } from './orders.js'
import { fetchUpDownMarkets, buildMarketData } from './markets.js'
import { logger } from './logger.js'
import { Side } from '@polymarket/clob-client'
import axios from 'axios'

const CLOB_API = process.env.CLOB_API_URL ?? 'https://clob.polymarket.com'

async function testOrder(): Promise<void> {
  logger.info('=== ORDER TEST START ===')

  // 1. Init CLOB client
  const client = await initClobClientWithAuth()
  logger.info('CLOB client ready')

  // 2. Find a current BTC 5m market
  const markets = await fetchUpDownMarkets(['BTC'])
  if (markets.length === 0) {
    logger.error('No markets found')
    return
  }

  let data = null
  for (const m of markets) {
    data = await buildMarketData(m)
    if (data) break
    logger.info(`Skipped ${m.slug} — no orderbook`)
  }
  if (!data) {
    logger.error('Could not build market data for any market')
    return
  }
  const market = data.market

  logger.info('Market found', {
    slug: market.slug,
    upTokenId: data.upTokenId.slice(0, 15) + '...',
    bestUpAsk: data.upBook.asks[0]?.price ?? 'none',
    bestDownAsk: data.downBook.asks[0]?.price ?? 'none',
    minOrderSize: data.upBook.min_order_size,
    tickSize: data.upBook.tick_size,
  })

  // 3. Get fee rate
  const { data: feeData } = await axios.get(`${CLOB_API}/fee-rate`, {
    params: { token_id: data.upTokenId }
  })
  const feeRate = feeData.fee_rate_bps ?? feeData.feeRateBps ?? 1000
  logger.info('Fee rate', { feeRateBps: feeRate })

  // 4. Place a minimum BUY order on Up side at a LOW price (unlikely to fill)
  const testPrice = 0.02  // very low price, won't fill
  const testShares = 100   // enough to exceed $1 min ($2 total)
  const tickSize = data.upBook.tick_size ?? '0.01'

  logger.info('Placing TEST order (will cancel immediately)', {
    side: 'BUY',
    token: 'Up',
    price: testPrice,
    shares: testShares,
    cost: `$${(testPrice * testShares).toFixed(2)}`,
  })

  try {
    const result = await client.createAndPostOrder(
      {
        tokenID: data.upTokenId,
        price: testPrice,
        size: testShares,
        side: Side.BUY,
        feeRateBps: feeRate,
      },
      { tickSize: tickSize as any }
    )

    if (result.errorMsg) {
      logger.error('Order REJECTED', { error: result.errorMsg })
      return
    }

    logger.info('Order PLACED successfully!', {
      orderId: result.orderID,
      status: result.status,
    })

    // 5. Wait 2 seconds then cancel
    await sleep(2000)

    logger.info('Cancelling order...')
    await client.cancelOrder({ orderID: result.orderID })
    logger.info('Order CANCELLED successfully!')

    // 6. Verify it's cancelled
    await sleep(1000)
    const order = await client.getOrder(result.orderID)
    logger.info('Order final status', { status: order.status })

  } catch (err: any) {
    logger.error('TEST FAILED', { error: err.message })
  }

  logger.info('=== ORDER TEST COMPLETE ===')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

testOrder().catch(err => {
  logger.error('Fatal', { error: err.message })
  process.exit(1)
})
