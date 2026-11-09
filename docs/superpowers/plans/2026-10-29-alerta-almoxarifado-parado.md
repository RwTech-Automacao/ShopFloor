# Alerta de placas paradas antes do Almoxarifado — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um tipo novo de regra nos Alertas do ShopFloor (`parado`) que avisa, por OP, quando caixas, lotes ou peças avulsas já prontas no posto anterior passam de X horas de expediente sem dar entrada no Almoxarifado.

**Architecture:** O app (TypeScript puro, testado) lê as pendências pela função interna nova `sf_almox_pendencias_base`, converte o tempo em minutos de expediente (segunda a sexta, turnos da regra) e entrega ao banco o mapa `p_parados`; o `alerta_avaliar` (agora com 4 parâmetros) só abre, atualiza e normaliza a ocorrência por OP e enfileira a mensagem. Mesma divisão da janela por blocos (0139): o banco não faz conta de horário.

**Tech Stack:** Next.js 16 / TypeScript, Vitest, Supabase (PostgREST, plpgsql), harness SQL em Docker (`supabase/tests/`).

Spec: `docs/superpowers/specs/2026-10-29-alerta-almoxarifado-parado-design.md`. Branch: `feat/alerta-almox-parado`, worktree `/home/rwtech/Área de trabalho/ShopFloor-almox-parado`. **Nada vai a produção sem o aval do usuário.**

## Global Constraints

- Antes de escrever código Next.js, ler o guia relevante em `node_modules/next/dist/docs/` (AGENTS.md: esta versão tem mudanças). Este trabalho quase não toca Next, mas a tela da regra é React.
- Português do Brasil em toda mensagem de usuário, comentário e commit. Comentários só onde explicam o porquê, no tom do código vizinho.
- Fuso da fábrica: America/Sao_Paulo fixo (UTC-3, sem horário de verão); o servidor roda em UTC. Usar só `partesSp`/`instanteSp` de `src/modules/alertas/domain/intervalos.ts`; nunca `getHours()`/`getDate()`.
- Semana da fábrica: **segunda a sexta**. Sem turno cadastrado na regra, conta relógio corrido.
- Corpo de função SQL com `$func$` (o SQL Editor não aceita dois cifrões, nem em comentário); `grant`/`revoke` explícitos; `notify pgrst, 'reload schema';` na última linha da migração.
- A migração é **0167** (a 0166 é a última na `main`). Aditiva e idempotente (roda duas vezes sem erro).
- Limite da regra em **horas inteiras, 1 a 72**, padrão 2 (coluna `limite_horas int`). O PostgREST entrega `numeric` como string; inteiro evita o problema.
- Placas, não painéis: as quantidades da mensagem vêm de `pecas` (soma de placas).
- Commits terminam com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Testes: `npx vitest run <arquivo>` por tarefa; `npx tsc --noEmit` e a suíte inteira (`npm test`) na Tarefa 7.

## Decisões de implementação que ajustam a spec

1. **Chave da ocorrência = coluna `defeito` existente**, com o texto `PMO/OP`. O índice único `alerta_ocorrencias_viva_defeito (regra_id, posto, coalesce(defeito,''))` já dá "uma ocorrência viva por OP" sem coluna nova e **sem mexer nos cinco ramos** do `union all` do `alerta_avaliar`. (A spec falava em coluna `chave`; esta é a forma de menor risco. A tela de ocorrências precisa tratar o `defeito` do tipo `parado` como "OP", ver Tarefa 4.)
2. **A regra guarda os postos Almoxarifado** em `postos` (o picker lista só postos de perfil `almoxarifado` nesse tipo). Isso mantém intactos o `check cardinality(postos) > 0` e o passo do `alerta_avaliar` que encerra a ocorrência quando o posto sai da regra.
3. **Janela de fachada `'op'`, `janela_valor` nulo**, como o tipo `emb`: o ramo do `alerta_avaliar` grava `pmo`/`op` na ocorrência só quando `janela_tipo = 'op'`, e `alerta_carencia_min('op', ...)` dá 60 min de carência na reabertura.
4. **`alerta_avaliar` ganha o 4º parâmetro `p_parados jsonb default null`.** Isso muda a assinatura: a migração faz `drop function` da de 3 parâmetros antes de criar a de 4 (senão ficam duas sobrecargas e a chamada do PostgREST fica ambígua). O app antigo (3 parâmetros nomeados) continua funcionando contra a função nova.
5. **Regra ausente de `p_parados` é PULADA** (não decide nada), como as janelas por blocos. O app só põe a chave de uma regra quando a leitura das pendências deu certo; assim um erro de leitura nunca normaliza ocorrência por engano.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/alertas/domain/horas-de-turno.ts` (novo) | Minutos de expediente entre dois instantes, por turnos e semana útil |
| `src/modules/alertas/domain/parados.ts` (novo) | Escolher itens acima do limite, agrupar por OP, serializar para o banco |
| `src/modules/alertas/domain/parados-texto.ts` (novo) | Texto do alerta/normalização do parado |
| `src/modules/alertas/domain/tipos.ts` | Tipo `parado` (nome, descrição, `ehTipoRegra`) |
| `src/modules/alertas/domain/regra.ts` | Validação e resumo da regra `parado` |
| `src/modules/alertas/domain/envio.ts` | `textoParado` e despacho em `textoDoEnvio` |
| `src/modules/alertas/infra/regras-repository.ts` | Ler/gravar `limite_horas` e os turnos do tipo |
| `src/modules/alertas/ui/regra-form.tsx`, `regra-dialog.tsx`, `ocorrencias-lista.tsx` | Formulário e lista |
| `src/modules/alertas/infra/repositorio-servico.ts` | `paradosDaRodada` e o 4º parâmetro do `avaliar` |
| `supabase/migrations/0167_alerta_almox_parado.sql` (novo) | Colunas, checks, função base, `alerta_avaliar` de 4 parâmetros |
| `supabase/tests/alertas_parado_test.sql` (novo) | Teste SQL do tipo no alerta_avaliar |
| `supabase/tests/almox_pendencias_base_test.sql` (novo) | Teste SQL da função base e da casca |
| `docs/operacao/alerta-almox-parado/00-ROTEIRO.md` (novo) | Roteiro de deploy |

---

### Task 1: Minutos de expediente (`horas-de-turno.ts`)

**Files:**
- Create: `src/modules/alertas/domain/horas-de-turno.ts`
- Test: `src/modules/alertas/domain/__tests__/horas-de-turno.test.ts`

**Interfaces:**
- Consumes: `Intervalo`, `lerHhMm`, `partesSp`, `instanteSp` de `./intervalos`.
- Produces: `minutosDeExpediente(de: Date, ate: Date, turnos: readonly Intervalo[]): number`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { minutosDeExpediente } from '../horas-de-turno'

/** Instante a partir da hora de PAREDE de São Paulo (UTC-3, sem horário de verão). */
const sp = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`)

const TURNOS = [
  { inicio: '07:00', fim: '12:00' },
  { inicio: '13:30', fim: '17:30' },
]

describe('minutosDeExpediente', () => {
  it('dentro de um turno conta o tempo corrido', () => {
    expect(minutosDeExpediente(sp('2026-10-28', '08:00'), sp('2026-10-28', '10:30'), TURNOS)).toBe(150)
  })

  it('o almoço não conta', () => {
    // 11:00-12:00 (60) + 13:30-14:30 (60)
    expect(minutosDeExpediente(sp('2026-10-28', '11:00'), sp('2026-10-28', '14:30'), TURNOS)).toBe(120)
  })

  it('pronto depois do fim do turno só começa a contar no turno seguinte', () => {
    // quarta 17:50 -> quinta 09:20: nada na quarta, quinta 07:00-09:20 = 140
    expect(minutosDeExpediente(sp('2026-10-28', '17:50'), sp('2026-10-29', '09:20'), TURNOS)).toBe(140)
  })

  it('sábado e domingo não contam', () => {
    // sexta 16:30-17:30 (60) + segunda 07:00-08:00 (60)
    expect(minutosDeExpediente(sp('2026-10-30', '16:30'), sp('2026-11-02', '08:00'), TURNOS)).toBe(120)
  })

  it('sem turno cadastrado conta relógio corrido, inclusive fim de semana', () => {
    expect(minutosDeExpediente(sp('2026-10-30', '16:00'), sp('2026-10-30', '19:00'), [])).toBe(180)
    expect(minutosDeExpediente(sp('2026-10-31', '10:00'), sp('2026-10-31', '12:00'), [])).toBe(120)
  })

  it('fronteira exata: início do turno conta, fim não passa', () => {
    expect(minutosDeExpediente(sp('2026-10-28', '07:00'), sp('2026-10-28', '07:01'), TURNOS)).toBe(1)
    expect(minutosDeExpediente(sp('2026-10-28', '17:30'), sp('2026-10-28', '18:30'), TURNOS)).toBe(0)
  })

  it('fim antes ou igual ao início devolve 0', () => {
    expect(minutosDeExpediente(sp('2026-10-28', '10:00'), sp('2026-10-28', '10:00'), TURNOS)).toBe(0)
    expect(minutosDeExpediente(sp('2026-10-28', '11:00'), sp('2026-10-28', '10:00'), TURNOS)).toBe(0)
  })

  it('ignora turno ilegível em vez de inventar horário', () => {
    const sujo = [{ inicio: '25:00', fim: '26:00' }, ...TURNOS]
    expect(minutosDeExpediente(sp('2026-10-28', '08:00'), sp('2026-10-28', '09:00'), sujo)).toBe(60)
  })

  it('limita o período muito antigo sem travar (item parado há meses)', () => {
    const r = minutosDeExpediente(sp('2025-01-01', '08:00'), sp('2026-10-28', '08:00'), TURNOS)
    expect(Number.isFinite(r)).toBe(true)
    expect(r).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/horas-de-turno.test.ts`
Expected: FAIL (`Cannot find module '../horas-de-turno'`).

- [ ] **Step 3: Implementar**

```ts
import { instanteSp, lerHhMm, partesSp, type Intervalo } from './intervalos'

/** Quanto do passado o cálculo olha: item parado há mais que isso já passou de qualquer limite. */
const DIAS_MAX = 400

const MINUTO_MS = 60_000

/**
 * Minutos de EXPEDIENTE entre dois instantes: só o que cai dentro dos turnos, só de segunda a sexta
 * (a semana da fábrica e do cron). Sem turno legível, conta relógio corrido — uma regra sem turno
 * cadastrado continua avisando, com a conta mais simples.
 *
 * Os turnos são horas de parede de São Paulo; cada dia é montado com `instanteSp`, nunca com o
 * fuso do processo. O dia da semana sai da data do calendário (`Date.UTC`), que não depende de fuso.
 */
export function minutosDeExpediente(de: Date, ate: Date, turnos: readonly Intervalo[]): number {
  const t0 = de.getTime()
  const t1 = ate.getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0

  const faixas: { ini: number; fim: number }[] = []
  for (const t of turnos) {
    const ini = lerHhMm(t.inicio)
    const fim = lerHhMm(t.fim)
    if (ini === null || fim === null || fim <= ini) continue
    faixas.push({ ini, fim })
  }
  if (faixas.length === 0) return Math.floor((t1 - t0) / MINUTO_MS)

  const inicio = Math.max(t0, t1 - DIAS_MAX * 24 * 60 * MINUTO_MS)
  const a = partesSp(new Date(inicio))
  const b = partesSp(new Date(t1))
  const ultimo = Date.UTC(b.ano, b.mes - 1, b.dia)

  let total = 0
  for (let dia = Date.UTC(a.ano, a.mes - 1, a.dia); dia <= ultimo; dia += 24 * 60 * MINUTO_MS) {
    const d = new Date(dia)
    const semana = d.getUTCDay()
    if (semana === 0 || semana === 6) continue
    const ano = d.getUTCFullYear()
    const mes = d.getUTCMonth() + 1
    const diaDoMes = d.getUTCDate()
    for (const f of faixas) {
      const ini = Math.max(instanteSp(ano, mes, diaDoMes, f.ini).getTime(), inicio)
      const fim = Math.min(instanteSp(ano, mes, diaDoMes, f.fim).getTime(), t1)
      if (fim > ini) total += (fim - ini) / MINUTO_MS
    }
  }
  return Math.floor(total)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/horas-de-turno.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/alertas/domain/horas-de-turno.ts src/modules/alertas/domain/__tests__/horas-de-turno.test.ts
git commit -m "$(cat <<'EOF'
feat(alertas): minutos de expediente por turno e semana útil

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Escolher e agrupar os itens parados (`parados.ts`)

**Files:**
- Create: `src/modules/alertas/domain/parados.ts`
- Test: `src/modules/alertas/domain/__tests__/parados.test.ts`

**Interfaces:**
- Consumes: `minutosDeExpediente` (Tarefa 1), `Intervalo`.
- Produces:
  - `type TipoItemParado = 'caixa' | 'lote' | 'peca'`
  - `interface ItemPendente { pmo: string; op: string; posto: string; tipo: TipoItemParado; codigo: string; pecas: number; em: Date }`
  - `interface ItemParado { tipo: TipoItemParado; codigo: string; pecas: number; minutos: number }`
  - `interface ParadosDaOp { pmo: string; op: string; posto: string; maisAntigaMin: number; itens: ItemParado[] }`
  - `paradosPorOp(pendentes: readonly ItemPendente[], turnos: readonly Intervalo[], limiteHoras: number, agora: Date): ParadosDaOp[]`
  - `paradosParaBanco(grupos: readonly ParadosDaOp[]): { pmo: string; op: string; posto: string; mais_antiga_min: number; itens: { tipo: string; codigo: string; pecas: number; minutos: number }[] }[]`
  - `chaveDaOp(pmo: string, op: string): string` → `'PMO/OP'` (a mesma que o banco grava em `alerta_ocorrencias.defeito`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from 'vitest'
import { chaveDaOp, paradosParaBanco, paradosPorOp, type ItemPendente } from '../parados'

const sp = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`)
const TURNOS = [{ inicio: '07:00', fim: '17:30' }]
const AGORA = sp('2026-10-28', '15:00')

function item(p: Partial<ItemPendente>): ItemPendente {
  return {
    pmo: 'PRT797', op: '8563', posto: 'ALMOX', tipo: 'caixa', codigo: 'CX[1][500]',
    pecas: 500, em: sp('2026-10-28', '10:00'), ...p,
  }
}

describe('paradosPorOp', () => {
  it('só entra o que passou do limite de horas de expediente', () => {
    const r = paradosPorOp(
      [item({ codigo: 'CX[1][500]', em: sp('2026-10-28', '10:00') }), // 5 h
       item({ codigo: 'CX[2][500]', em: sp('2026-10-28', '14:00') })], // 1 h
      TURNOS, 2, AGORA)
    expect(r).toHaveLength(1)
    expect(r[0].itens.map((i) => i.codigo)).toEqual(['CX[1][500]'])
    expect(r[0].maisAntigaMin).toBe(300)
  })

  it('exatamente no limite conta como parado', () => {
    const r = paradosPorOp([item({ em: sp('2026-10-28', '13:00') })], TURNOS, 2, AGORA)
    expect(r).toHaveLength(1)
  })

  it('agrupa por OP, itens do mais antigo para o mais novo', () => {
    const r = paradosPorOp(
      [item({ codigo: 'CX[3]', em: sp('2026-10-28', '11:00') }),
       item({ codigo: 'CX[4]', em: sp('2026-10-28', '09:00') }),
       item({ op: '8564', codigo: 'CX[1]', em: sp('2026-10-28', '08:00') })],
      TURNOS, 2, AGORA)
    expect(r.map((g) => g.op)).toEqual(['8564', '8563']) // OP com o item mais antigo primeiro
    expect(r[1].itens.map((i) => i.codigo)).toEqual(['CX[4]', 'CX[3]'])
  })

  it('o tipo de item e as placas viajam junto', () => {
    const r = paradosPorOp(
      [item({ tipo: 'lote', codigo: 'LOTE-7', pecas: 100, em: sp('2026-10-28', '08:00') })],
      TURNOS, 2, AGORA)
    expect(r[0].itens[0]).toMatchObject({ tipo: 'lote', codigo: 'LOTE-7', pecas: 100 })
  })

  it('nada parado devolve lista vazia', () => {
    expect(paradosPorOp([], TURNOS, 2, AGORA)).toEqual([])
    expect(paradosPorOp([item({ em: sp('2026-10-28', '14:59') })], TURNOS, 2, AGORA)).toEqual([])
  })

  it('sem turno conta relógio corrido', () => {
    const r = paradosPorOp([item({ em: sp('2026-10-28', '12:30') })], [], 2, AGORA)
    expect(r[0].maisAntigaMin).toBe(150)
  })
})

describe('paradosParaBanco', () => {
  it('serializa em snake_case, na forma que o alerta_avaliar lê', () => {
    const grupos = paradosPorOp([item({ em: sp('2026-10-28', '10:00') })], TURNOS, 2, AGORA)
    expect(paradosParaBanco(grupos)).toEqual([
      {
        pmo: 'PRT797', op: '8563', posto: 'ALMOX', mais_antiga_min: 300,
        itens: [{ tipo: 'caixa', codigo: 'CX[1][500]', pecas: 500, minutos: 300 }],
      },
    ])
  })
})

describe('chaveDaOp', () => {
  it('é PMO/OP, a mesma que o banco grava na ocorrência', () => {
    expect(chaveDaOp('PRT797', '8563')).toBe('PRT797/8563')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/parados.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
import { minutosDeExpediente } from './horas-de-turno'
import type { Intervalo } from './intervalos'

export type TipoItemParado = 'caixa' | 'lote' | 'peca'

/** Uma pendência do Almoxarifado, como a função base a entrega (já com `em` = o momento mais antigo). */
export interface ItemPendente {
  pmo: string
  op: string
  posto: string
  tipo: TipoItemParado
  codigo: string
  pecas: number
  em: Date
}

export interface ItemParado {
  tipo: TipoItemParado
  codigo: string
  pecas: number
  /** Minutos de expediente decorridos desde que ficou pronto. */
  minutos: number
}

export interface ParadosDaOp {
  pmo: string
  op: string
  posto: string
  maisAntigaMin: number
  itens: ItemParado[]
}

/** A chave da ocorrência por OP. O banco a grava em `alerta_ocorrencias.defeito` (0167). */
export function chaveDaOp(pmo: string, op: string): string {
  return `${pmo}/${op}`
}

/**
 * Os itens que passaram do limite (em horas de EXPEDIENTE), agrupados por OP. A OP com o item mais
 * antigo vem primeiro; dentro da OP, o mais antigo primeiro. Nenhum item acima do limite = [].
 */
export function paradosPorOp(
  pendentes: readonly ItemPendente[],
  turnos: readonly Intervalo[],
  limiteHoras: number,
  agora: Date,
): ParadosDaOp[] {
  const limiteMin = limiteHoras * 60
  const grupos = new Map<string, ParadosDaOp>()
  for (const p of pendentes) {
    const minutos = minutosDeExpediente(p.em, agora, turnos)
    if (minutos < limiteMin) continue
    const chave = chaveDaOp(p.pmo, p.op)
    let g = grupos.get(chave)
    if (!g) {
      g = { pmo: p.pmo, op: p.op, posto: p.posto, maisAntigaMin: 0, itens: [] }
      grupos.set(chave, g)
    }
    g.itens.push({ tipo: p.tipo, codigo: p.codigo, pecas: p.pecas, minutos })
    g.maisAntigaMin = Math.max(g.maisAntigaMin, minutos)
  }
  const lista = [...grupos.values()]
  for (const g of lista) g.itens.sort((a, b) => b.minutos - a.minutos || a.codigo.localeCompare(b.codigo))
  lista.sort(
    (a, b) => b.maisAntigaMin - a.maisAntigaMin || a.pmo.localeCompare(b.pmo) || a.op.localeCompare(b.op),
  )
  return lista
}

/** A forma que o `alerta_avaliar` lê em `p_parados -> "<regra_id>"`. */
export function paradosParaBanco(grupos: readonly ParadosDaOp[]) {
  return grupos.map((g) => ({
    pmo: g.pmo,
    op: g.op,
    posto: g.posto,
    mais_antiga_min: g.maisAntigaMin,
    itens: g.itens.map((i) => ({ tipo: i.tipo, codigo: i.codigo, pecas: i.pecas, minutos: i.minutos })),
  }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/parados.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/alertas/domain/parados.ts src/modules/alertas/domain/__tests__/parados.test.ts
git commit -m "$(cat <<'EOF'
feat(alertas): escolher e agrupar por OP os itens parados no Almoxarifado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Texto da mensagem e despacho (`parados-texto.ts`, `envio.ts`)

**Files:**
- Create: `src/modules/alertas/domain/parados-texto.ts`
- Modify: `src/modules/alertas/domain/envio.ts` (importar e despachar), `src/modules/alertas/domain/tipos.ts` (o tipo `parado`, ver Tarefa 4: esta tarefa só precisa de `ehTipoRegra('parado')`, então faça o passo de `tipos.ts` da Tarefa 4 aqui, primeiro)
- Test: `src/modules/alertas/domain/__tests__/parados-texto.test.ts`, `src/modules/alertas/domain/__tests__/envio-parado.test.ts`

**Interfaces:**
- Consumes: `LIMITE_MENSAGEM`, `listaComCorte`, `formatarDataHoraCurta`, `textoOp`, `rotulosOps`, `textoLembreteTipo`, `textoReabertura` de `./mensagens`; `ItemParado` de `./parados`.
- Produces: `formatarMinutos(min: number): string`, `textoAlertaParado(d: DadosParado): string`, `textoNormalizouParado(d: RefOp): string`, `interface DadosParado`.

- [ ] **Step 1: tipos.ts primeiro (pré-requisito)**

Em `src/modules/alertas/domain/tipos.ts`: acrescentar `'parado'` ao `TipoRegra` e a `TIPOS_REGRA`, `parado: 'Parado no Almoxarifado'` em `NOME_TIPO_REGRA`, em `DESCRICAO_TIPO_REGRA` a frase `'Avisa quando caixas, lotes ou peças prontas ficam horas sem dar entrada no Almoxarifado.'` e `|| valor === 'parado'` em `ehTipoRegra`. Rodar `npx tsc --noEmit` e ajustar todo `Record<TipoRegra, ...>` ou `switch` exaustivo que o compilador apontar (a Tarefa 4 trata `regra.ts`; aqui só o que quebrar de compilação por causa do tipo novo, com o comportamento mínimo coerente).

- [ ] **Step 2: Teste do texto, falhando**

```ts
import { describe, expect, it } from 'vitest'
import { formatarMinutos, textoAlertaParado, textoNormalizouParado } from '../parados-texto'

const AGORA = new Date('2026-10-28T18:05:00Z') // 15:05 em São Paulo

describe('formatarMinutos', () => {
  it('menos de uma hora', () => expect(formatarMinutos(45)).toBe('45 min'))
  it('hora cheia', () => expect(formatarMinutos(120)).toBe('2 h'))
  it('hora e minutos com zero à esquerda', () => expect(formatarMinutos(125)).toBe('2 h 05 min'))
})

const base = {
  regraNome: 'Parado no Almox', pmo: 'PRT797', op: '8563', limiteHoras: 2, em: AGORA,
}

describe('textoAlertaParado', () => {
  it('lista cada caixa, com placas e o tempo, e dá o rótulo da OP', () => {
    const t = textoAlertaParado({
      ...base,
      itens: [
        { tipo: 'caixa', codigo: 'CX[3][500]', pecas: 500, minutos: 190 },
        { tipo: 'caixa', codigo: 'CX[4][500]', pecas: 500, minutos: 125 },
      ],
    })
    expect(t).toContain('OP PRT797/8563')
    expect(t).toContain('2 itens parados')
    expect(t).toContain('limite 2 h de expediente')
    expect(t).toContain('• CX[3][500] · 500 placas · 3 h 10 min')
    expect(t).toContain('• CX[4][500] · 500 placas · 2 h 05 min')
    expect(t).toContain('Regra: Parado no Almox · 28/10 15:05')
  })

  it('singular quando é um item só', () => {
    const t = textoAlertaParado({
      ...base, itens: [{ tipo: 'caixa', codigo: 'CX[1][500]', pecas: 500, minutos: 130 }],
    })
    expect(t).toContain('1 item parado')
  })

  it('lote leva o código do lote e peças avulsas dizem "a mais antiga"', () => {
    const t = textoAlertaParado({
      ...base,
      itens: [
        { tipo: 'lote', codigo: 'LOTE 7', pecas: 100, minutos: 200 },
        { tipo: 'peca', codigo: 'AVULSAS', pecas: 37, minutos: 180 },
      ],
    })
    expect(t).toContain('• Lote LOTE 7 · 100 placas · 3 h 20 min')
    expect(t).toContain('• Peças avulsas · 37 placas · a mais antiga há 3 h')
  })

  it('nunca passa de 2000 caracteres, com aviso do que ficou de fora', () => {
    const itens = Array.from({ length: 200 }, (_, i) => ({
      tipo: 'caixa' as const, codigo: `CX[${i + 1}][500]`, pecas: 500, minutos: 600 - i,
    }))
    const t = textoAlertaParado({ ...base, itens })
    expect(t.length).toBeLessThanOrEqual(2000 - 160) // folga do cabeçalho de lembrete/reabertura
    expect(t).toContain('… e mais')
    expect(t).toContain('200 itens parados')
  })
})

describe('textoNormalizouParado', () => {
  it('diz que a OP não tem mais nada parado', () => {
    expect(textoNormalizouParado({ pmo: 'PRT797', op: '8563' })).toBe(
      '🟢 Almoxarifado: OP PRT797/8563 sem itens parados',
    )
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/parados-texto.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Implementar `parados-texto.ts`**

```ts
import { LIMITE_MENSAGEM, formatarDataHoraCurta, listaComCorte, textoOp, type ParOp } from './mensagens'
import type { ItemParado } from './parados'

/** Margem que o lembrete e a reabertura acrescentam acima do texto (mesma de `mensagens.ts`). */
const MARGEM_CABECALHO = 160

/** '45 min' · '2 h' · '2 h 05 min' */
export function formatarMinutos(min: number): string {
  const m = Math.max(0, Math.floor(min))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, '0')} min`
}

export interface DadosParado extends ParOp {
  regraNome: string
  limiteHoras: number
  itens: readonly ItemParado[]
  em: Date
}

function linhaDoItem(i: ItemParado): string {
  if (i.tipo === 'peca') {
    return `• Peças avulsas · ${i.pecas} placas · a mais antiga há ${formatarMinutos(i.minutos)}`
  }
  const nome = i.tipo === 'lote' ? `Lote ${i.codigo}` : i.codigo
  return `• ${nome} · ${i.pecas} placas · ${formatarMinutos(i.minutos)}`
}

/**
 * A mensagem do alerta de parado, UMA por OP: o cabeçalho diz quantos itens e qual o limite, e cada
 * item vem numa linha (código, placas, tempo de expediente). O orçamento da lista é o que sobra dos
 * 2000 do Discord depois do cabeçalho, do rodapé e da margem do lembrete/reabertura; o que não cabe
 * vira "… e mais N itens" (o Discord RECUSA a mensagem inteira acima do limite, não corta).
 */
export function textoAlertaParado(d: DadosParado): string {
  const n = d.itens.length
  const cabecalho =
    `⚠️ Almoxarifado: OP ${textoOp(d)} com ${n} ${n === 1 ? 'item parado' : 'itens parados'} ` +
    `(limite ${d.limiteHoras} h de expediente)`
  const rodape = `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  const orcamento = LIMITE_MENSAGEM - MARGEM_CABECALHO - cabecalho.length - rodape.length - 2
  const lista = listaComCorte(d.itens.map(linhaDoItem), orcamento, 'item', 'itens', '\n')
  return [cabecalho, lista, rodape].filter((p) => p !== '').join('\n')
}

export function textoNormalizouParado(d: ParOp): string {
  return `🟢 Almoxarifado: OP ${textoOp(d)} sem itens parados`
}
```

Verificar que `ParOp` e `textoOp` são exportados por `mensagens.ts` (são, hoje). Se `ParOp` não estiver exportado, exporte.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/parados-texto.test.ts`
Expected: PASS. Se o teste de 2000 caracteres falhar por poucos caracteres, o ajuste é no orçamento (não no teste): a mensagem inteira, mais a margem, tem de caber em 2000.

- [ ] **Step 6: Teste do despacho, falhando**

```ts
import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'

const dados = {
  regra_tipo: 'parado', regra_nome: 'Parado no Almox', posto: 'ALMOX',
  janela_tipo: 'op', janela_valor: null, pmo: 'PRT797', op: '8563',
  ops: [{ pmo: 'PRT797', op: '8563' }],
  aberta_em: '2026-10-28T17:00:00Z', agora: '2026-10-28T18:05:00Z',
  limite_horas: 2, mais_antiga_min: 190,
  itens: [{ tipo: 'caixa', codigo: 'CX[3][500]', pecas: 500, minutos: 190 }],
}

describe('textoDoEnvio — parado', () => {
  it('alerta', () => {
    const t = textoDoEnvio('alerta', dados)
    expect(t).toContain('OP PRT797/8563')
    expect(t).toContain('• CX[3][500] · 500 placas · 3 h 10 min')
  })

  it('lembrete leva o cabeçalho de lembrete', () => {
    expect(textoDoEnvio('lembrete', dados)).toMatch(/^⏰ Lembrete — continua há \d+ min\n/)
  })

  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...dados, itens: [] })).toBe(
      '🟢 Almoxarifado: OP PRT797/8563 sem itens parados',
    )
  })

  it('reabertura envolve o texto com o cabeçalho de reabertura', () => {
    const t = textoDoEnvio('alerta', {
      ...dados, reabertura: true, resolvida_por_nome: 'Ana', resolvida_em: '2026-10-28T16:00:00Z',
    })
    expect(t).toMatch(/^🔁 Reaberto — dado como resolvido por Ana/)
  })

  it('itens que não são lista viram erro de dados, não mensagem vazia', () => {
    expect(() => textoDoEnvio('alerta', { ...dados, itens: 'x' })).toThrow(/DADOS_INVALIDOS/)
  })
})
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npx vitest run src/modules/alertas/domain/__tests__/envio-parado.test.ts`
Expected: FAIL (despacho cai em `textoAprovacao` e lança por falta de `aprovados`).

- [ ] **Step 8: Implementar o despacho em `envio.ts`**

Adicionar o import `import { textoAlertaParado, textoNormalizouParado } from './parados-texto'` e `import type { ItemParado } from './parados'`. Acrescentar, junto de `textoDefeito`:

```ts
/** Lê o `dados` do parado (0167): `itens` (array de {tipo, codigo, pecas, minutos}) e `limite_horas`. */
function textoParado(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const refOp = refOpDe(dados)
  if (tipo === 'normalizou') return textoNormalizouParado(refOp)
  if (!Array.isArray(dados.itens)) throw new DadosEnvioInvalidos('itens')
  const itens: ItemParado[] = dados.itens.map((bruto) => {
    if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
      throw new DadosEnvioInvalidos('itens')
    }
    const i = bruto as Record<string, unknown>
    const t = i.tipo
    if (t !== 'caixa' && t !== 'lote' && t !== 'peca') throw new DadosEnvioInvalidos('itens.tipo')
    return { tipo: t, codigo: texto(i, 'codigo'), pecas: numero(i, 'pecas'), minutos: numero(i, 'minutos') }
  })
  const agora = data(dados, 'agora')
  const alerta = textoAlertaParado({
    ...refOp,
    regraNome: texto(dados, 'regra_nome'),
    limiteHoras: numero(dados, 'limite_horas'),
    itens,
    em: agora,
  })
  if (tipo === 'alerta') return alerta
  return textoLembreteTipo(alerta, data(dados, 'aberta_em'), agora)
}
```

No `textoDoEnvio`, trocar a escolha do corpo por:

```ts
  const corpo =
    regraTipo === 'tempo'
      ? textoTempo(tipo, dados)
      : regraTipo === 'defeito'
        ? textoDefeito(tipo, dados)
        : regraTipo === 'parado'
          ? textoParado(tipo, dados)
          : textoAprovacao(tipo, dados)
```

e documentar a chave nova no comentário de cabeçalho da função (`parado: limite_horas, mais_antiga_min, itens ...; 0167`).

- [ ] **Step 9: Rodar e ver passar; suíte do domínio**

Run: `npx vitest run src/modules/alertas/domain`
Expected: PASS em tudo (nenhum teste antigo quebra).

- [ ] **Step 10: Commit**

```bash
git add src/modules/alertas/domain
git commit -m "$(cat <<'EOF'
feat(alertas): texto do alerta de parado e despacho em textoDoEnvio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: A regra `parado` (validação, repositório, formulário, lista)

**Files:**
- Modify: `src/modules/alertas/domain/regra.ts`, `src/modules/alertas/infra/regras-repository.ts`, `src/modules/alertas/ui/regra-form.tsx`, `src/modules/alertas/ui/regra-dialog.tsx`, `src/modules/alertas/ui/regras-lista.tsx`, `src/modules/alertas/ui/ocorrencias-lista.tsx`, e o que mais o compilador apontar
- Test: `src/modules/alertas/domain/__tests__/regra-parado.test.ts`, `src/modules/alertas/infra/__tests__/regras-repository-parado.test.ts`

**Interfaces:**
- Consumes: `TipoRegra` com `'parado'` (Tarefa 3, Step 1).
- Produces: a regra do tipo `parado` com o campo `limiteHoras: number | null` em `RegraAlerta` e na entrada do formulário; a coluna `limite_horas`.

Leitura obrigatória antes de editar: `regra.ts` por inteiro (525 linhas) e os testes `regra-emb.test.ts`/`regra-resumo.test.ts`, que mostram o padrão de um tipo "sem janela". Toda condição `tipo !== 'resumo' && tipo !== 'emb'` precisa decidir o que `parado` faz.

Comportamento exigido (cada item é um teste em `regra-parado.test.ts`, no estilo de `regra-emb.test.ts`):

- [ ] **Step 1: Escrever os testes que falham** — a validação de uma regra `parado`:
  1. aceita: `tipo 'parado'`, nome, ≥1 posto, `limiteHoras` inteiro de 1 a 72, canais/destinatários como as outras; sai com `janelaTipo: 'op'`, `janelaValor: null`, `taxaMinima`/`minimoBipes`/`limiteTempoSeg`/`limiteOcorrencias`/`pausaMaxMin` nulos, `lembreteMin` opcional;
  2. recusa `limiteHoras` ausente, 0, 73, 1,5 e texto, com a mensagem `'Informe o limite em horas (de 1 a 72).'`;
  3. recusa zero postos (`'Escolha pelo menos 1 posto.'`), como as demais;
  4. aceita turnos (`intervalos`) opcionais; sem turno é válido (relógio corrido); cada turno passa por `validarIntervalos(lista, null)` e erro de turno vira o erro da regra;
  5. aceita filtro de PMOs como as outras;
  6. `resumoLimite(regra)` mostra `Parado há mais de N h de expediente` e `resumoJanelaRegra(regra)` mostra `Itens prontos sem entrada no Almoxarifado`.

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/modules/alertas/domain/__tests__/regra-parado.test.ts` → FAIL.

- [ ] **Step 3: Implementar em `regra.ts`** o que os testes pedem: constante `LIMITE_HORAS_MAX = 72` e `LIMITE_HORAS_PADRAO = 2` exportadas; campo `limiteHoras`; o ramo `if (tipo === 'parado')` na validação (antes dos ramos de janela), reaproveitando `validarIntervalos` e a normalização de postos/PMOs/canais existente; `janelaTipo = 'op'` de fachada (o mesmo caminho do `emb`, linha 272); as frases das duas colunas da lista (perto das linhas 479 e 495). Não alterar o comportamento dos outros tipos.

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/modules/alertas/domain` → PASS (incluindo `regra-emb`, `regra-resumo`, `regra-tipos`).

- [ ] **Step 5: Repositório — testes que falham** (`regras-repository-parado.test.ts`, padrão de `regras-repository-tipos.test.ts`): o insert manda **toda coluna** (inclusive `limite_horas`, e `null` explícito nas colunas dos outros tipos, porque `minimo_bipes` tem `default 20` e quebraria o `check`); a leitura devolve `limiteHoras` como número; os turnos são gravados em `alerta_regra_intervalos` também para `tipo = 'parado'` (hoje só para janela `intervalos`/`resumo`) e lidos de volta; editar uma regra `parado` substitui os turnos (apagar-e-inserir, como já é feito).

- [ ] **Step 6: Implementar em `regras-repository.ts`** o mapeamento da coluna `limite_horas` (entrada e saída) e a condição de gravar/ler turnos para o tipo `parado`. Rodar `npx vitest run src/modules/alertas/infra` → PASS.

- [ ] **Step 7: Formulário e telas**
  - `regra-form.tsx`: escolha do tipo (o cartão novo aparece pela `DESCRICAO_TIPO_REGRA`); quando `parado`: campo **"Limite (horas)"** (inteiro, padrão 2, 1 a 72), o seletor de postos listando **só postos de perfil `almoxarifado`** (se o carregador dos postos não traz o perfil, estender a leitura que alimenta o picker para trazer `recurso`), o editor de turnos (`intervalos-editor.tsx`, sem passo; rótulo "Turnos (conta só as horas de expediente; vazio = relógio corrido)"), PMOs e lembrete como nas outras. Esconder o que não se aplica (janela, taxa, mínimo de bipes, pausa).
  - `regra-dialog.tsx` e `regras-lista.tsx`: o tipo novo aparece com nome e frases próprias.
  - `ocorrencias-lista.tsx`: ocorrência de regra `parado` guarda `PMO/OP` na coluna `defeito`; a lista deve mostrar **"OP PMO/OP"** (e nunca passar esse texto por `rotuloDefeito`). Verificar também `alerta_listar_ocorrencias` (último `create or replace` em migração): se ele não devolve `defeito`, a Tarefa 5 o ajusta.
  - Se existir teste de componente da tela de regras (`alertas-actions.test.ts` e afins), estender: criar regra `parado` válida e inválida pela server action.

- [ ] **Step 8: Verificação** — `npx tsc --noEmit` limpo e `npx vitest run src/modules/alertas src/app` sem falha.

- [ ] **Step 9: Commit**

```bash
git add -A src/modules/alertas src/app
git commit -m "$(cat <<'EOF'
feat(alertas): regra do tipo parado (limite em horas, turnos, postos do Almoxarifado)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migração 0167 e testes SQL

**Files:**
- Create: `supabase/migrations/0167_alerta_almox_parado.sql`, `supabase/tests/alertas_parado_test.sql`, `supabase/tests/almox_pendencias_base_test.sql`
- Modify: `supabase/tests/rodar-alertas-test.sh`, `supabase/tests/rodar-almoxarifado-test.sh`

**Interfaces:**
- Consumes: a versão vigente de `sf_almox_pendencias` (0165, linhas 1285–1356) e de `alerta_avaliar` (0151).
- Produces: `sf_almox_pendencias_base()` (service_role) com as colunas `(pmo, op, tipo, codigo, seq, pecas, lote_id, amostra, ja_lancadas, em, posto, em_mais_antiga)`; `sf_almox_pendencias()` com o mesmo contrato de antes; `alerta_avaliar(text, jsonb, jsonb, jsonb)`; coluna `alerta_regras.limite_horas`; tipo `parado`.

- [ ] **Step 1: Montar a migração com um script que falha alto se uma âncora sumir**

Criar `/tmp/montar-0167.py` (descartável, fora do repositório) com este conteúdo e rodar com `python3 -I /tmp/montar-0167.py` a partir da raiz da worktree. Cada `assert` garante que a âncora existe **uma vez** no texto de origem; se a 0151 ou a 0165 mudarem, o script para em vez de gerar SQL errado.

```python
import re, pathlib
M = pathlib.Path('supabase/migrations')

def trecho(arq, ini, fim):
    t = (M / arq).read_text(encoding='utf-8')
    a = t.index(ini)
    b = t.index(fim, a) + len(fim)
    return t[a:b]

def troca(t, antigo, novo):
    assert t.count(antigo) == 1, f'âncora ausente ou repetida: {antigo[:60]!r}'
    return t.replace(antigo, novo)

# ---------- 1. alerta_avaliar (0151) com 4 parâmetros ----------
av = trecho('0151_alertas_canal_email.sql',
            'create or replace function public.alerta_avaliar(', '\n$func$;\n')

av = troca(av,
  'create or replace function public.alerta_avaliar(\n  p_canal_discord text default null, p_blocos jsonb default null, p_resumos jsonb default null\n)',
  'create or replace function public.alerta_avaliar(\n  p_canal_discord text default null, p_blocos jsonb default null, p_resumos jsonb default null,\n  p_parados jsonb default null\n)')

av = troca(av, '  v_emb_n        int;\n', '  v_emb_n        int;\n  -- Só o parado no Almoxarifado usa esta (itens da OP, vindos do app em p_parados).\n  v_itens        jsonb;\n')

ramo = '''        union all
        -- Parado no Almoxarifado (0167): UMA linha por OP com item acima do limite, e uma linha de valor 0
        -- por ocorrência viva que deixou de ter item parado (é ela que normaliza). A CONTA DE HORÁRIO
        -- VEM DO APP em p_parados ({"<regra_id>": [{pmo, op, posto, mais_antiga_min, itens}]}); o banco
        -- só decide abrir, atualizar e normalizar. REGRA AUSENTE DO MAPA É PULADA: se o app não conseguiu
        -- ler as pendências, nada é decidido (normalizar por engano seria pior que atrasar).
        -- A chave da ocorrência é PMO/OP na coluna `defeito` (índice único alerta_ocorrencias_viva_defeito).
        -- A ORDEM DAS COLUNAS é a do ramo da aprovação (união posicional, 26 colunas).
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.avisar_pessoas, rg.avisar_canal, rg.criado_em,
               rg.modulo,
               pd.posto, pd.chave, pd.pmo, pd.op,
               0, 0,
               pd.amostras,
               true,
               pd.valor,
               (rg.limite_horas * 60)::numeric,
               '{}'::text[], jsonb_build_array(jsonb_build_object('pmo', pd.pmo, 'op', pd.op)),
               null::timestamptz, null::timestamptz
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select e ->> 'posto' as posto, (e ->> 'pmo') || '/' || (e ->> 'op') as chave,
                     e ->> 'pmo' as pmo, e ->> 'op' as op,
                     coalesce(jsonb_array_length(e -> 'itens'), 0) as amostras,
                     (e ->> 'mais_antiga_min')::numeric as valor
                from jsonb_array_elements(
                       case when jsonb_typeof(p_parados -> rg.id::text) = 'array'
                            then p_parados -> rg.id::text else '[]'::jsonb end) e
               where e ->> 'posto' = any (rg.postos)
            )
            select d.posto, d.chave, d.pmo, d.op, d.amostras, d.valor from d
            union all
            select oc.posto, oc.defeito, oc.pmo, oc.op, 0, 0::numeric
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.chave = oc.defeito)
          ) pd
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'parado'
           and p_parados is not null and p_parados ? rg.id::text
'''
av = troca(av,
  "         where rg.ativa and rg.excluida_em is null and rg.tipo = 'emb'\n      ) m\n",
  "         where rg.ativa and rg.excluida_em is null and rg.tipo = 'emb'\n" + ramo + "      ) m\n")

av = troca(av,
  "      v_dados := jsonb_build_object(\n                   'regra_tipo',   t.tipo,\n                   'regra_nome',   t.nome,\n                   'posto',        t.posto,",
  "      -- Itens da OP (só o parado): o app os mandou em p_parados; na normalização não há, e vai [].\n"
  "      v_itens := null;\n"
  "      if t.tipo = 'parado' then\n"
  "        select e -> 'itens' into v_itens\n"
  "          from jsonb_array_elements(coalesce(p_parados -> t.regra_id::text, '[]'::jsonb)) e\n"
  "         where e ->> 'pmo' = t.pmo and e ->> 'op' = t.op\n"
  "         limit 1;\n"
  "      end if;\n"
  "      v_dados := jsonb_build_object(\n                   'regra_tipo',   t.tipo,\n                   'regra_nome',   t.nome,\n                   'posto',        t.posto,")

av = troca(av,
  "                      else jsonb_build_object(\n                        'defeito', t.defeito,",
  "                      when 'parado' then jsonb_build_object(\n"
  "                        'limite_horas', (t.limite / 60)::int, 'mais_antiga_min', t.valor,\n"
  "                        'itens', coalesce(v_itens, '[]'::jsonb))\n"
  "                      else jsonb_build_object(\n                        'defeito', t.defeito,")

# ---------- 2. sf_almox_pendencias (0165): base sem permissão + casca ----------
pend = trecho('0165_placas_almoxarifado.sql',
              'create or replace function public.sf_almox_pendencias()', '\n$func$;\n')
base = pend
base = troca(base, 'create or replace function public.sf_almox_pendencias()', 'create or replace function public.sf_almox_pendencias_base()')
base = troca(base, 'lote_id uuid, amostra int, ja_lancadas int, em timestamptz)',
                   'lote_id uuid, amostra int, ja_lancadas int, em timestamptz,\n               posto text, em_mais_antiga timestamptz)')
base = troca(base, "  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then\n    raise exception 'SEM_PERMISSAO';\n  end if;\n\n", '')
# posto Almoxarifado da rota: calculado uma vez por OP, antes de escolher o ramo
sel_posto = ("      select opp.posto into v_almox\n        from sf_ordem_postos opp\n        join sf_postos po       on po.chave = opp.posto\n"
             "        join sf_posto_perfis pe on pe.chave = po.perfil\n       where opp.ordem_id = v_o.o_id and pe.recurso = 'almoxarifado'\n"
             "       order by opp.ordem, opp.posto\n       limit 1;\n")
base = troca(base, "      -- Peças avulsas: o posto Almoxarifado DA ROTA (pelo perfil, o mesmo select do detalhe) e o anterior a ele.\n" + sel_posto,
                   "      -- Peças avulsas: o anterior ao posto Almoxarifado da rota (v_almox, calculado acima).\n")
base = troca(base, "    if v_o.individual then\n", "    -- O posto Almoxarifado DA ROTA (pelo perfil): o alerta de parado chaveia a ocorrência por ele.\n" + sel_posto.replace('      select', '    select', 1).replace('\n        ', '\n      ') + "    if v_o.individual then\n")
base = troca(base, "l.lote_id, l.amostra, l.ja_lancadas, l.aprovado_em\n", "l.lote_id, l.amostra, l.ja_lancadas, l.aprovado_em,\n             v_almox, l.aprovado_em\n")
base = troca(base, "null::uuid, null::int, 0, max(e.conc)\n", "null::uuid, null::int, 0, max(e.conc),\n               v_almox, min(e.conc)\n")
base = troca(base, "null::uuid, null::int, 0, n.fechada_em\n", "null::uuid, null::int, 0, n.fechada_em,\n             v_almox, n.fechada_em\n")

casca = '''create or replace function public.sf_almox_pendencias()
returns table (pmo text, op text, tipo text, codigo text, seq int, pecas int,
               lote_id uuid, amostra int, ja_lancadas int, em timestamptz)
language plpgsql stable
security definer
set search_path = public
as $func$
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;
  return query
  select b.pmo, b.op, b.tipo, b.codigo, b.seq, b.pecas, b.lote_id, b.amostra, b.ja_lancadas, b.em
    from public.sf_almox_pendencias_base() b;
end;
$func$;
'''

cab = '''-- =============================================================
-- ALERTAS — PARADO NO ALMOXARIFADO
-- Spec: docs/superpowers/specs/2026-10-29-alerta-almoxarifado-parado-design.md
--
-- Aplica POR CIMA da 0151 (alertas) e da 0165 (pendências em placas). Idempotente.
--
--   A. alerta_regras: tipo 'parado' + coluna limite_horas (inteiro, 1 a 72).
--   B. sf_almox_pendencias_base(): o cálculo das pendências SEM checar permissão (o cron roda como
--      serviço, sem usuário, e a função pública devolve SEM_PERMISSAO para ele). Devolve também o
--      `posto` Almoxarifado da rota e `em_mais_antiga` (das peças avulsas é o min; `em` segue max).
--      A sf_almox_pendencias() pública vira casca: checa a permissão e delega; contrato igual ao de antes.
--   C. alerta_avaliar ganha o 4º parâmetro p_parados e o ramo do tipo novo. A assinatura MUDA:
--      o drop da de 3 parâmetros vem ANTES (senão sobram duas sobrecargas e a chamada fica ambígua).
--      O app antigo (3 parâmetros nomeados) continua funcionando contra a função nova.
--
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \\
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0167_alerta_almox_parado.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (o app novo manda tipo 'parado' e p_parados).
-- ⚠️ Os `add constraint` validam as linhas que já existem; nenhuma regra de produção é do tipo novo.
-- Convenções: corpo de função com $func$; grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- A. o tipo e o limite ----------
alter table public.alerta_regras add column if not exists limite_horas int;

alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito', 'resumo', 'emb', 'parado'));

alter table public.alerta_regras drop constraint if exists alerta_regras_modulo_tipo;
alter table public.alerta_regras add constraint alerta_regras_modulo_tipo check (coalesce(
  case modulo
    when 'shopfloor'   then tipo in ('aprovacao', 'tempo', 'defeito', 'resumo', 'parado')
    when 'recebimento' then tipo in ('emb')
  end, false));

alter table public.alerta_regras drop constraint if exists alerta_regras_limite_horas_so_parado;
alter table public.alerta_regras add constraint alerta_regras_limite_horas_so_parado
  check ((tipo = 'parado' and limite_horas between 1 and 72) or (tipo <> 'parado' and limite_horas is null));
'''
# campos_por_tipo: a 0150 é a última a reescrevê-lo; o ramo novo entra por substituição do `end, false`
cpt = trecho('0150_alertas_fim_de_emb.sql',
             'alter table public.alerta_regras drop constraint if exists alerta_regras_campos_por_tipo;',
             "  end, false));\n")
cpt = troca(cpt, "      and hora_resumo is null\n  end, false));\n",
  "      and hora_resumo is null\n"
  "    when 'parado' then\n"
  "          janela_tipo = 'op'\n"
  "      and janela_valor is null\n"
  "      and cardinality(postos) > 0\n"
  "      and taxa_minima is null and minimo_bipes is null\n"
  "      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null\n"
  "      and hora_resumo is null\n"
  "  end, false));\n")

saida = (cab + '\n' + cpt + '\n'
  '-- ---------- B. pendências: base interna + casca pública ----------\n'
  'drop function if exists public.sf_almox_pendencias_base();\n'
  + base + '\n$func$;\n\n'
  "revoke all on function public.sf_almox_pendencias_base() from public, anon, authenticated;\n"
  "grant execute on function public.sf_almox_pendencias_base() to service_role;\n\n"
  + casca + '\n'
  "revoke all on function public.sf_almox_pendencias() from public, anon;\n"
  "grant execute on function public.sf_almox_pendencias() to authenticated;\n\n"
  '-- ---------- C. alerta_avaliar de 4 parâmetros ----------\n'
  'drop function if exists public.alerta_avaliar(text, jsonb, jsonb);\n'
  + av + '\n$func$;\n\n'
  "revoke all on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) from public, anon, authenticated;\n"
  "grant execute on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) to service_role;\n\n"
  "notify pgrst, 'reload schema';\n")
(M / '0167_alerta_almox_parado.sql').write_text(saida, encoding='utf-8')
print('0167 gerada,', len(saida.splitlines()), 'linhas')
```

Run: `python3 -I /tmp/montar-0167.py`
Expected: `0167 gerada, ~900 linhas`. Qualquer `AssertionError` é âncora que mudou: parar e ajustar o script, nunca editar o SQL gerado às cegas.

Conferências do arquivo gerado (rodar e ver):
```bash
grep -c "create or replace function public.alerta_avaliar" supabase/migrations/0167_alerta_almox_parado.sql   # 1
grep -n "p_parados" supabase/migrations/0167_alerta_almox_parado.sql | head                                    # parâmetro, ramo, lookup
grep -n "v_almox" supabase/migrations/0167_alerta_almox_parado.sql | head -12                                  # select único, usado nos 3 ramos
```

- [ ] **Step 2: Conferir `alerta_listar_ocorrencias`** — `grep -n "alerta_listar_ocorrencias" supabase/migrations/*.sql | tail -3`. Se a versão vigente não devolve `defeito`, acrescentar à 0167 o `drop`+`create` com a coluna (copiando o corpo vigente) para a tela mostrar "OP PMO/OP". Se já devolve, nada a fazer.

- [ ] **Step 3: Teste SQL do tipo no `alerta_avaliar`** (`supabase/tests/alertas_parado_test.sql`), no estilo de `alertas_emb_test.sql` (mesmos `set_config` de usuário e permissões, mesmas funções-ajudantes de regra e de contagem da fila; ler esse arquivo antes). Casos, todos com `p_parados` montado à mão (o banco não precisa de `sf_registros` aqui):
  1. **esquema:** tipo `parado` aceito; `limite_horas` fora de 1–72 recusado; `limite_horas` em regra de outro tipo recusado; regra `parado` com `janela_tipo` diferente de `'op'` recusada; existe **uma só** `alerta_avaliar` (conferir `pg_proc`) e é a de 4 parâmetros; `service_role` executa, `anon` e `authenticated` não.
  2. **abre:** regra `parado` (posto `ALMOX`, responsável com conta de Telegram) + `p_parados` com a OP `PRT797/8563` e 2 itens → **uma** ocorrência viva com `pmo`/`op` preenchidos e `defeito = 'PRT797/8563'`, **uma** linha de fila `tipo = 'alerta'` com `dados->'itens'` de 2 elementos e `dados->>'limite_horas'`.
  3. **idempotência:** a mesma rodada de novo → zero linhas novas na fila, mesma ocorrência.
  4. **uma por OP:** duas OPs no mesmo mapa → duas ocorrências; cada uma com os próprios itens.
  5. **item novo entra na mesma ocorrência, sem mensagem:** terceira caixa no mapa → `valor_ultimo`/`amostras` sobem, fila sem linha nova (a regra não tem lembrete).
  6. **lembrete:** com `lembrete_min` e a ocorrência velha → sai `tipo = 'lembrete'` com a lista atualizada.
  7. **normaliza:** mapa com a chave da regra e array **vazio** → ocorrência `normalizada`, uma linha `tipo = 'normalizou'`.
  8. **regra ausente do mapa é pulada:** `p_parados` sem a chave da regra (ou nulo) → a ocorrência viva **continua aberta**, nada na fila.
  9. **resolvida + reabertura:** resolver (`alerta_resolver_interno`) e rodar com o problema ainda no mapa antes da carência → continua `resolvida`; depois da carência de 60 min (envelhecer `resolvida_em`) → volta `aberta` com `tipo = 'alerta'` e `reabertura = true`.
  10. **posto fora da regra:** item com `posto` que não está em `rg.postos` → ignorado (nenhuma ocorrência).
  11. **regra desativada encerra a ocorrência viva** sem envio (o passo do topo do `alerta_avaliar`).
  12. **os outros tipos seguem:** uma regra de aprovação continua avaliando na mesma rodada (`avaliadas` sobe).
  13. **compatibilidade do app antigo:** `select alerta_avaliar(p_canal_discord => null, p_blocos => null, p_resumos => null)` (3 parâmetros nomeados) executa sem erro de ambiguidade.

- [ ] **Step 4: Teste SQL da função base** (`supabase/tests/almox_pendencias_base_test.sql`), no estilo de `almoxarifado_test.sql` (ler o runner `rodar-almoxarifado-test.sh` e o teste mais recente das pendências, `placas_almoxarifado_test.sql`): usando os mesmos dados de OP/caixa/lote/avulsas que esses testes já montam, provar que (a) como `service_role` (sem `auth.uid()`), `sf_almox_pendencias_base()` devolve as linhas, e a pública (`sf_almox_pendencias()`) como o mesmo papel levanta `SEM_PERMISSAO`; (b) a pública, com permissão, devolve **exatamente** as mesmas linhas de antes nas 10 colunas do contrato (comparar com a consulta antiga guardada no teste); (c) a coluna `posto` é a chave do posto Almoxarifado da rota nas três espécies de linha; (d) `em_mais_antiga` das avulsas é o `min` e `em` continua o `max`; (e) `anon`/`authenticated` não executam a base.

- [ ] **Step 5: Ligar nos runners** — em `rodar-alertas-test.sh`, depois do bloco da 0151/`alertas_emb_teto_test.sql`, aplicar a 0167 **duas vezes** com `-1 -v ON_ERROR_STOP=1` e rodar `alertas_parado_test.sql` (copiar o padrão do bloco da 0150: `docker cp`, `psql`). Em `rodar-almoxarifado-test.sh`, depois da 0165, aplicar a 0167 duas vezes e rodar `almox_pendencias_base_test.sql`. Atenção: no runner de alertas, as tabelas `sf_*` não existem (só `_stubs.sql`); a 0167 só cria funções plpgsql que as citam (resolvidas em tempo de execução), então aplica sem elas.

- [ ] **Step 6: Rodar os dois runners**

Run: `bash supabase/tests/rodar-alertas-test.sh && bash supabase/tests/rodar-almoxarifado-test.sh`
Expected: ambos terminam sem erro e imprimem os `ok` dos testes novos. Falha em teste antigo = a 0167 quebrou algo (o mais provável: o `drop` da assinatura antiga ou o `union all` posicional): corrigir o gerador, não o teste.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0167_alerta_almox_parado.sql supabase/tests
git commit -m "$(cat <<'EOF'
feat(alertas): migração 0167 — tipo parado, pendências sem permissão e alerta_avaliar de 4 parâmetros

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: O app alimenta o `p_parados` (`repositorio-servico.ts`)

**Files:**
- Modify: `src/modules/alertas/infra/repositorio-servico.ts`
- Test: `src/modules/alertas/infra/__tests__/repositorio-servico-parados.test.ts`

**Interfaces:**
- Consumes: `paradosPorOp`, `paradosParaBanco`, `ItemPendente` (Tarefa 2); a função `sf_almox_pendencias_base` e a coluna `limite_horas` (Tarefa 5); `lerIntervaloDoBanco`.
- Produces: `p_parados` no `rpc('alerta_avaliar', ...)`, com a chave de uma regra **só** quando a leitura das pendências deu certo.

Ler `repositorio-servico.test.ts` antes: ele mostra como o cliente Supabase é simulado (builder encadeável e `rpc`). Seguir o mesmo molde.

- [ ] **Step 1: Escrever os testes que falham** (`repositorio-servico-parados.test.ts`):
  1. sem regra `parado` ativa: `avaliar()` chama o `rpc` com `p_parados: {}` e **não** chama `sf_almox_pendencias_base`;
  2. com uma regra (id `r1`, postos `['ALMOX']`, `limite_horas` 2, turnos 07:00–17:30) e pendências simuladas (uma caixa pronta há 5 h de expediente, uma há 1 h, ambas da OP `PRT797/8563`, posto `ALMOX`): `p_parados.r1` é um array com **um** grupo da OP, com **um** item (a de 5 h), no formato `paradosParaBanco`;
  3. `em_mais_antiga` tem prioridade sobre `em` quando presente (avulsas);
  4. posto fora de `rg.postos` e PMO fora do filtro `pmos` da regra são descartados;
  5. todas as pendências abaixo do limite: `p_parados.r1` é **`[]`** (chave presente, array vazio — é o que faz normalizar);
  6. erro ao ler as pendências (`rpc` devolve `error`): `p_parados` **sem a chave** da regra (e o `avaliar` continua, com log), para o banco pular a regra em vez de normalizar;
  7. erro ao ler os turnos: mesma coisa (sem a chave);
  8. regra sem turno cadastrado: conta relógio corrido e a chave vem;
  9. duas regras `parado` com limites diferentes: cada uma recebe o seu mapa (as pendências são lidas **uma vez** só por rodada).

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/modules/alertas/infra/__tests__/repositorio-servico-parados.test.ts` → FAIL.

- [ ] **Step 3: Implementar `paradosDaRodada(agora)`**, ao lado de `blocosDaRodada`/`resumosDaRodada`, no mesmo padrão e com a mesma regra de ouro (erro de leitura não derruba a rodada, e o que falhou fica **fora** do mapa):

```ts
  /**
   * O mapa `p_parados` da rodada: {"<regra_id>": [{pmo, op, posto, mais_antiga_min, itens}]} para cada
   * regra de parado no Almoxarifado ativa. A conta de horário (turnos, semana útil) mora aqui, em
   * `domain/horas-de-turno.ts`, testada; o banco só decide abrir/atualizar/normalizar.
   * ⚠️ A chave de uma regra só entra se TUDO que ela precisa foi lido (pendências e turnos). Regra
   * ausente do mapa é PULADA pelo banco: erro de leitura nunca vira "não tem nada parado", que
   * normalizaria a ocorrência viva por engano. Array vazio É informação ("nada parado agora").
   */
  async function paradosDaRodada(agora: Date): Promise<Record<string, unknown[]>> {
    const mapa: Record<string, unknown[]> = {}

    const { data, error } = await sb
      .from('alerta_regras')
      .select('id, postos, pmos, limite_horas')
      .eq('ativa', true)
      .is('excluida_em', null)
      .eq('tipo', 'parado')
    if (error) {
      console.error('[alertas] ler as regras de parado no Almoxarifado falhou:', error.message)
      return mapa
    }
    // O limite tem que ser inteiro >= 1 (check do banco); o que não é vira barulho no log, não silêncio.
    const regras = ((data ?? []) as LinhaRegraParado[]).filter((r) => {
      const ok = typeof r.limite_horas === 'number' && Number.isInteger(r.limite_horas) && r.limite_horas >= 1
      if (!ok) console.error(`[alertas] regra ${r.id}: limite_horas ilegível (${String(r.limite_horas)}) — pulada`)
      return ok
    })
    if (regras.length === 0) return mapa

    // As pendências são lidas UMA vez por rodada, para todas as regras.
    const { data: pend, error: erroPend } = await sb.rpc('sf_almox_pendencias_base')
    if (erroPend) {
      console.error('[alertas] ler as pendências do Almoxarifado falhou:', erroPend.message)
      return mapa
    }

    const { data: linhas, error: erroTurnos } = await sb
      .from('alerta_regra_intervalos')
      .select('regra_id, inicio, fim')
      .in('regra_id', regras.map((r) => r.id))
      .order('inicio')
    if (erroTurnos) {
      console.error('[alertas] ler os turnos das regras de parado falhou:', erroTurnos.message)
      return mapa
    }
    const turnos = new Map<string, Intervalo[]>()
    for (const l of (linhas ?? []) as LinhaIntervaloBloco[]) {
      const intervalo = lerIntervaloDoBanco(l.inicio, l.fim)
      if (!intervalo) continue
      const lista = turnos.get(l.regra_id)
      if (lista) lista.push(intervalo)
      else turnos.set(l.regra_id, [intervalo])
    }

    const pendentes: ItemPendente[] = []
    for (const l of (pend ?? []) as LinhaPendencia[]) {
      if (l.tipo !== 'caixa' && l.tipo !== 'lote' && l.tipo !== 'peca') continue
      const posto = typeof l.posto === 'string' ? l.posto : ''
      if (posto === '') continue
      // Das peças avulsas `em` é a mais recente; para "parado" vale a mais ANTIGA (em_mais_antiga).
      const quando = new Date(l.em_mais_antiga ?? l.em)
      if (Number.isNaN(quando.getTime())) continue
      pendentes.push({
        pmo: l.pmo.trim(), op: l.op, posto, tipo: l.tipo,
        codigo: String(l.codigo ?? ''), pecas: Number(l.pecas) || 0, em: quando,
      })
    }

    for (const r of regras) {
      const postos = r.postos ?? []
      const pmos = (r.pmos ?? []).map((p) => p.trim())
      const dela = pendentes.filter(
        (p) => postos.includes(p.posto) && (pmos.length === 0 || pmos.includes(p.pmo)),
      )
      mapa[r.id] = paradosParaBanco(
        paradosPorOp(dela, turnos.get(r.id) ?? [], r.limite_horas as number, agora),
      )
    }
    return mapa
  }
```

Tipos auxiliares no topo do arquivo, junto dos outros `Linha*`:

```ts
interface LinhaRegraParado {
  id: string
  postos: string[] | null
  pmos: string[] | null
  limite_horas: unknown
}

interface LinhaPendencia {
  pmo: string
  op: string
  tipo: string
  codigo: string | null
  pecas: unknown
  em: string
  posto: string | null
  em_mais_antiga: string | null
}
```

Imports novos: `paradosPorOp`, `paradosParaBanco`, `type ItemPendente` de `'../domain/parados'`. A comparação de PMO usa `trim()` nos dois lados; confira em migração (`alerta_pmos_normalizar`) se o banco também põe em maiúsculas, e espelhe isso aqui se for o caso. No `avaliar()`, acrescentar `p_parados: await paradosDaRodada(agora)` ao objeto do `rpc`.

- [ ] **Step 4: Rodar e ver passar** — `npx vitest run src/modules/alertas/infra` → PASS (os testes antigos do `avaliar` esperam o objeto do `rpc`: atualizá-los para incluir `p_parados: {}`).

- [ ] **Step 5: Conferir o contrato do portas** — `src/modules/alertas/application/portas.ts` e `rota-avaliar.test.ts`: nada muda de assinatura (`avaliar()` não tem parâmetro). `npx vitest run src/modules/alertas/application` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/alertas
git commit -m "$(cat <<'EOF'
feat(alertas): o app calcula os itens parados e entrega ao alerta_avaliar (p_parados)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Medição, roteiro de deploy e verificação final

**Files:**
- Create: `docs/operacao/alerta-almox-parado/00-ROTEIRO.md`, `docs/operacao/alerta-almox-parado/01-medir.sql`
- Modify: este plano (marcar o que foi feito) e a memória do usuário não é tarefa do agente de código.

- [ ] **Step 1: Medição no Postgres local** (o harness de Docker já sobe um Postgres descartável): estender `almox_pendencias_base_test.sql` ou escrever `supabase/tests/almox_pendencias_base_massa.sql` que cria uma OP grande **nova e sem estatística** (≥ 10 mil registros, ≥ 50 caixas, uma OP individual com lotes e avulsas), roda `explain (analyze, buffers)` de `sf_almox_pendencias_base()` e registra o tempo. Critério: ≤ 300 ms com 10 mil registros por OP (o mesmo que a tela do Almoxarifado já atinge, 121 ms medidos em 23/10). Se passar muito disso, **parar e reportar**: a consulta roda a cada 5 minutos sobre todas as OPs ativas.

- [ ] **Step 2: Roteiro de deploy** em `docs/operacao/alerta-almox-parado/00-ROTEIRO.md`, no formato dos roteiros vizinhos (`docs/operacao/placas-por-painel/00-ROTEIRO.md`): conferência do ponto de partida (existe `sf_almox_pendencias` e `alerta_avaliar` de 3 parâmetros, não existe `limite_horas`); snapshot opcional do RDS; baixar o arquivo; aplicar a 0167 com `PGOPTIONS='-c lock_timeout=3s' ... -1 -v ON_ERROR_STOP=1`; `docker compose restart rest`; conferir (coluna, `alerta_avaliar` **uma** assinatura de 4 parâmetros, `sf_almox_pendencias_base` sem acesso de `authenticated`, `has_function_privilege`); depois `deploy.sh`; smoke numa OP de teste (criar a regra com limite de 1 h e `lembrete`, deixar uma caixa pronta, forçar a idade, ver a mensagem, dar a entrada e ver "normalizou"); rollback (o app antigo roda com o banco novo; para voltar o banco, recriar `alerta_avaliar` de 3 parâmetros a partir da 0151 e a `sf_almox_pendencias` da 0165, e `drop function sf_almox_pendencias_base`). Cada comando completo e executável sem edição, sem senha no texto.

- [ ] **Step 3: Verificação final**

Run, nesta ordem, e colar a saída resumida no relatório:
```bash
npx tsc --noEmit
npm test
npm run lint
bash supabase/tests/rodar-alertas-test.sh
bash supabase/tests/rodar-almoxarifado-test.sh
```
Expected: tudo limpo. (`next build` em worktree roda com `cp -al`; só rodar se a Tarefa 4 mexeu em arquivo de rota/página, e seguindo a nota `worktree-next-build` da memória.)

- [ ] **Step 4: Commit**

```bash
git add docs/operacao/alerta-almox-parado supabase/tests
git commit -m "$(cat <<'EOF'
docs(operacao): roteiro de deploy e medição do alerta de parado no Almoxarifado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

## Self-review (feita ao escrever)

- **Cobertura da spec:** unidade por OP (T2/T5), horas de turno e semana (T1), avulsas com `min` (T5 base), limite configurável 2 h (T4/T5), responsáveis/canais/lembrete/Resolver reaproveitados (T5 ramo no caminho de ocorrência), cálculo sem permissão (T5), turnos reaproveitados (T4/T6), PMOs (T6), mensagem por OP listando cada caixa (T3), normaliza sozinha (T5 caso 7), piso/teto de ocorrências: **a spec previa um piso `criado_em` e teto por rodada; o desenho final não precisa deles** — a regra é por estado atual das pendências e uma OP gera uma ocorrência só; o primeiro ciclo avisará de tudo que já estiver parado, o que é o comportamento desejado (alertar o que está parado agora). Se o usuário quiser o piso, entra como uma condição no ramo do SQL.
- **Placeholders:** os passos de T4 e T6 descrevem comportamento e testes exigidos, com as fronteiras de arquivo e o padrão a copiar; o código nasce da leitura dos arquivos citados.
- **Consistência de nomes:** `limite_horas`/`limiteHoras`, `p_parados`, `paradosPorOp`, `paradosParaBanco`, `chaveDaOp`, `sf_almox_pendencias_base`, `em_mais_antiga`, `textoAlertaParado` aparecem iguais em todas as tarefas.
