import axios from 'axios'
import { SpotSnapshot } from './types.js'
import { logger } from './logger.js'

const BINANCE_API = 'https://api.binance.com/api/v3/ticker/price'

const history: Map<string, SpotSnapshot[]> = new Map()
const WINDOW_SIZE = 120

const SYMBOLS: Record<string, string> = {
  BTC: 'BTCUSDC',
  ETH: 'ETHUSDC',
}

export async function updateSpotPrices(assets: string[]): Promise<void> {
  for (const asset of assets) {
    try {
      const { data } = await axios.get(`${BINANCE_API}?symbol=${SYMBOLS[asset]}`)
      const price = parseFloat(data.price)
      if (price <= 0) continue

      if (!history.has(asset)) history.set(asset, [])
      const snapshots = history.get(asset)!
      snapshots.push({ price, timestamp: Date.now() })

      const cutoff = Date.now() - WINDOW_SIZE * 1000
      while (snapshots.length > 0 && snapshots[0].timestamp < cutoff) {
        snapshots.shift()
      }
    } catch {
      // Silent
    }
  }
}

export function getSpotPrice(asset: string): number {
  const snapshots = history.get(asset)
  if (!snapshots || snapshots.length === 0) return 0
  return snapshots[snapshots.length - 1].price
}

export function getSpotMomentum(asset: string, windowMs: number = 60000): number {
  const snapshots = history.get(asset)
  if (!snapshots || snapshots.length < 2) return 0

  const cutoff = Date.now() - windowMs
  const oldest = snapshots.find(s => s.timestamp >= cutoff) || snapshots[0]
  const newest = snapshots[snapshots.length - 1]

  if (oldest.price === 0) return 0
  return (newest.price - oldest.price) / oldest.price
}
