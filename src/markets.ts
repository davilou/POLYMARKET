import axios from 'axios'
import { Market, OrderBook, MarketData } from './types.js'
import { logger } from './logger.js'
import { getSpotPrice, getSpotMomentum } from './spot.js'

const GAMMA_API = process.env.GAMMA_API_URL ?? 'https://gamma-api.polymarket.com'
const CLOB_API  = process.env.CLOB_API_URL  ?? 'https://clob.polymarket.com'

export async function fetchUpDownMarkets(assets: string[]): Promise<Market[]> {
  try {
    const now = Math.floor(Date.now() / 1000)
    const durations = [5, 15] // 5m and 15m markets
    const assetSlugs: Record<string, string> = {
      BTC: 'btc',
      ETH: 'eth',
      SOL: 'sol',
      XRP: 'xrp',
    }

    // Generate slugs for current and upcoming market windows
    const slugs: string[] = []
    for (const asset of assets) {
      const prefix = assetSlugs[asset.toUpperCase()] || asset.toLowerCase()
      for (const dur of durations) {
        const interval = dur * 60
        // Round down to current interval boundary
        const currentStart = Math.floor(now / interval) * interval
        // Generate slugs: previous, current, and next few windows
        for (let offset = -1; offset <= 3; offset++) {
          const startTs = currentStart + offset * interval
          slugs.push(`${prefix}-updown-${dur}m-${startTs}`)
        }
      }
    }

    // Fetch all slugs in parallel
    const results = await Promise.allSettled(
      slugs.map(slug =>
        axios.get(`${GAMMA_API}/markets`, { params: { slug } })
          .then(res => res.data as any[])
      )
    )

    const markets: Market[] = []
    const seen = new Set<string>()

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value?.length) continue
      for (const m of result.value) {
        if (m.closed || seen.has(m.slug)) continue

        // Allow markets starting within next 5 minutes (pre-market limit orders)
        const slugMatch = m.slug.match(/(\d+)m-(\d+)$/)
        if (slugMatch) {
          const startTimestamp = parseInt(slugMatch[2])
          if (startTimestamp > now + 300) continue  // more than 5 min ahead, skip
        }

        seen.add(m.slug)
        markets.push(m)
      }
    }

    logger.info(`Fetched ${markets.length} active Up/Down markets from ${slugs.length} slug lookups`, { assets })
    return markets
  } catch (err: any) {
    logger.error('Failed to fetch markets', { error: err.message })
    return []
  }
}

export async function fetchOrderBook(tokenId: string): Promise<OrderBook | null> {
  try {
    const { data } = await axios.get(`${CLOB_API}/book`, {
      params: { token_id: tokenId }
    })
    return data
  } catch (err: any) {
    // Silence 404s — market orderbook may not exist yet for pre-market entries
    if (err.response?.status !== 404) {
      logger.warn('Failed to fetch orderbook', { tokenId: tokenId.slice(0, 10), error: err.message })
    }
    return null
  }
}

export async function buildMarketData(market: Market): Promise<MarketData | null> {
  const tokenIds = JSON.parse(market.clobTokenIds) as string[]
  const outcomes = JSON.parse(market.outcomes) as string[]

  const upIdx = outcomes.findIndex(o => o === 'Up')
  const downIdx = outcomes.findIndex(o => o === 'Down')
  if (upIdx === -1 || downIdx === -1) return null

  const upTokenId = tokenIds[upIdx]
  const downTokenId = tokenIds[downIdx]

  const [upBook, downBook] = await Promise.all([
    fetchOrderBook(upTokenId),
    fetchOrderBook(downTokenId),
  ])

  if (!upBook || !downBook) return null

  const q = market.question.toLowerCase()
  const asset = q.includes('bitcoin') || q.includes('btc') ? 'BTC' : 'ETH'

  // Extract real end time from slug timestamp + duration
  // Slug format: btc-updown-5m-1773885600 or eth-updown-15m-1773908100
  const slugMatch = market.slug.match(/(\d+)m-(\d+)$/)
  let minsToExpiry: number
  if (slugMatch) {
    const durationMin = parseInt(slugMatch[1])
    const startTimestamp = parseInt(slugMatch[2])
    const endTimeMs = (startTimestamp + durationMin * 60) * 1000
    minsToExpiry = (endTimeMs - Date.now()) / 60_000
  } else {
    minsToExpiry = (new Date(market.endDateIso).getTime() - Date.now()) / 60_000
  }

  // Calculate real end time
  let endTime: Date
  if (slugMatch) {
    const durationMin = parseInt(slugMatch[1])
    const startTimestamp = parseInt(slugMatch[2])
    endTime = new Date((startTimestamp + durationMin * 60) * 1000)
  } else {
    endTime = new Date(market.endDateIso)
  }

  return {
    market,
    upTokenId,
    downTokenId,
    upBook,
    downBook,
    spotPrice: getSpotPrice(asset),
    spotMomentum: getSpotMomentum(asset),
    minsToExpiry,
    endTime,
  }
}
