import axios from 'axios'
import { logger } from './logger.js'

const GAMMA_API = process.env.GAMMA_API_URL ?? 'https://gamma-api.polymarket.com'

export async function resolveMarketOutcome(conditionId: string): Promise<'Up' | 'Down' | null> {
  try {
    const { data } = await axios.get(`${GAMMA_API}/markets`, {
      params: { condition_id: conditionId }
    })

    const market = Array.isArray(data) ? data[0] : data
    if (!market || !market.closed) return null

    const outcomes = JSON.parse(market.outcomes || '[]') as string[]
    const prices = JSON.parse(market.outcomePrices || '[]') as string[]

    for (let i = 0; i < outcomes.length; i++) {
      if (parseFloat(prices[i]) > 0.95) {
        return outcomes[i] as 'Up' | 'Down'
      }
    }

    return null
  } catch (err: any) {
    logger.warn('Failed to resolve market', { conditionId: conditionId.slice(0, 10), error: err.message })
    return null
  }
}
