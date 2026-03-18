# BoshBashBish — Estratégia Documentada

> **Referência viva.** Atualizar sempre que descobrirmos novos padrões ou erros de implementação.

---

## 1. Quem é BoshBashBish

| Métrica | Valor |
|---------|-------|
| P&L total | ~$231.156 |
| Volume total | $43.4M+ |
| Trades totais | 15.097 |
| Maior win | $7.949 |
| Portfolio atual | ~$2.829 |
| Ganho em 1 mês | $146K → $231K (+58%) |
| Desde | 4 de Dezembro de 2025 |
| Median order | ~$6 |

**Perfil:** Market maker tático + captura de mispricing em mercados binários BTC/ETH/SOL/XRP 5m e 15m.

---

## 2. O que a estratégia NÃO é

- ❌ Arbitragem pura (comprar os dois lados simultaneamente quando sum < 1.0)
- ❌ Bot de momentum simples
- ❌ Hold-to-resolution em posições balanceadas

---

## 3. O que a estratégia É

**Market making com captura de mispricing em 3 camadas:**

1. **Liquidez maker** — posta ordens limit em ambos os lados, ganha rebates do Polymarket mesmo quando sum > 1.0
2. **DCA em mispricing** — quando um lado cai abaixo do valor justo, acumula em escada
3. **Scalp de volatilidade** — realiza lucro rapidamente quando o preço reverte, sem esperar resolução

**Comportamento real observado (candle 18:07-18:08, BTC 5m, 18 Mar 2026):**
- 349 trades em ~5 minutos = $3.658 USDC volume
- Median order ~$6
- Compra e vende o mesmo lado várias vezes no mesmo candle
- Nunca espera o mercado fechar — realiza parcialmente e reposiciona

---

## 4. Flowchart da Estratégia

```
LOOP 500ms
│
├─ 1. FETCH orderbook Up + Down
│      Calcula midpoints e melhores bids/asks
│
├─ 2. RECONCILE fills
│      Detecta quais ordens foram executadas
│      Atualiza posições e avg cost
│
├─ 3. MONITORING — procura mispricing
│      Se upMid < 0.35 → ENTRADA Up  (mercado acha que Down ganha → compra Up por reversão)
│      Se downMid < 0.30 → ENTRADA Down
│      Se nenhum → aguarda próximo tick
│
├─ 4. DCA ENTRY (quando threshold ativado)
│      Coloca 10-30 ordens BUY em escada de preços
│      Ex: bestAsk = 0.35 → ordens de 0.35 até 0.315 em 10 steps
│      Usa createOrder() local + postOrders() batch (1 chamada de rede)
│
├─ 5. HEDGE (fase 'entered')
│      Se lado oposto > 0.55 → compra hedge no outro lado
│      Ex: entrou Up, Down sobe para 0.57 → compra 5 shares Down
│      Protege contra spike do lado contrário
│
├─ 6. TAKE PROFIT (fase 'entered' ou 'hedged')
│      Se gain >= 10% sobre avg cost → SELL em escada
│      5 ordens SELL de currentMid-0.02 até currentMid+0.03
│      Realização parcial, não liquida tudo
│      Volta para MONITORING após sair
│
├─ 7. LAST CALL (últimos 120 segundos)
│      Identifica o lado perdedor (menor preço)
│      Se preço < 0.20 → compra 5 shares (aposta contrária)
│      Risco/retorno: paga $0.75 → recebe $5 se acertar (6.6x)
│      Baseado na volatilidade extrema dos últimos 2 minutos
│
└─ 8. CLEANUP (todo tick)
       Cancela ordens > 15s sem fill (stale)
       Para de operar 15s antes do fim
       SIGINT → cancelAll() imediato
```

---

## 5. Padrões de Comportamento Real

### Sequência típica num candle

```
T+0s   Mercado abre
T+2s   BoshBash já tem 40+ ordens no livro (DCA pré-posicionado)
T+5s   Primeiro fill — começa a acumular
T+30s  Down sobe → hedge em Down
T+60s  Up reverteu 10% → vende escada parcial
T+90s  Preço caiu de novo → novo DCA mais baixo
T+120s  Up @ 0.22 → acumula agressivamente (último DCA)
T+270s Últimos 2 min: Up @ 0.12-0.16 → last call
T+285s Para de operar (15s antes)
T+300s Candle fecha
```

### Exemplo concreto observado (18:07-18:09)

```
18:07:21  BUY Down @ 0.45-0.46 (~$3)
18:07:23  BUY Down $448 em 40 ordens (entrada DCA massiva)
18:07:23  SELL Down $40 @ 0.40 (scalp imediato)
18:07:25  SELL Down $50 @ 0.42, $43 @ 0.43
18:07:25  BUY Up $105 @ 0.51-0.53 (flip de lado)
18:07:29  SELL Down $90 @ 0.42-0.45 (liquida Down restante)
18:07:35  BUY Up $230 @ 0.38-0.55 (ladder Up)
18:07:39  SELL Up $77 @ 0.39-0.43 (realização parcial)
18:07:41  BUY Up $170 + BUY Down $80 (hedge simultâneo)
18:08:07  BUY Up $80 @ 0.27-0.31 (DCA agressivo — Up caiu)
18:08:17  SELL Up $97 @ 0.39-0.40 (saiu com lucro)
18:08:31  BUY Down $19 @ 0.55 (hedge no topo)
18:09:25  BUY Up $80 @ 0.22-0.36 (Up colapsou — last buy)
18:09:43  BUY Up $27 @ 0.12-0.16 (last call)
```

---

## 6. Parâmetros Críticos e Seus Limites

| Parâmetro | Valor BoshBash real | Nosso default | Nota |
|-----------|---------------------|---------------|------|
| `entryThresholdUp` | ~0.35 | 0.35 | Se mudar, muda o alpha |
| `entryThresholdDown` | ~0.30 | 0.30 | Down cai menos que Up |
| `dcaOrders` | 10-30 | 10 | Mais ordens = melhor avg cost |
| `dcaSpreadPct` | ~15% | 10% | Spread maior = fills em quedas maiores |
| `sharesPerOrder` | min 5 (Polymarket) | 5 | Abaixo de 5 rejeita |
| `hedgeThreshold` | 0.55 | 0.55 | Muito baixo → hedge prematuro |
| `profitTargetPct` | 8-15% | 10% | Muito alto → nunca realiza |
| `lastCallMaxPrice` | 0.12-0.20 | 0.20 | Acima de 0.20 = risco alto |
| `stopTradingSecs` | 15s | 15s | Segurança mínima |
| `staleOrderMaxAgeMs` | 10-15s | 15s | Ordens velhas bloqueiam capital |
| `pollMs` | ~500ms | 500ms | 2 calls/tick = ~4 req/s |

---

## 7. Por Que Funciona

### 7.1 Mean Reversion em Mercados Binários Curtos
Em mercados de 5 minutos, o preço oscila muito. Quando Up cai para 0.27, o mercado ainda não sabe o resultado — a probabilidade real é ~50%. Comprar a 0.27 quando o valor justo é 0.50 é uma edge enorme.

### 7.2 Rebates de Liquidez
O Polymarket paga rebates para quem posta ordens maker (limit orders que ficam no livro). BoshBash com 15K trades e $43M volume recebe rebates significativos que transformam operações neutras em lucrativas.

### 7.3 DCA como Hedge Natural
10 ordens espalhadas de 0.35 a 0.315 significa que se o preço cair mais, ele compra mais barato. O avg cost melhora automaticamente com a queda.

### 7.4 Last Call como Loteria EV+
Comprar Up @ 0.12 quando faltam 2 minutos:
- Perde: -$0.60 (5 shares × $0.12)
- Ganha: +$4.40 (5 shares × $1 - $0.60)
- Frequência de acerto: >20% das vezes (mercado ainda pode reverter)
- EV = 0.20 × $4.40 - 0.80 × $0.60 = +$0.40 por aposta

### 7.5 Alta Frequência × Edge Pequena
1-3% de edge × 50 trades/candle × 288 candles/dia = lucro consistente que composta.

---

## 8. Erros Comuns e Como Detectar

### 8.1 Ordens Nunca Filladas
**Sintoma:** `openOrders` alto, `upShares` e `downShares` = 0 depois de vários ticks
**Causa:** Preços do DCA muito longe do spread real; tickSize errado
**Fix:** Verificar `tickSize` do mercado antes de criar ordens. Usar `bestAsk` como base, não midpoint

### 8.2 Entrada Prematura
**Sintoma:** Entra com DCA mas preço continua caindo, avg cost sobe demais
**Causa:** `entryThresholdUp` muito alto — entra quando ainda tem espaço para cair
**Fix:** Reduzir threshold para 0.32 ou esperar confirmação de 2 ticks consecutivos abaixo

### 8.3 Não Realiza Lucro
**Sintoma:** `upMid` subiu mas `realizedPnl` = 0
**Causa:** `profitTargetPct` muito alto, ou sell ladder com preços impossíveis de fill
**Fix:** Verificar que `basePrice` do sell ladder é realista (não acima do bestBid atual)

### 8.4 Hedge Prematuro
**Sintoma:** Entra em Up, mas compra Down também quando Down = 0.56 ainda não voltou
**Causa:** `hedgeThreshold` muito baixo (0.55 pode ser baixo em alguns candles)
**Fix:** Subir para 0.60 ou verificar se a posição comprada já cobriu o custo antes de hedgear

### 8.5 Last Call em Mercado Errado
**Sintoma:** Last call compra Up @ 0.18 mas Up estava ganhando (já estava em 0.80)
**Causa:** Lógica de "losingSide" identifica o lado com menor preço, mas se ambos caíram é sinal de bug no livro
**Fix:** Verificar que `upMid + downMid ≈ 1.0` antes de qualquer decisão. Se sum < 0.6 ou > 1.1, skip o tick

### 8.6 postOrders Batch Falha
**Sintoma:** Logs de "postOrders batch error", nenhuma ordem DCA colocada
**Causa:** API Polymarket pode rejeitar batch em certos horários
**Fix:** `placeDCAFallback` já existe — garante que fallback funciona individualmente

### 8.7 fillSize Duplicado
**Sintoma:** `realizedPnl` exploде positivo de forma irreal
**Causa:** `reconcile()` conta o mesmo fill duas vezes se a ordem é removida do mapa antes de verificar
**Fix:** O reconcile atual usa `delete` só após processar o fill — não alterar essa ordem

---

## 9. Comparação com Outros Top Traders

| Trader | P&L | Median order | % preços < 0.50 | Sum range |
|--------|-----|-------------|-----------------|-----------|
| **BoshBashBish** | $231K | ~$6 | **72%** | 0.78-0.97 |
| Hcrystallash | ? | $6.20 | 48% | 0.84-1.12 |
| Female-Billing | $156K | $6.70 | 53% | 0.88-1.08 |

**Insight:** BoshBash compra muito mais abaixo de 0.50 (72% dos trades). É o mais agressivo na captura de mispricing extremo.

---

## 10. Budget Math ($100, mínimo 5 shares)

```
DCA entry:   10 ordens × 5 shares × $0.35 = $17.50
Hedge:        5 shares × $0.55            = $ 2.75
Last call:    5 shares × $0.15            = $ 0.75
─────────────────────────────────────────────────
Max exposure por candle:                  ≈ $21.00
Reserva:                                  = $79.00

Cenário WIN (acerta o lado principal):
  50 shares × $1.00 - $17.50 custo       = +$32.50

Cenário LOSS (erra tudo):
  Perda máxima                            = -$21.00

Last call WIN:
  5 shares × $1.00 - $0.75               = +$4.25

Last call LOSS:
  Perda                                   = -$0.75
```

---

## 11. Arquitetura de Implementação

```
src/
  scalper.ts         — Engine 500ms, decision tree, fases
  orderManager.ts    — Registry de ordens, DCA batch, reconciliação de fills
  positionManager.ts — Net shares, avg cost, P&L por lado
  liveTrader.ts      — Orquestrador: descobre mercado → roda scalper → repete
  types.ts           — ScalperConfig, LocalOrder, PositionState, MarketContext, FillEvent
  live.ts            — Spot polling 500ms, dashboard /api/stats, SIGINT → cancelAll
```

### Fluxo de chamadas API por tick (500ms)
```
getOrderBook(upTokenId)    → 1 call
getOrderBook(downTokenId)  → 1 call
getOpenOrders(asset_id=Up)   → 1 call (reconcile)
getOpenOrders(asset_id=Down) → 1 call (reconcile)
─────────────────────────────────────────────────
Total: ~4 calls/tick × 2 ticks/s = ~8 req/s
Limite Polymarket: 100 req/s → OK
```

---

## 12. Variáveis de Ambiente (Ajuste fino sem recompilar)

```env
ENTRY_THRESHOLD_UP=0.35       # threshold para comprar Up
ENTRY_THRESHOLD_DOWN=0.30     # threshold para comprar Down
DCA_ORDERS=10                 # número de ordens DCA
DCA_SPREAD_PCT=0.10           # spread do DCA (10% do preço base)
SHARES_PER_ORDER=5            # shares por ordem (mínimo Polymarket)
HEDGE_THRESHOLD=0.55          # quando hedgear lado oposto
PROFIT_TARGET_PCT=0.10        # take profit em 10%
PROFIT_LADDER_ORDERS=5        # ordens no sell ladder
LAST_CALL_SECS=120            # janela de last call (últimos 2min)
LAST_CALL_MAX_PRICE=0.20      # preço máximo para last call
LAST_CALL_SHARES=5            # shares na aposta contrária
MAX_EXPOSURE_USDC=50          # exposição máxima total ($)
MAX_EXPOSURE_PER_SIDE=30      # máximo shares por lado
STOP_TRADING_SECS=15          # para X segundos antes do fim
MAX_OPEN_ORDERS=20            # limite de ordens abertas simultâneas
STALE_ORDER_MAX_AGE_MS=15000  # cancela ordens velhas após 15s
```

---

## 13. Checklist de Diagnóstico

Quando o bot não está performando, verificar nesta ordem:

- [ ] `upMid + downMid ≈ 1.0`? Se não, livro de ordens com problema
- [ ] Ordens estão sendo aceitas? (sem `errorMsg` nos logs)
- [ ] `filledSize` > 0 depois de 15s? Se não, preços do DCA fora do spread
- [ ] `phase` muda de `monitoring` para `entered`? Se fica preso em monitoring, threshold alto demais
- [ ] `realizedPnl` cresce? Se não, sell ladder acima do mercado (nunca filla)
- [ ] `cancelAll()` funciona no SIGINT? Testar antes de operar real
- [ ] Dashboard `/api/stats` mostra estado correto?

---

*Última atualização: 2026-03-18*
*Baseado em: análise de 15.097 trades do BoshBashBish + implementação própria*
