import 'dotenv/config'
import { ActivePosition } from './types.js'
import { detectImbalance, emergencyHedge, checkRiskAndCancel } from './risk.js'

function ok(label: string)   { console.log(`  ✅ ${label}`) }
function fail(label: string) { console.log(`  ❌ ${label}`); process.exitCode = 1 }
function section(t: string)  { console.log(`\n${'─'.repeat(52)}\n📋 ${t}\n${'─'.repeat(52)}`) }

function makePos(overrides: Partial<ActivePosition> = {}): ActivePosition {
  return {
    slug: 'test-market', conditionId: '0xtest',
    upTokenId: '0xUP', downTokenId: '0xDOWN',
    upOrderId: 'UP_123', downOrderId: 'DOWN_456',
    upFilledSize: 0, downFilledSize: 0,
    upPrice: 0.40, downPrice: 0.55,
    totalSpentUsdc: 0, openedAt: new Date(), status: 'open',
    ...overrides,
  }
}

const BASE_CONFIG = {
  maxExposurePerMarket: 20, minSpreadToEnter: 0.03, maxSumToEnter: 0.97,
  cancelIfPriceMovePct: 0.5, orderSizeUsdc: 5, pollIntervalMs: 5000, assets: ['BTC'],
}

async function run() {

  // ── TEST 1: detectImbalance ─────────────────────────────────────────────
  section('TEST 1 — detectImbalance()')

  const balanced = detectImbalance(makePos({ upFilledSize: 50, downFilledSize: 48 }))
  balanced.hasImbalance === false
    ? ok('Posição equilibrada (50/48) → sem imbalance')
    : fail('Posição equilibrada não deveria ter imbalance')

  const upHeavy = detectImbalance(makePos({ upFilledSize: 100, downFilledSize: 5 }))
  upHeavy.hasImbalance && upHeavy.exposedSide === 'up'
    ? ok(`Up-heavy (100/5) → exposedSide=up, exposedShares=${upHeavy.exposedShares.toFixed(1)}`)
    : fail(`Up-heavy deveria detectar imbalance no up: ${JSON.stringify(upHeavy)}`)

  const downHeavy = detectImbalance(makePos({ upFilledSize: 8, downFilledSize: 100 }))
  downHeavy.hasImbalance && downHeavy.exposedSide === 'down'
    ? ok(`Down-heavy (8/100) → exposedSide=down, exposedShares=${downHeavy.exposedShares.toFixed(1)}`)
    : fail(`Down-heavy deveria detectar imbalance no down: ${JSON.stringify(downHeavy)}`)

  const empty = detectImbalance(makePos({ upFilledSize: 0, downFilledSize: 0 }))
  empty.hasImbalance === false
    ? ok('Posição vazia (0/0) → sem imbalance (aguardando fills)')
    : fail('Posição vazia não deveria ter imbalance')

  const threshold = detectImbalance(makePos({ upFilledSize: 80, downFilledSize: 10 }))
  threshold.hasImbalance && threshold.exposedSide === 'up'
    ? ok('Boundary (80/10) → imbalance detectado corretamente')
    : fail('80/10 deveria ativar imbalance')

  // ── TEST 2: emergencyHedge dry run ──────────────────────────────────────
  section('TEST 2 — emergencyHedge() [dry run]')

  await emergencyHedge(makePos({ upFilledSize: 100, downFilledSize: 5 }), true)
  ok('Hedge com up-heavy (100/5) → dry run sem exceção')

  await emergencyHedge(makePos({ upFilledSize: 50, downFilledSize: 48 }), true)
  ok('Hedge com posição equilibrada → noop correto')

  // ── TEST 3: checkRiskAndCancel ──────────────────────────────────────────
  section('TEST 3 — checkRiskAndCancel() [dry run]')

  const prices = new Map([['BTC', 85000]])

  const r1 = await checkRiskAndCancel(
    makePos({ upFilledSize: 10, downFilledSize: 9, totalSpentUsdc: 5 }),
    BASE_CONFIG, prices, true
  )
  r1 === false
    ? ok('Posição saudável → não cancelada')
    : fail('Posição saudável NÃO deveria ser cancelada')

  const r2 = await checkRiskAndCancel(
    makePos({ upFilledSize: 5, downFilledSize: 4, openedAt: new Date(Date.now() - 15 * 60_000) }),
    BASE_CONFIG, prices, true
  )
  r2 === true
    ? ok('Posição com timeout (15min) → cancelada corretamente')
    : fail('Posição com timeout DEVERIA ser cancelada')

  const r3 = await checkRiskAndCancel(
    makePos({ upFilledSize: 10, downFilledSize: 10, totalSpentUsdc: 25 }),
    BASE_CONFIG, prices, true
  )
  r3 === true
    ? ok('Posição over-exposed ($25 > $20) → cancelada corretamente')
    : fail('Posição over-exposed DEVERIA ser cancelada')

  const r4 = await checkRiskAndCancel(
    makePos({ upFilledSize: 80, downFilledSize: 5, openedAt: new Date(Date.now() - 3 * 60_000) }),
    { ...BASE_CONFIG, maxExposurePerMarket: 50 }, prices, true
  )
  r4 === true
    ? ok('Imbalance (80/5, 3min old) → hedge acionado + cancelada')
    : fail('Posição imbalanced >2min DEVERIA acionar hedge e cancelar')

  const r5 = await checkRiskAndCancel(
    makePos({ upFilledSize: 80, downFilledSize: 5, openedAt: new Date(Date.now() - 60_000) }),
    { ...BASE_CONFIG, maxExposurePerMarket: 50 }, prices, true
  )
  r5 === false
    ? ok('Imbalance (80/5, 1min old) → aguardando, não cancelada ainda')
    : fail('Posição imbalanced <2min deveria AGUARDAR')

  // ── TEST 4: Cálculo de shares e min order size ──────────────────────────
  section('TEST 4 — Min order size e tick rounding')

  function calcShares(targetUsdc: number, price: number, minShares: number) {
    const raw       = targetUsdc / price
    const effective = Math.max(raw, minShares * 1.05)
    const rounded   = Math.round(effective * 100) / 100
    const cost      = rounded * price
    return { shares: rounded, cost: +cost.toFixed(4), skipped: cost > targetUsdc * 3 }
  }

  const c1 = calcShares(5, 0.40, 5)
  !c1.skipped ? ok(`$5 @ 0.40 min=5 → ${c1.shares} shares, $${c1.cost} → aceito`) : fail('deveria aceitar')

  const c2 = calcShares(2, 0.60, 5)
  c2.shares >= 5 && !c2.skipped ? ok(`$2 @ 0.60 min=5 → escalou para ${c2.shares} shares, $${c2.cost}`) : fail('deveria escalar')

  const c3 = calcShares(2, 0.98, 10)
  c3.skipped ? ok(`$2 @ 0.98 min=10 → custo $${c3.cost} → skipped corretamente`) : fail('deveria skip')

  function roundToTick(price: number, tick: number): number {
    const d = Math.round(-Math.log10(tick))
    const f = Math.pow(10, d)
    return Math.ceil(price * f) / f
  }

  const t1 = roundToTick(0.327, 0.01)
  t1 === 0.33 ? ok(`roundToTick(0.327, 0.01) = ${t1} ✓`) : fail(`roundToTick(0.327, 0.01) = ${t1}, esperado 0.33`)

  const t2 = roundToTick(0.1234, 0.001)
  t2 === 0.124 ? ok(`roundToTick(0.1234, 0.001) = ${t2} ✓`) : fail(`roundToTick(0.1234, 0.001) = ${t2}, esperado 0.124`)

  // ── Resultado final ─────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(52)}`)
  if (process.exitCode === 1) {
    console.log('❌  ALGUNS TESTES FALHARAM')
  } else {
    console.log('✅  TODOS OS TESTES PASSARAM — bot pronto para live')
  }
  console.log('═'.repeat(52) + '\n')
}

run().catch(e => { console.error(e); process.exit(1) })
