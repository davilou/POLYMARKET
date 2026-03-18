import 'dotenv/config'
import { initClobClientWithAuth } from './orders.js'
import { logger } from './logger.js'

async function setup(): Promise<void> {
  logger.info('Setting up balance allowance...')
  const client = await initClobClientWithAuth()

  logger.info('Setting COLLATERAL (USDC) allowance...')
  await (client as any).updateBalanceAllowance({ asset_type: 'COLLATERAL' })
  logger.info('COLLATERAL allowance set!')

  logger.info('Setting CONDITIONAL token allowance...')
  await (client as any).updateBalanceAllowance({ asset_type: 'CONDITIONAL' })
  logger.info('CONDITIONAL allowance set!')

  logger.info('All allowances approved! Ready to trade.')
}

setup().catch(err => {
  logger.error('Setup failed', { error: err.message })
  process.exit(1)
})
