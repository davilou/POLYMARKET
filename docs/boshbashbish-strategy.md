# BoshBashBish — Estratégia Documentada

> **Referência viva.** Atualizar sempre que descobrirmos novos padrões ou erros de implementação.
> Última análise: 4 candles BTC 5m reais via Data API (18 Mar 2026)

---

## 1. Quem é BoshBashBish

| Métrica | Valor |
|---------|-------|
| P&L total | ~$242.042 |
| Volume total | $44.2M+ |
| Trades totais | 15.262 |
| Maior win | $7.949 |
| Portfolio atual | ~$6.514 |
| Ganho em 1 mês | $146K → $242K (+66%) |
| Desde | 4 de Dezembro de 2025 |
| Wallet | `0x29bc82f761749e67fa00d62896bc6855097b683c` |

---

## 2. O que a estratégia REALMENTE é (descoberto via Data API)

**É ARBITRAGEM PURA + SCALP REATIVO**, não market making direcional.

### Entrada: compra OS DOIS LADOS simultaneamente

Quando a soma Up+Down < 1.0, ele entra nos dois lados ao mesmo tempo:

```
Candle 1773858900, T+7-17s:
  BUY Up  @ 0.65-0.71 (100-400 shares)
  BUY Down @ 0.28-0.33
  Soma = 0.70 + 0.29 = 0.99 → lucro garantido se ambos fillam

Candle 1773859200, T+93s:
  BUY Down @ 0.23 (200+ shares)
  BUY Up   @ 0.75
  Soma = 0.23 + 0.75 = 0.98 → puro arb

Candle 1773859500, T+5s:
  BUY Down @ 0.51 (397 shares = $203!)
  BUY Up   @ 0.44-0.46
  Soma = 0.51 + 0.44 = 0.95 → grande alpha
```

A lógica: se entrar em ambos e um ganhar ($1/share), o lucro do ganhador cobre o custo do perdedor + sobra. Quanto menor a soma, maior o lucro garantido.

---

## 3. Dados Reais de 4 Candles (18 Mar 2026)

### Candle btc-updown-5m-1773858600

```
T+17s:  SELL Down @ 0.37-0.39 (101sh) + BUY Down @ 0.36
T+29s:  Down DESPENCOU: BUY Down @ 0.21-0.27 (cascata!)
T+31s:  BUY Down @ 0.22 (100sh)
T+33s:  BUY Down @ 0.27 (100sh)
T+35s:  BUY Down @ 0.31-0.34 + SELL Down @ 0.31 (scalp)
T+37s:  BUY Up @ 0.73 (40sh) + SELL Down @ 0.34
T+39s:  SELL Down @ 0.30-0.34 + BUY Down @ 0.27
T+285s: BUY Up @ 0.06 (100sh) — LAST CALL EXTREMO
```

**Resultado:** Down ganhou. Ele acumulou Down @ 0.21-0.34, vendeu @ 0.30-0.39.

### Candle btc-updown-5m-1773858900

```
T+7s:   BUY Up  @ 0.65  (12sh) + BUY Down @ 0.29 (76sh)
T+9s:   BUY Up  @ 0.67-0.71 (200+sh) + BUY Down @ 0.28-0.31
T+11s:  BUY Up  @ 0.66-0.70 (100+sh) + BUY Down @ 0.30-0.31
T+13s:  BUY Up  @ 0.63-0.70 (100+sh) + BUY Down @ 0.33
T+15s:  BUY Up  @ 0.64-0.70 (150+sh)
T+129s: BUY Down @ 0.03 (95sh) — LAST CALL @ 0.03!
T+185s: BUY Down @ 0.09 (101sh)
T+213s: BUY Down @ 0.06 (3sh)
```

**Insight:** Entrou pesado nos dois lados no começo (arb @ 0.99). Up estava ganhando. Last call compra Down @ 0.03 apostando em reversão final.

### Candle btc-updown-5m-1773859200

```
T+93s:  BUY Down @ 0.23 (200+sh total) + BUY Up @ 0.75 (130+sh)
        → Soma = 0.98 (ambos os lados ao mesmo tempo!)
T+115s: BUY Down @ 0.23 (cascata de 12 ordens)
T+123s: BUY Up  @ 0.57 (94sh)
T+129s: BUY Down @ 0.28-0.30 (100+sh)
T+205s: BUY Down @ 0.07 (100sh) — LAST CALL
```

**Insight:** Não encontrou entrada no início (T+0-90 sem trades BTC 5m). Esperou até T+93s quando surgiu oportunidade. Down @ 0.23 + Up @ 0.75 = soma 0.98.

### Candle btc-updown-5m-1773859500

```
T+5s:   BUY Down @ 0.51 (397sh = $203!) + BUY Up @ 0.44-0.46
T+13s:  Up caiu de 0.46→0.37: BUY Up @ 0.37 (100sh)
T+23s:  BUY Down @ 0.49-0.52 (100+sh) + BUY Up @ 0.45
T+25s:  BUY Down @ 0.52-0.53 (250+sh)
T+39s:  BUY Down @ 0.56-0.57 (200+sh) + BUY Up @ 0.36-0.37
T+93s:  Up despencou para 0.15-0.16: BUY Up (200+sh)
T+95s:  Up em 0.10-0.11: BUY Up (600+sh!!!)
T+99s:  BUY Up @ 0.10 (100+sh)
T+113s: SELL Up @ 0.18-0.19
T+121s: SELL Up @ 0.19-0.20
T+127s: SELL Up @ 0.22
T+131s: SELL Up @ 0.22
T+137s: BUY Down @ 0.78 (41sh) — Down spiked ao final
```

**Insight:** Entrou em ambos T+5s. Up caiu, DCA massivo. Up recuperou de 0.10→0.22 = +120%! Vendeu escada de 0.18-0.22.

---

## 4. Flowchart CORRIGIDO da Estratégia

```
LOOP 500ms
│
├─ 1. FETCH orderbook Up + Down
│      Calcula: upMid, downMid, soma = upMid + downMid
│
├─ 2. RECONCILE fills
│
├─ 3. ENTRADA ARB — Se soma < threshold (ex: 0.97):
│      Entra nos DOIS LADOS simultaneamente
│      BUY Up  com 100-400 shares @ bestAsk Up
│      BUY Down com 100-400 shares @ bestAsk Down
│      Lógica: se um ganhar $1/share, cobre o custo do outro + lucro
│
├─ 4. ENTRADA DIRECIONAL — Se um lado muito barato:
│      Preço < 0.25: Entra massivo nesse lado (DCA cascata)
│      Reativo: se preço cai violentamente (0.45→0.30 em 1 tick), entra
│
├─ 5. DCA REATIVO (durante o candle):
│      Preço caiu mais? Entra com mais shares ao preço menor
│      Não é ladder pré-determinado — é reativo ao movimento
│
├─ 6. TAKE PROFIT (assimétrico):
│      Se side "winner" subiu 20-100%+ → SELL em escada
│      Se side "loser" está perdendo → SELL rápido (10-30s) pra liberar capital
│
├─ 7. LAST CALL (últimos 1-300s — momento variável):
│      Se preço < 0.09 → Compra 100sh (retorno potencial: 11x se ganhar)
│      Se preço < 0.06 → Compra 100sh (retorno potencial: 16x)
│      Timing: pode ser T+129s, T+185s, T+213s, T+285s — sem horário fixo
│
└─ 8. CLEANUP
       Cancela ordens velhas
       Para 15s antes do fim
```

---

## 5. Parâmetros REAIS (corrigidos com dados da API)

| Parâmetro | Valor REAL observado | Nosso config atual | Status |
|-----------|---------------------|--------------------|--------|
| Entrada | AMBOS os lados quando soma < 0.97-0.99 | Um lado só (threshold direcional) | ❌ ERRADO |
| Shares/ordem | **100-400 shares** por ordem | 5 | ❌ MUITO PEQUENO |
| Exposure/candle | **$200-300 USDC** | $50 máximo | ❌ UNDEREXPOSED |
| Timing entrada | **T+5s a T+20s** (imediato) ou T+90-100s | Contínuo 500ms | ⚠️ PARCIAL |
| Last call preço | **0.03-0.09** (extremo) | 0.20 (conservador) | ❌ ERRADO |
| Last call timing | **Qualquer momento** quando preço colapsa | 120s antes | ❌ ERRADO |
| Take profit | **20-120%** sobre custo | 10% fixo | ❌ CONSERVADOR |
| Stop loss | **10-30s** se lado perdendo capital | Não implementado | ❌ FALTANDO |
| DCA trigger | **Crash brusco de preço** (reativo) | Ladder linear fixo | ❌ DIFERENTE |
| Soma de entrada | **< 0.97-0.99** (arb puro) | Não verifica soma | ❌ FALTANDO |

---

## 6. Erros Críticos na Nossa Implementação

### Erro #1 — CRÍTICO: Entra em um lado só
**Problema:** Nossa lógica é: "se upMid < 0.35 → entra Up". Mas BoshBashBish entra nos DOIS LADOS quando a soma é baixa.

**Fix:** Verificar `upMid + downMid < 0.97` como trigger primário. Entrar nos dois.

### Erro #2 — CRÍTICO: Shares muito pequenas (5 vs 100-400)
**Problema:** Com 5 shares @ $0.35 = $1.75 por ordem × 10 ordens = $17.50 total. BoshBashBish coloca $203 numa única ordem.

**Fix:** Com $100 de budget, usar 20-30 shares/ordem (não 5). Mas a estratégia arb requer capital para funcionar — com $100 vs $6500 do BoshBashBish, as edges são muito menores.

### Erro #3 — CRÍTICO: Last Call em 0.20 (deveria ser 0.03-0.09)
**Problema:** `lastCallMaxPrice: 0.20` faz entrar em preços muito caros. O real valor de last call é 0.03-0.09 (quando o lado está praticamente morto mas ainda pode reverter).

**Fix:** `lastCallMaxPrice: 0.09`. Só entrar se preço < 0.09.

### Erro #4 — CRÍTICO: Não verifica soma Up+Down
**Problema:** A estratégia core é arb puro (soma < 1.0). Não implementamos esse conceito.

**Fix:** Adicionar `arbThreshold: 0.97` — se `upMid + downMid < 0.97`, entra nos dois lados.

### Erro #5 — ALTO: DCA linear vs DCA reativo
**Problema:** Nosso DCA coloca 10 ordens uniformes de 0.35 a 0.315. BoshBashBish reage quando o preço CAI bruscamente — entra com mais force quando o preço despenca.

**Fix:** Monitorar `deltaPrice = prevMid - currentMid`. Se delta > 0.05 em 1 tick → entrar imediatamente com tamanho maior.

### Erro #6 — ALTO: Sem stop loss temporal
**Problema:** Se o lado que entramos está perdendo (preço continua caindo após DCA), BoshBashBish vende em 10-30s para liberar capital. Nós seguramos indefinidamente.

**Fix:** Se lado foi comprado e preço está abaixo do nosso avg cost há 30s, vender 50% da posição.

### Erro #7 — MÉDIO: Take profit conservador (10% vs 20-120%)
**Problema:** Vendemos quando ganhamos 10%. BoshBashBish segura até 120% (comprou @ 0.10, vendeu @ 0.22).

**Fix:** `profitTargetPct: 0.20` mínimo. Mas o exit ideal é reativo ao mercado, não fixo.

---

## 7. Por Que a Estratégia Funciona

### 7.1 Arb Puro (soma < 1.0)
Se compra Up @ 0.44 e Down @ 0.51 = custo total = $0.95/share pair. Um lado sempre ganha $1.00. Lucro garantido = $0.05/share pair **independente do resultado**.

### 7.2 Amplificação com Fills Parciais
Nem sempre ambas as ordens filam. Quando só uma fila (ex: Down a 0.51), agora tem uma posição direcional que pode ganhar $0.49/share se Down ganhar, ou perder $0.51 se Up ganhar.

Por isso o DCA reativo — se o lado oposto começa a subir, DCA para baixar o custo médio.

### 7.3 Last Call como Loteria EV+
Comprar @ 0.03 quando faltam 2 minutos:
- Se ganhar: $1.00 - $0.03 = +$0.97 × 100 shares = +$97
- Se perder: -$3
- Mesmo com 5% de chance de acerto: EV = 0.05×97 - 0.95×3 = +$4.85 - $2.85 = **+$2 EV positivo**

### 7.4 Rebates de Liquidez
Maker orders (limit) recebem rebates do Polymarket. Com $44M volume, os rebates são uma fonte significativa de lucro adicional.

### 7.5 Assimetria de Exit (segura winners, corta losers rápido)
- Winner: segura até 100%+ de gain
- Loser: corta em 10-30s

Essa assimetria (loss pequeno, gain grande) é o motor principal do P&L acumulado.

---

## 8. Mecânica dos Candles — Timeline Típica

```
T+0s    Mercado abre
T+2-5s  Verifica soma. Se soma < 0.97: entra AMBOS os lados imediatamente
T+5-20s Ordens grandes nos dois lados (100-400 shares cada)
T+20-90s Ajuste: se um lado cai, DCA adicional no barato
T+90s+  Monitoramento: um lado ganha, outro perde
        → Vende o perdedor rápido (ou aguarda DCA mais barato)
        → Segura o ganhador
T+qualquer: Preço colapsa a 0.03-0.09? → LAST CALL imediato (100sh)
T+285s  Para de operar
T+300s  Candle fecha
```

---

## 9. Budget Math CORRIGIDO ($100 budget)

### O problema de escala

BoshBashBish opera com ~$6.500 de portfolio. Nós temos $100. As edges de arb (soma < 0.97) são capturadas por quem tem capital para preencher o spread.

| Cenário | BoshBashBish | Nós ($100) |
|---------|-------------|------------|
| Exposição por candle | $200-300 | $30-50 |
| Arb por candle (soma 0.97) | $6-9 | $0.90-1.50 |
| Last call (100sh @ 0.05) | -$5 ou +$95 | Não viável (min 5sh = $0.25) |
| Last call (5sh @ 0.05) | - | -$0.25 ou +$4.75 |

### Com $100, estratégia realista:

```
Arb entry: 20sh Up @ 0.44 + 20sh Down @ 0.51 = $18.80
Lucro se ambos fillam: 20 × (1 - 0.95) = $1.00 garantido
DCA se um cai: +10sh × custo médio mais baixo
Last call: 5sh × 0.06 = $0.30 → ganho potencial = $4.70
```

---

## 10. Comparação com Outros Top Traders

| Trader | P&L | Median order | % preços < 0.50 | Sum range |
|--------|-----|-------------|-----------------|-----------|
| **BoshBashBish** | $242K | ~$6 | **72%** | 0.78-0.97 |
| Hcrystallash | ? | $6.20 | 48% | 0.84-1.12 |
| Female-Billing | $156K | $6.70 | 53% | 0.88-1.08 |

---

## 11. Dados Reais da API — Exemplos de Preços

### Distribuição de preços de entrada observados

| Preço | Frequência | Contexto |
|-------|-----------|---------|
| 0.03-0.09 | Raro mas grande volume | Last call extremo |
| 0.10-0.20 | Médio | DCA após crash + last call |
| 0.21-0.35 | Alto | DCA mid-candle |
| 0.36-0.50 | Muito alto | Entry normal do lado "barato" |
| 0.51-0.75 | Alto | Entry do lado "caro" (arb) |
| 0.75+ | Raro | Flip quando lado ganhou muito |
| 0.78 | Visto em T+137s | BUY Down quando Down estava ganhando |

---

## 12. Checklist de Diagnóstico ATUALIZADO

Quando o bot não está performando:

- [ ] `upMid + downMid` < 0.97? Se sim, deveria entrar nos DOIS lados
- [ ] Shares por ordem é suficiente? Mínimo de 20sh para arb fazer sentido
- [ ] Last call threshold correto? Deve ser < 0.09, não < 0.20
- [ ] Stop loss temporal implementado? Se posição perde por 30s, reduzir
- [ ] DCA reativo a crashes? Se preço cai 0.05+ em 1 tick, entrar imediatamente
- [ ] Take profit adequado? Não sair antes de 20% de gain
- [ ] Ordens fillando? Verificar tickSize e proximity ao bestAsk
- [ ] `cancelAll()` funciona no SIGINT?

---

## 13. Variáveis de Ambiente CORRIGIDAS

```env
# Arb threshold (entrada nos dois lados quando soma < isto)
ARB_THRESHOLD=0.97

# Thresholds direcionais (entrada unilateral quando muito barato)
ENTRY_THRESHOLD_UP=0.25
ENTRY_THRESHOLD_DOWN=0.25

# DCA
DCA_ORDERS=5                  # menos ordens, mas maiores
SHARES_PER_ORDER=20           # mínimo 20 (não 5)

# Hedge / stop
HEDGE_THRESHOLD=0.65          # subiu para 0.65 (0.55 era prematuro)

# Take profit
PROFIT_TARGET_PCT=0.20        # mínimo 20% (não 10%)

# Last call CORRIGIDO
LAST_CALL_MAX_PRICE=0.09      # 0.09 (não 0.20!)
LAST_CALL_SHARES=5            # mínimo Polymarket

# Risk
MAX_EXPOSURE_USDC=60          # pode subir com confiança
MAX_EXPOSURE_PER_SIDE=50      # shares (não USDC)
```

---

## 14. Arquitetura — O que precisa mudar

```
src/scalper.ts
  → Adicionar: verificar soma upMid + downMid < arbThreshold
  → Adicionar: entrar nos DOIS lados quando soma < threshold
  → Corrigir: lastCallMaxPrice de 0.20 para 0.09
  → Adicionar: stop loss temporal (vender 50% se perdendo por 30s)
  → Corrigir: profitTargetPct de 0.10 para 0.20

src/types.ts (ScalperConfig)
  → Adicionar: arbThreshold: number  // 0.97

src/orderManager.ts
  → Adicionar: placeBothSides() para entrada arb simultânea
```

---

*Última atualização: 2026-03-18*
*Baseado em: análise de 4 candles reais via Data API + 15.262 trades históricos*
*Wallet analisada: 0x29bc82f761749e67fa00d62896bc6855097b683c*
