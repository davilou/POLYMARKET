/**
 * test.ts — Roda o bot em modo leitura (sem postar ordens)
 * Útil para validar a estratégia antes de arriscar capital
 *
 * Usage: npm run test
 */

import 'dotenv/config'
import { fetchActive15mMarkets, evaluateMarket, fetchSpotPrice } from './markets.js'
import { logger } from './logger.js'

const MAX_SUM    = parseFloat(process.env.MAX_SUM_TO_ENTER    ?? '0.97')
const MIN_PROFIT = parseFloat(process.env.MIN_SPREAD_TO_ENTER ?? '0.03')
const ASSETS     = (process.env.ASSETS ?? 'BTC,ETH').split(',')

async function runDryRun() {
  logger.info('🔍 DRY RUN — Reading opportunities (no orders posted)')

  // Preço spot
  for (const asset of ASSETS) {
    const price = await fetchSpotPrice(asset as any)
    logger.info(`${asset} spot price: $${price.toLocaleString()}`)
  }

  // Mercados disponíveis
  const markets = await fetchActive15mMarkets(ASSETS)
  logger.info(`Found ${markets.length} active 15m markets`)

  // Avalia cada um
  let found = 0
  for (const market of markets) {
    const opp = await evaluateMarket(market, MAX_SUM, MIN_PROFIT)
    if (opp) {
      found++
      console.log('\n─────────────────────────────────────')
      console.log(`Market   : ${opp.title}`)
      console.log(`Expires  : ${opp.expiresAt.toISOString()}`)
      console.log(`Up ask   : ${opp.bestUpAsk.toFixed(4)}`)
      console.log(`Down ask : ${opp.bestDownAsk.toFixed(4)}`)
      console.log(`Sum      : ${opp.sum.toFixed(4)}  (< ${MAX_SUM} ✅)`)
      console.log(`Profit   : $${opp.potentialProfit.toFixed(4)} per $1 wagered`)
    }
  }

  if (found === 0) {
    logger.info('No opportunities found right now — try again in a few minutes')
  } else {
    logger.info(`Found ${found} opportunities!`)
  }
}

runDryRun().catch(console.error)
