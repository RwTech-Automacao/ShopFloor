# Alerta por horário — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development para
> executar tarefa por tarefa. Os passos usam caixa (`- [ ]`).

**Objetivo:** uma janela nova (`intervalos`) na regra de taxa de aprovação dos Alertas: o gestor
cadastra os intervalos do turno e o passo, e o sistema mede bloco a bloco, avisando no fechamento
de cada bloco.

**Arquitetura:** a aritmética dos blocos (ladrilhamento, fuso, sobra, "só hoje") fica **toda no
domínio TypeScript**, com teste. O SQL só conta bipes entre dois instantes que **recebe prontos**,
seguindo o padrão que a `alerta_avaliar` já usa com `p_canal_discord` (*"o id do canal mora no
SERVIDOR, não no banco"*, `repositorio-servico.ts:80`). O resto da máquina de alertas — abrir,
insistir, normalizar, fila, botão, Telegram, Discord — não muda.

**Spec:** `docs/superpowers/specs/2026-10-06-alerta-por-horario-design.md` (leia antes de começar).

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Vitest, Tailwind v4, Postgres/Supabase.

## Restrições globais

- **Tudo em PT-BR**: identificadores, comentários, mensagens de erro, textos de tela.
- **`--maxWorkers=2` é obrigatório** no vitest desta máquina (4 núcleos; sem isso o processo morre
  com exit 137). Comando padrão:
  `npx vitest run src/modules/alertas "src/app/(app)/configuracoes/sf-alertas" --maxWorkers=2`
- **`next build` NÃO roda nesta worktree** (Turbopack recusa `node_modules` symlinkado). Não tente
  consertar; `npx tsc --noEmit` e o eslint da pasta são a verificação.
- **Fuso fixo `America/Sao_Paulo`**, nunca o do processo — o servidor roda em UTC. O mesmo motivo
  que `domain/mensagens.ts:12` já documenta.
- **`'use server'` só exporta funções async.** Exportar um tipo de um arquivo `'use server'`
  **quebra o `next build` em silêncio** (nem tsc nem eslint avisam). Tipos novos vão para
  `domain/`.
- **Migração idempotente**, corpo de função delimitado por `$func$` (o SQL Editor recusa `$$`,
  **inclusive dentro de comentário**), e `notify pgrst, 'reload schema';` no fim.
- **`tem_permissao` sempre com 2 argumentos** (`modulo, acao`). A forma de 1 argumento checa
  permissão GLOBAL e anula o RBAC por módulo.
- **`git add` com caminhos explícitos** — nunca `git add -A` nem `git add .`.
- Mensagem de commit termina com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Não existe teste de SQL neste projeto.** Nenhum. Por isso nada de aritmética nova em SQL: o que
  não tem teste tem que ser mecânico o bastante para ser conferido por leitura.

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `src/modules/alertas/domain/intervalos.ts` (**criar**) | `Intervalo`, `Bloco`, `lerHhMm`, `formatarHhMm`, `validarIntervalos`, `blocoCandidato`, `sobraDoIntervalo` |
| `src/modules/alertas/domain/tipos.ts` | `JanelaTipo` ganha `'intervalos'`; `ehJanelaTipo` |
| `src/modules/alertas/domain/janela.ts` | `Janela` ganha `blocoInicio`/`blocoFim`; `textoJanela` e `resumoJanela` ganham o caso |
| `src/modules/alertas/domain/regra.ts` | `EntradaRegra`/`RegraValida`/`PreviaValida` ganham `intervalos`; validação |
| `src/modules/alertas/infra/regras-repository.ts` | lê e grava os intervalos (tabela filha) |
| `src/modules/alertas/infra/repositorio-servico.ts` | calcula os blocos e passa `p_blocos` |
| `supabase/migrations/0139_alertas_intervalos.sql` (**criar**) | tabela filha, `bloco_reportado`, ramo em `alerta_taxas`, decisão em `alerta_avaliar` |
| `src/app/(app)/configuracoes/sf-alertas/intervalos-editor.tsx` (**criar**) | a lista de horários início/fim |
| `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx` | rádio da janela, passo, aviso da sobra |

---

### Task 1: Domínio — intervalos e sua validação

**Arquivos:**
- Criar: `src/modules/alertas/domain/intervalos.ts`
- Testar: `src/modules/alertas/domain/__tests__/intervalos.test.ts`

**Interfaces produzidas** (as tarefas seguintes dependem destes nomes exatos):

```ts
export interface Intervalo { inicio: string; fim: string } // 'HH:MM', hora local da fábrica
export interface Bloco { inicio: Date; fim: Date }
export const PASSO_MIN_MINUTOS = 15
export const INTERVALO_MIN_MINUTOS = 15
export function lerHhMm(texto: unknown): number | null
export function formatarHhMm(minutosDoDia: number): string
export function validarIntervalos(
  lista: unknown,
  passoMin: number | null,
): { ok: true; valor: Intervalo[] } | { ok: false; erro: string }
```

- [ ] **Passo 1: escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { formatarHhMm, lerHhMm, validarIntervalos } from '../intervalos'

describe('lerHhMm', () => {
  it('lê hora do dia em minutos', () => {
    expect(lerHhMm('07:00')).toBe(420)
    expect(lerHhMm('13:30')).toBe(810)
    expect(lerHhMm('00:00')).toBe(0)
    expect(lerHhMm('23:59')).toBe(1439)
  })
  it('recusa o que não é hora do dia', () => {
    for (const ruim of ['', '7:00', '07:0', '24:00', '07:60', 'ab:cd', '07-00', null, 7, undefined]) {
      expect(lerHhMm(ruim)).toBeNull()
    }
  })
})

describe('formatarHhMm', () => {
  it('devolve sempre com 2 dígitos', () => {
    expect(formatarHhMm(420)).toBe('07:00')
    expect(formatarHhMm(810)).toBe('13:30')
    expect(formatarHhMm(0)).toBe('00:00')
  })
})

describe('validarIntervalos', () => {
  const bons = [{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }]

  it('aceita os dois turnos do exemplo', () => {
    const r = validarIntervalos(bons, 60)
    expect(r).toEqual({ ok: true, valor: bons })
  })

  it('recusa lista vazia', () => {
    expect(validarIntervalos([], 60)).toEqual({ ok: false, erro: 'Cadastre pelo menos 1 intervalo de horário.' })
  })

  it('recusa o que não é lista', () => {
    expect(validarIntervalos(null, 60).ok).toBe(false)
    expect(validarIntervalos('07:00', 60).ok).toBe(false)
  })

  it('recusa turno que passa da meia-noite', () => {
    expect(validarIntervalos([{ inicio: '22:00', fim: '06:00' }], 60)).toEqual({
      ok: false,
      erro: 'O horário final precisa ser maior que o inicial. Turno que passa da meia-noite não é suportado.',
    })
  })

  it('recusa fim igual ao início', () => {
    expect(validarIntervalos([{ inicio: '07:00', fim: '07:00' }], 60).ok).toBe(false)
  })

  it('recusa intervalo mais curto que 15 minutos', () => {
    expect(validarIntervalos([{ inicio: '07:00', fim: '07:10' }], 15)).toEqual({
      ok: false,
      erro: 'Cada intervalo precisa ter no mínimo 15 minutos.',
    })
  })

  it('recusa sobreposição', () => {
    expect(
      validarIntervalos([{ inicio: '07:00', fim: '12:00' }, { inicio: '11:00', fim: '15:00' }], 60),
    ).toEqual({ ok: false, erro: 'Os intervalos 07:00–12:00 e 11:00–15:00 se sobrepõem.' })
  })

  it('aceita intervalos que apenas se tocam', () => {
    expect(validarIntervalos([{ inicio: '07:00', fim: '12:00' }, { inicio: '12:00', fim: '17:00' }], 60).ok).toBe(true)
  })

  it('acha a sobreposição mesmo fora de ordem', () => {
    expect(validarIntervalos([{ inicio: '13:00', fim: '17:00' }, { inicio: '07:00', fim: '14:00' }], 60).ok).toBe(false)
  })

  it('recusa passo abaixo de 15 minutos', () => {
    expect(validarIntervalos(bons, 10)).toEqual({
      ok: false,
      erro: 'O passo precisa ter no mínimo 15 minutos.',
    })
  })

  it('recusa passo maior que o menor intervalo', () => {
    // menor intervalo = 13:30–17:30 = 240 min
    expect(validarIntervalos(bons, 300)).toEqual({
      ok: false,
      erro: 'O passo (5 h) não cabe no menor intervalo cadastrado (13:30–17:30, 4 h).',
    })
  })

  it('aceita passo igual ao menor intervalo', () => {
    expect(validarIntervalos(bons, 240).ok).toBe(true)
  })

  it('sem passo informado, só confere os intervalos', () => {
    expect(validarIntervalos(bons, null).ok).toBe(true)
    expect(validarIntervalos([{ inicio: '22:00', fim: '06:00' }], null).ok).toBe(false)
  })

  it('devolve os intervalos ORDENADOS pelo início', () => {
    const r = validarIntervalos([{ inicio: '13:30', fim: '17:30' }, { inicio: '07:00', fim: '12:00' }], 60)
    expect(r.ok && r.valor).toEqual([{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }])
  })

  it('apara espaço e ignora duplicata exata', () => {
    const r = validarIntervalos([{ inicio: ' 07:00 ', fim: '12:00' }, { inicio: '07:00', fim: '12:00' }], 60)
    expect(r.ok && r.valor).toEqual([{ inicio: '07:00', fim: '12:00' }])
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run src/modules/alertas/domain/__tests__/intervalos.test.ts --maxWorkers=2`
Esperado: FAIL, "Failed to resolve import ... ../intervalos".

- [ ] **Passo 3: implementar**

Escreva `intervalos.ts` com o contrato acima. Pontos obrigatórios:

- `lerHhMm` aceita **exatamente** `HH:MM` com 2 dígitos em cada lado (`/^([01]\d|2[0-3]):([0-5]\d)$/`),
  e nada mais. Entrada que não é string → `null`.
- `validarIntervalos` apara, descarta duplicata exata, **ordena pelo início** e confere nesta ordem:
  lista é array → não vazia → cada `HH:MM` válido → `fim > inicio` → cada um ≥ 15 min →
  sem sobreposição (depois de ordenar, `inicio[i] >= fim[i-1]`) → passo ≥ 15 →
  passo ≤ menor intervalo.
- A mensagem da sobreposição nomeia os **dois** intervalos, no formato `07:00–12:00` (travessão
  `–`, U+2013, igual ao teste).
- A mensagem do passo usa `formatarDuracao`-style humano (`5 h`, `4 h`, `90 min`): reaproveite
  `formatarDuracao` de `domain/mensagens.ts` passando milissegundos, para não haver duas réguas de
  duração no módulo.
- `formatarHhMm` usa `padStart(2, '0')` nas duas partes.

- [ ] **Passo 4: rodar e ver passar**

`npx vitest run src/modules/alertas/domain/__tests__/intervalos.test.ts --maxWorkers=2` → PASS.
Depois `npx tsc --noEmit` → sem erro.

- [ ] **Passo 5: commit**

```bash
git add src/modules/alertas/domain/intervalos.ts src/modules/alertas/domain/__tests__/intervalos.test.ts
git commit -m "alertas: intervalos de turno e sua validação"
```

---

### Task 2: Domínio — qual bloco fechou por último

A tarefa mais delicada do plano: é aqui que mora o fuso, o ladrilhamento, a sobra e o "só hoje".

**Arquivos:**
- Modificar: `src/modules/alertas/domain/intervalos.ts`
- Testar: `src/modules/alertas/domain/__tests__/bloco-candidato.test.ts`

**Interfaces consumidas:** `Intervalo`, `Bloco` (Task 1).

**Interfaces produzidas:**

```ts
/** O bloco mais recente que FECHOU HOJE (em São Paulo), ou null se nenhum fechou ainda. */
export function blocoCandidato(intervalos: Intervalo[], passoMin: number, agora: Date): Bloco | null
/** A sobra do intervalo: o último bloco, quando o passo não fecha redondo. Null quando fecha. */
export function sobraDoIntervalo(intervalo: Intervalo, passoMin: number): Intervalo | null
```

**O que é "o bloco mais recente que fechou hoje":**

Os blocos ladrilham **a partir do início de cada intervalo**: com 13:30–17:30 e passo de 60, os
blocos são 13:30–14:30, 14:30–15:30, 15:30–16:30, 16:30–17:30. Quando o passo não fecha redondo, o
**último bloco do intervalo é mais curto** e termina no fim do intervalo (a sobra). Um bloco "fechou"
quando `fim <= agora`. Entre todos os blocos de todos os intervalos **do dia de hoje em São Paulo**,
devolve o de maior `fim`. Se nenhum fechou (ex.: 06:10, antes do primeiro), devolve `null`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { blocoCandidato, sobraDoIntervalo, type Intervalo } from '../intervalos'

/** Um instante a partir da hora de PAREDE de São Paulo (que é UTC-3, sem horário de verão). */
function sp(dia: string, hhmm: string): Date {
  return new Date(`${dia}T${hhmm}:00-03:00`)
}
/** 'AAAA-MM-DD HH:MM' do bloco, em São Paulo, para o teste não depender do fuso do processo. */
function emSp(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
}
function faixa(b: { inicio: Date; fim: Date } | null): string | null {
  return b === null ? null : `${emSp(b.inicio)} → ${emSp(b.fim)}`
}

const MANHA: Intervalo = { inicio: '07:00', fim: '12:00' }
const TARDE: Intervalo = { inicio: '13:30', fim: '17:30' }
const DOIS = [MANHA, TARDE]

describe('blocoCandidato', () => {
  it('às 09:30 o último fechado é 08:00–09:00', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '09:30')))).toBe(
      '2026-10-06 08:00 → 2026-10-06 09:00',
    )
  })

  it('às 07:30 nenhum bloco fechou ainda', () => {
    expect(blocoCandidato(DOIS, 60, sp('2026-10-06', '07:30'))).toBeNull()
  })

  it('às 08:00 em ponto o bloco das 07:00–08:00 JÁ fechou', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '08:00')))).toBe(
      '2026-10-06 07:00 → 2026-10-06 08:00',
    )
  })

  it('no almoço, o último fechado é o fim da manhã', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '13:00')))).toBe(
      '2026-10-06 11:00 → 2026-10-06 12:00',
    )
  })

  it('à tarde ladrilha do 13:30, não do relógio cheio', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '14:40')))).toBe(
      '2026-10-06 13:30 → 2026-10-06 14:30',
    )
  })

  it('depois do turno, o último fechado é o último do dia', () => {
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '18:20')))).toBe(
      '2026-10-06 16:30 → 2026-10-06 17:30',
    )
  })

  it('às 06:10 de segunda NÃO devolve o bloco de sexta', () => {
    // 2026-10-05 é segunda-feira
    expect(blocoCandidato(DOIS, 60, sp('2026-10-05', '06:10'))).toBeNull()
  })

  it('a sobra é medida com a faixa real', () => {
    // 13:30–17:30 com passo de 3 h: bloco cheio 13:30–16:30 e sobra 16:30–17:30
    expect(faixa(blocoCandidato([TARDE], 180, sp('2026-10-06', '17:35')))).toBe(
      '2026-10-06 16:30 → 2026-10-06 17:30',
    )
    // às 17:00 a sobra ainda não fechou; o último fechado é o bloco cheio
    expect(faixa(blocoCandidato([TARDE], 180, sp('2026-10-06', '17:00')))).toBe(
      '2026-10-06 13:30 → 2026-10-06 16:30',
    )
  })

  it('passo igual ao intervalo dá um bloco só', () => {
    expect(faixa(blocoCandidato([TARDE], 240, sp('2026-10-06', '17:35')))).toBe(
      '2026-10-06 13:30 → 2026-10-06 17:30',
    )
  })

  it('sem intervalo nenhum devolve null', () => {
    expect(blocoCandidato([], 60, sp('2026-10-06', '09:30'))).toBeNull()
  })

  it('atravessa a meia-noite em UTC sem errar o dia da fábrica', () => {
    // 21:30 em São Paulo é 00:30 do dia seguinte em UTC. O bloco tem que ser do dia 06, não do 07.
    expect(faixa(blocoCandidato(DOIS, 60, sp('2026-10-06', '21:30')))).toBe(
      '2026-10-06 16:30 → 2026-10-06 17:30',
    )
  })

  it('às 02:00 da manhã nenhum bloco do dia fechou', () => {
    expect(blocoCandidato(DOIS, 60, sp('2026-10-06', '02:00'))).toBeNull()
  })
})

describe('sobraDoIntervalo', () => {
  it('devolve a sobra quando o passo não fecha', () => {
    expect(sobraDoIntervalo(TARDE, 180)).toEqual({ inicio: '16:30', fim: '17:30' })
    expect(sobraDoIntervalo(MANHA, 90)).toEqual({ inicio: '11:30', fim: '12:00' })
  })
  it('devolve null quando o passo fecha redondo', () => {
    expect(sobraDoIntervalo(MANHA, 60)).toBeNull()
    expect(sobraDoIntervalo(TARDE, 240)).toBeNull()
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run src/modules/alertas/domain/__tests__/bloco-candidato.test.ts --maxWorkers=2`
Esperado: FAIL, `blocoCandidato is not a function`.

⚠️ **Rode também com `TZ=UTC`**, que é o fuso do servidor:
`TZ=UTC npx vitest run src/modules/alertas/domain/__tests__/bloco-candidato.test.ts --maxWorkers=2`
Os dois têm que dar o MESMO resultado. Se passar em um e falhar no outro, a implementação está
usando o fuso do processo em algum lugar.

- [ ] **Passo 3: implementar**

Acrescente a `intervalos.ts`:

```ts
const FUSO = 'America/Sao_Paulo'

/** Partes da data no fuso da fábrica, não no do processo. */
function partesSp(d: Date): { ano: number; mes: number; dia: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d)
  const achar = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
  return { ano: achar('year'), mes: achar('month'), dia: achar('day') }
}

/** Deslocamento do fuso da fábrica, em minutos, NAQUELE instante. */
function deslocamentoMin(d: Date): number {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d)
  const achar = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
  const comoUtc = Date.UTC(achar('year'), achar('month') - 1, achar('day'),
                           achar('hour') % 24, achar('minute'), achar('second'))
  return (comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000
}

/**
 * O instante de uma hora de PAREDE da fábrica. Duas passadas: o deslocamento do palpite pode
 * diferir do deslocamento do instante correto numa fronteira de horário de verão. O Brasil não
 * tem horário de verão desde 2019, mas a conta não custa nada e não depende disso continuar.
 */
function instanteSp(ano: number, mes: number, dia: number, minutosDoDia: number): Date {
  const palpite = Date.UTC(ano, mes - 1, dia) + minutosDoDia * 60_000
  const d1 = deslocamentoMin(new Date(palpite))
  const corrigido = palpite - d1 * 60_000
  const d2 = deslocamentoMin(new Date(corrigido))
  return new Date(d2 === d1 ? corrigido : palpite - d2 * 60_000)
}
```

E então `blocoCandidato`:

1. `const hoje = partesSp(agora)`.
2. Para cada intervalo (já validado), com `i = lerHhMm(inicio)` e `f = lerHhMm(fim)`:
   ladrilhe de `i` até `f` em passos de `passoMin`; o último bloco termina em `f` (`Math.min`).
3. Converta as fronteiras com `instanteSp(hoje.ano, hoje.mes, hoje.dia, …)`.
4. Fique com o bloco de maior `fim` entre os que têm `fim.getTime() <= agora.getTime()`.
5. Nenhum → `null`.

`sobraDoIntervalo`: `resto = (f - i) % passoMin`; `resto === 0` → `null`; senão
`{ inicio: formatarHhMm(f - resto), fim: formatarHhMm(f) }`.

⚠️ Não use `agora.getDate()`, `getHours()` nem `new Date(ano, mes, dia)`: todos usam o fuso do
processo, que no servidor é UTC. Só `partesSp`/`instanteSp`.

- [ ] **Passo 4: rodar e ver passar (nos dois fusos)**

```bash
npx vitest run src/modules/alertas/domain/__tests__/bloco-candidato.test.ts --maxWorkers=2
TZ=UTC npx vitest run src/modules/alertas/domain/__tests__/bloco-candidato.test.ts --maxWorkers=2
```
Os dois: PASS. Depois `npx tsc --noEmit`.

- [ ] **Passo 5: commit**

```bash
git add src/modules/alertas/domain/intervalos.ts src/modules/alertas/domain/__tests__/bloco-candidato.test.ts
git commit -m "alertas: qual bloco do turno fechou por último"
```

---

### Task 3: Domínio — a janela `intervalos` nos tipos e nos textos

**Arquivos:**
- Modificar: `src/modules/alertas/domain/tipos.ts` (`JanelaTipo`, `ehJanelaTipo`)
- Modificar: `src/modules/alertas/domain/janela.ts` (`Janela`, `textoJanela`, `resumoJanela`)
- Testar: `src/modules/alertas/domain/__tests__/janela-intervalos.test.ts`

**Interfaces produzidas:**

```ts
export type JanelaTipo = 'tempo' | 'bipes' | 'op' | 'intervalos'
export interface Janela { /* … campos atuais … */ blocoInicio?: string | null; blocoFim?: string | null }
```

`blocoInicio`/`blocoFim` são ISO (o que o jsonb de `alerta_envios.dados` carrega).

- [ ] **Passo 1: escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { ehJanelaTipo } from '../tipos'
import { resumoJanela, textoJanela } from '../janela'

describe('ehJanelaTipo', () => {
  it('conhece intervalos', () => {
    expect(ehJanelaTipo('intervalos')).toBe(true)
  })
  it('continua recusando o que não é janela', () => {
    expect(ehJanelaTipo('turno')).toBe(false)
    expect(ehJanelaTipo('')).toBe(false)
  })
})

describe('textoJanela com intervalos', () => {
  it('diz a faixa do bloco', () => {
    expect(textoJanela({
      tipo: 'intervalos', valor: 60,
      blocoInicio: '2026-10-06T10:00:00-03:00',
      blocoFim: '2026-10-06T11:00:00-03:00',
    })).toBe('das 10:00 às 11:00')
  })
  it('diz a faixa da sobra, que é mais curta', () => {
    expect(textoJanela({
      tipo: 'intervalos', valor: 180,
      blocoInicio: '2026-10-06T16:30:00-03:00',
      blocoFim: '2026-10-06T17:30:00-03:00',
    })).toBe('das 16:30 às 17:30')
  })
  it('sem a faixa, não inventa número', () => {
    expect(textoJanela({ tipo: 'intervalos', valor: 60 })).toBe('no bloco do turno')
  })
})

describe('resumoJanela com intervalos', () => {
  it('mostra o passo na coluna da tabela', () => {
    expect(resumoJanela({ tipo: 'intervalos', valor: 60 })).toBe('Blocos de 1 h')
    expect(resumoJanela({ tipo: 'intervalos', valor: 90 })).toBe('Blocos de 1 h 30 min')
    expect(resumoJanela({ tipo: 'intervalos', valor: 30 })).toBe('Blocos de 30 min')
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**

`npx vitest run src/modules/alertas/domain/__tests__/janela-intervalos.test.ts --maxWorkers=2`

- [ ] **Passo 3: implementar**

- `tipos.ts`: acrescente `'intervalos'` ao union e ao `ehJanelaTipo`. **Não** mexa em `TipoRegra`.
- `janela.ts`: campos opcionais `blocoInicio`/`blocoFim`; caso novo em `textoJanela` usando
  `formatarHora` de `domain/mensagens.ts` (que já fixa o fuso); caso novo em `resumoJanela` usando
  `formatarDuracao` (passando `valor * 60_000`).
- ⚠️ `textoJanela` é um `switch` com retorno em todos os casos: acrescentar membro ao union **sem**
  tratar o caso novo quebra o `tsc`. É de propósito — serve de alarme.

- [ ] **Passo 4: rodar e ver passar**

O arquivo novo PASS, e **toda a suíte do módulo** sem regressão:
`npx vitest run src/modules/alertas --maxWorkers=2`. Depois `npx tsc --noEmit`.

⚠️ Se o `tsc` apontar outros `switch` sobre `JanelaTipo` fora de `janela.ts`, trate cada um — e
anote no relatório quais eram.

- [ ] **Passo 5: commit**

```bash
git add src/modules/alertas/domain/tipos.ts src/modules/alertas/domain/janela.ts src/modules/alertas/domain/__tests__/janela-intervalos.test.ts
git commit -m "alertas: a janela intervalos nos tipos e nos textos"
```

---

### Task 4: Domínio — `validarRegra` aceita a janela `intervalos`

**Arquivos:**
- Modificar: `src/modules/alertas/domain/regra.ts`
- Testar: `src/modules/alertas/domain/__tests__/regra-intervalos.test.ts`

**Interfaces consumidas:** `validarIntervalos`, `Intervalo` (Task 1); `JanelaTipo` (Task 3).

**Interfaces produzidas:** `EntradaRegra`, `EntradaPrevia` ganham `intervalos?: unknown`;
`RegraValida`, `PreviaValida` ganham `intervalos: Intervalo[]` (vazio fora da janela `intervalos`).

**Regras de validação a acrescentar** (leia `validarRegra` por inteiro antes — ela já tem uma ordem
de conferência e mensagens num padrão; siga o padrão):

1. Janela `intervalos` **só** no tipo `aprovacao`. Nos outros:
   `'Só a taxa de aprovação usa a janela por blocos de turno.'`
2. Com janela `intervalos`, `janelaValor` é o **passo em minutos**: obrigatório, inteiro, > 0 — as
   faixas (≥ 15, ≤ menor intervalo) são conferidas por `validarIntervalos`, que recebe o passo.
3. `validarIntervalos(e.intervalos, janelaValor)`; erro dela sobe como erro da regra.
4. Fora da janela `intervalos`, `intervalos` sai `[]` e `e.intervalos` é ignorado.
5. `lembreteMin` é **ignorado** na janela `intervalos` (sai `null`): quem comanda a insistência é o
   bloco. Não é erro mandar — é silenciosamente zerado, e o formulário esconde o campo.
6. O check `janelaValor < minimoBipes` de `aprovacao`/`bipes` **não** se aplica aqui.

- [ ] **Passo 1: escrever os testes que falham**

```ts
import { describe, expect, it } from 'vitest'
import { validarRegra, type EntradaRegra } from '../regra'

const BASE: EntradaRegra = {
  tipo: 'aprovacao',
  nome: 'Inspeção por bloco',
  postos: ['Inspeção PTH'],
  taxaMinima: '95',
  janelaTipo: 'intervalos',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  intervalos: [{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }],
  ativa: true,
}

describe('validarRegra com a janela intervalos', () => {
  it('aceita e devolve os intervalos ordenados', () => {
    const r = validarRegra(BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.janelaTipo).toBe('intervalos')
    expect(r.valor.janelaValor).toBe(60)
    expect(r.valor.intervalos).toEqual([
      { inicio: '07:00', fim: '12:00' },
      { inicio: '13:30', fim: '17:30' },
    ])
  })

  it('ZERA o lembrete: quem manda é o bloco', () => {
    const r = validarRegra({ ...BASE, lembreteMin: '30' })
    expect(r.ok && r.valor.lembreteMin).toBeNull()
  })

  it('recusa a janela de blocos no tipo tempo', () => {
    const r = validarRegra({ ...BASE, tipo: 'tempo', limiteTempo: '2:00' })
    expect(r).toEqual({ ok: false, erro: 'Só a taxa de aprovação usa a janela por blocos de turno.' })
  })

  it('recusa a janela de blocos no tipo defeito', () => {
    expect(validarRegra({ ...BASE, tipo: 'defeito', limiteOcorrencias: '5' }).ok).toBe(false)
  })

  it('recusa sem intervalo nenhum', () => {
    expect(validarRegra({ ...BASE, intervalos: [] })).toEqual({
      ok: false,
      erro: 'Cadastre pelo menos 1 intervalo de horário.',
    })
  })

  it('sobe o erro de validarIntervalos (meia-noite)', () => {
    const r = validarRegra({ ...BASE, intervalos: [{ inicio: '22:00', fim: '06:00' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro).toContain('meia-noite')
  })

  it('sobe o erro do passo pequeno', () => {
    const r = validarRegra({ ...BASE, janelaValor: '10' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro).toContain('no mínimo 15 minutos')
  })

  it('recusa passo vazio', () => {
    expect(validarRegra({ ...BASE, janelaValor: null }).ok).toBe(false)
  })

  it('NÃO aplica o check de janela de bipes < mínimo de bipes', () => {
    // passo 15 min e mínimo de 20 bipes: válido aqui (são grandezas diferentes)
    expect(validarRegra({ ...BASE, janelaValor: '15', minimoBipes: '20' }).ok).toBe(true)
  })

  it('nas outras janelas, intervalos sai vazio e a entrada é ignorada', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'tempo', janelaValor: '60' })
    expect(r.ok && r.valor.intervalos).toEqual([])
  })
})
```

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar** conforme as 6 regras acima
- [ ] **Passo 4: rodar `npx vitest run src/modules/alertas --maxWorkers=2` (tudo verde) + `tsc`**
- [ ] **Passo 5: commit**

```bash
git add src/modules/alertas/domain/regra.ts src/modules/alertas/domain/__tests__/regra-intervalos.test.ts
git commit -m "alertas: validação da regra com janela por blocos de turno"
```

---

### Task 5: Migração — esquema

**Arquivos:**
- Criar: `supabase/migrations/0139_alertas_intervalos.sql`

⚠️ **Não existe teste de SQL neste projeto.** A conferência é leitura + revisão + smoke no Dev. Por
isso: nada de aritmética aqui, e **nenhuma** instrução que não seja idempotente.

Leia `supabase/migrations/0113_alertas.sql` (a fundação) e `0115_alertas_tipos.sql` (que é o
exemplo de como o projeto acrescenta campo de tipo novo) antes de escrever.

- [ ] **Passo 1: escrever a parte de esquema**

```sql
-- 0139: janela por blocos de turno na regra de taxa de aprovação.
-- O gestor cadastra os intervalos do turno e o passo; o APP calcula qual bloco fechou e manda os
-- instantes prontos (ver docs/superpowers/specs/2026-10-06-alerta-por-horario-design.md).

-- ---------- janela_tipo aceita 'intervalos' ----------
alter table public.alerta_regras drop constraint if exists alerta_regras_janela_tipo_check;
alter table public.alerta_regras
  add constraint alerta_regras_janela_tipo_check
  check (janela_tipo in ('tempo', 'bipes', 'op', 'intervalos'));

-- A janela por blocos é só da taxa de aprovação, e o janela_valor guarda o PASSO em minutos.
alter table public.alerta_regras drop constraint if exists alerta_regras_intervalos_check;
alter table public.alerta_regras
  add constraint alerta_regras_intervalos_check
  check (janela_tipo <> 'intervalos' or (tipo = 'aprovacao' and janela_valor >= 15));

-- ---------- os intervalos do turno ----------
create table if not exists public.alerta_regra_intervalos (
  id       uuid primary key default gen_random_uuid(),
  regra_id uuid not null references public.alerta_regras(id) on delete cascade,
  inicio   time not null,
  fim      time not null,
  constraint alerta_regra_intervalos_ordem check (fim > inicio),
  -- 15 minutos é o passo mínimo; intervalo menor que isso deixaria o passo sem valor válido.
  constraint alerta_regra_intervalos_minimo check (fim - inicio >= interval '15 minutes')
);

create index if not exists alerta_regra_intervalos_regra_idx
  on public.alerta_regra_intervalos (regra_id, inicio);

-- ---------- o bloco já avisado ----------
-- Quem comanda a insistência nesta janela: a mensagem sai quando o bloco avaliado é MAIS NOVO que
-- este. Null = nenhum bloco avisado ainda. Não usa lembrete_min.
alter table public.alerta_ocorrencias
  add column if not exists bloco_reportado timestamptz;
```

- [ ] **Passo 2: as regras de acesso, copiadas do padrão da tabela mãe**

Leia as policies de `alerta_regras` na 0113 e **repita o mesmo padrão** para
`alerta_regra_intervalos`, com `tem_permissao` de **2 argumentos**
(`tem_permissao('shopfloor', 'configurar')` ou o que a mãe usar — confira e use o mesmo).

⚠️ A 0113 usa `tem_permissao` de **1 argumento** em alguns lugares (69 ocorrências em 56 arquivos,
marcado pela revisão de 21/09 como padrão a corrigir). **Não copie esse erro:** aqui use 2
argumentos. Se a policy da mãe usar 1, use 2 na filha e **anote no relatório** que ficou diferente
da mãe de propósito.

- [ ] **Passo 3: conferir que é idempotente**

Leia o arquivo inteiro e confirme: todo `create` tem `if not exists`, todo `add constraint` tem o
`drop constraint if exists` antes, `add column` tem `if not exists`. Rodar duas vezes não pode dar
erro.

- [ ] **Passo 4: commit**

```bash
git add supabase/migrations/0139_alertas_intervalos.sql
git commit -m "alertas: esquema da janela por blocos de turno (0139)"
```

---

### Task 6: Migração — `alerta_taxas` e `alerta_avaliar`

**Arquivos:**
- Modificar: `supabase/migrations/0139_alertas_intervalos.sql`

**O contrato novo da RPC:**

```
alerta_avaliar(p_canal_discord text, p_blocos jsonb default null)
```

`p_blocos` é `{"<regra_id>": {"inicio": "<iso>", "fim": "<iso>"}}` — **só** as regras de janela
`intervalos` que têm bloco fechado agora. Regra de janela `intervalos` **ausente** do mapa é
**pulada** nesta rodada (nenhum bloco fechou, ou o app não a viu). É o mesmo padrão do
`p_canal_discord`: o valor vem do servidor, pronto.

- [ ] **Passo 1: ramo `intervalos` em `alerta_taxas`**

A função ganha dois parâmetros e um ramo no `union all`:

```sql
create or replace function public.alerta_taxas(
  p_postos text[], p_janela_tipo text, p_janela_valor int,
  p_bloco_inicio timestamptz default null, p_bloco_fim timestamptz default null
)
```

O ramo conta os bipes com status entre os dois instantes — **recebidos prontos, sem nenhuma conta
de horário aqui**:

```sql
          union all
          -- janela 'intervalos': os bipes do posto dentro do bloco que o APP calculou. Nenhuma
          -- aritmética de horário aqui de propósito: ela mora em domain/intervalos.ts, onde tem
          -- teste. Ver a decisão na spec.
          select r.status
            from sf_registros r
           where p_janela_tipo = 'intervalos'
             and r.posto = p.posto
             and r.data_hora >= p_bloco_inicio
             and r.data_hora <  p_bloco_fim
             and lower(r.status) in ('aprovado', 'reprovado')
```

⚠️ `>=` no início e `<` no fim: o bipe das 08:00:00 é do bloco 08:00–09:00, **não** do 07:00–08:00.
Sem isso, um bipe na fronteira entra nos dois blocos.

⚠️ Mantenha a assinatura antiga funcionando (os `default null`), e **refaça os `revoke`** da função
— uma assinatura nova é outra função para o Postgres, e sem o `revoke` ela nasce executável por
`public`.

- [ ] **Passo 2: a decisão em `alerta_avaliar`**

No `for t in … loop`:

1. Traga `rg.janela_tipo` (já vem) e, para a janela `intervalos`, leia o bloco de `p_blocos` pela
   chave `rg.id::text`. Sem entrada → `continue` (pula a regra nesta rodada).
2. Passe `p_bloco_inicio`/`p_bloco_fim` para `alerta_taxas`.
3. O mínimo de bipes continua valendo igual (`v_total < t.minimo_bipes` → `continue`), e é ele que
   faz o bloco vazio não decidir nada.
4. **A insistência:** na janela `intervalos`, em vez de comparar `lembrete_min` com
   `ultimo_envio_em`, compare o bloco:

```sql
      if t.janela_tipo = 'intervalos' then
        -- Um aviso por BLOCO: o cron roda de 5 em 5 min e vai reavaliar o mesmo bloco fechado
        -- várias vezes; da segunda em diante não é mais novo e nada é enviado.
        v_lembrete := o.estado = 'aberta'
                      and (o.bloco_reportado is null or v_bloco_inicio > o.bloco_reportado);
      else
        v_lembrete := o.estado = 'aberta' and t.lembrete_min is not null
                      and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min);
      end if;
```

5. Grave `bloco_reportado = v_bloco_inicio` **nos três caminhos que enviam** (abertura, lembrete e
   normalização) quando a janela é `intervalos`, e **só** quando envia. Bloco pulado por falta de
   bipes não pode mexer nele — é isso que deixa o bloco seguinte ainda avisar.
6. Acrescente `'bloco_inicio'` e `'bloco_fim'` ao `jsonb_build_object` dos `dados`, para o
   `textoJanela` da Task 3 ter a faixa.

- [ ] **Passo 3: grants e cache do PostgREST**

```sql
revoke all on function public.alerta_avaliar(text, jsonb) from public, anon, authenticated;
grant execute on function public.alerta_avaliar(text, jsonb) to service_role;
-- A assinatura ANTIGA sai de cena para não ficarem duas versões respondendo.
drop function if exists public.alerta_avaliar(text);

notify pgrst, 'reload schema';
```

⚠️ `drop function` da assinatura antiga **depois** de criar a nova, e confira se mais alguém a
chama (`grep -rn "alerta_avaliar" src supabase`).

- [ ] **Passo 4: conferência por leitura**

Releia o arquivo inteiro e responda no relatório, **citando a linha**:
(a) todo caminho que envia grava `bloco_reportado`? (b) algum caminho que **não** envia grava?
(c) a fronteira do bloco é `>=`/`<`? (d) regra de janela `intervalos` sem bloco é pulada?
(e) as outras três janelas passam pelo mesmo caminho de antes, sem mudança de comportamento?

- [ ] **Passo 5: commit**

```bash
git add supabase/migrations/0139_alertas_intervalos.sql
git commit -m "alertas: alerta_taxas e alerta_avaliar na janela por blocos (0139)"
```

---

### Task 7: Infra — gravar os intervalos e calcular os blocos

**Arquivos:**
- Modificar: `src/modules/alertas/infra/regras-repository.ts`
- Modificar: `src/modules/alertas/infra/repositorio-servico.ts`
- Testar: `src/modules/alertas/infra/__tests__/intervalos-repo.test.ts`

**Interfaces consumidas:** `RegraValida.intervalos` (Task 4), `blocoCandidato` (Task 2).

- [ ] **Passo 1: escrever os testes que falham**

Dois comportamentos, com os **argumentos** afirmados (não só o efeito):

1. **`avaliar()` monta `p_blocos`:** com duas regras de janela `intervalos` — uma com bloco fechado
   e outra cujo turno ainda não fechou nenhum — a RPC `alerta_avaliar` é chamada com
   `p_blocos` contendo **só a primeira**, com `inicio`/`fim` ISO corretos, e `p_canal_discord`
   continua sendo passado. Regras de outras janelas **não** aparecem no mapa.
2. **`salvar` grava a tabela filha:** criar regra com 2 intervalos insere as 2 linhas com
   `regra_id` certo; **editar** uma regra apaga as antigas e insere as novas (não acumula);
   regra de outra janela não insere nada.

Use o mock do supabase no padrão dos testes de infra que já existem no módulo — leia
`src/modules/alertas/infra/__tests__/` antes e siga o mesmo jeito.

⚠️ Ao editar, a troca dos intervalos tem que ser **apagar + inserir**, não um `upsert` que deixa
sobra. Afirme explicitamente que o `delete` foi chamado com o `regra_id`.

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar**

- `regras-repository.ts`: `CAMPOS_REGRA` não muda (os intervalos vêm de outra tabela). Carregue os
  intervalos com uma segunda consulta por `regra_id in (…)` e junte na lista — **uma** consulta
  para todas as regras, não uma por regra.
- `repositorio-servico.ts`, no `avaliar()`: leia as regras ativas de janela `intervalos` com seus
  intervalos, chame `blocoCandidato(intervalos, janelaValor, new Date())` em cada uma, monte o mapa
  só com as que devolveram bloco, e passe como `p_blocos`. Mantenha `p_canal_discord`.
- Comente **por que** o cálculo está aqui e não no SQL (a spec e as restrições globais explicam:
  SQL não tem teste neste projeto).

- [ ] **Passo 4: rodar `npx vitest run src/modules/alertas --maxWorkers=2` + `tsc`**
- [ ] **Passo 5: commit**

```bash
git add src/modules/alertas/infra/regras-repository.ts src/modules/alertas/infra/repositorio-servico.ts src/modules/alertas/infra/__tests__/intervalos-repo.test.ts
git commit -m "alertas: gravar os intervalos e calcular os blocos no app"
```

---

### Task 8: Tela — o editor de intervalos no formulário da regra

**Arquivos:**
- Criar: `src/app/(app)/configuracoes/sf-alertas/intervalos-editor.tsx`
- Modificar: `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx`
- Testar: `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form-intervalos.test.tsx`

**Leia primeiro** `regra-form.tsx` por inteiro: ele já tem o grupo de rádios da Janela
(`janelaTipo === 'tempo' | 'bipes' | 'op'`, por volta das linhas 383–470), o mapa
`JANELAS: Record<TipoRegra, JanelaTipo[]>` (linha 30) que decide quais janelas cada tipo oferece, e
o componente `Explica` para o texto de ajuda. **Siga esses padrões**; não invente estilo novo.

**O que a tela ganha:**

1. Mais um rádio na Janela: **"Por blocos de turno"**, oferecido **só** no tipo `aprovacao`
   (`JANELAS.aprovacao` ganha `'intervalos'`).
2. Com ele marcado: o campo do **passo** (em minutos, padrão **60**) e o **editor de intervalos**.
3. O editor: uma linha por intervalo com dois `<input type="time">` (início e fim), um botão
   **Remover** por linha e um **Adicionar intervalo**. Começa com uma linha vazia; na edição, vem
   com os intervalos salvos.
4. **O aviso da sobra**, calculado com `sobraDoIntervalo` (Task 2), por intervalo que tiver sobra:

   > O passo não fecha com o intervalo: o último bloco de 13:30–17:30 vai de **16:30 às 17:30**
   > (1 h em vez de 3 h). Ele será medido e avisado com a faixa real.

   É **aviso**, não erro: a configuração é válida e o gestor pode querer isso. Use o mesmo estilo
   dos avisos que o formulário já mostra (`destinatariosSemCanal` é o exemplo).
5. O campo **lembrete** fica **escondido** nessa janela (ele é ignorado — ver Task 4, regra 5).

- [ ] **Passo 1: escrever os testes que falham**

Com Testing Library, no padrão de `__tests__/regra-form.test.tsx`:

- o rádio "Por blocos de turno" aparece no tipo `aprovacao` e **não** aparece em `tempo`/`defeito`;
- marcando o rádio, o passo e o editor aparecem, e o campo de lembrete **desaparece**;
- "Adicionar intervalo" acrescenta uma linha; "Remover" tira a certa (não a primeira sempre);
- com 07:00–12:00 e passo 90, o aviso da sobra aparece citando **11:30** e **12:00**;
- com 07:00–12:00 e passo 60, **nenhum** aviso aparece;
- salvar manda `janelaTipo: 'intervalos'`, `janelaValor: 60` e os `intervalos` preenchidos — afirme
  o **objeto inteiro** passado à action, não só que ela foi chamada;
- erro vindo da validação (ex.: meia-noite) aparece na tela.

- [ ] **Passo 2: rodar e ver falhar**
- [ ] **Passo 3: implementar**
- [ ] **Passo 4: rodar a suíte da pasta + a do módulo + `tsc` + eslint da pasta**

```bash
npx vitest run "src/app/(app)/configuracoes/sf-alertas" src/modules/alertas --maxWorkers=2
npx tsc --noEmit
npx eslint "src/app/(app)/configuracoes/sf-alertas" src/modules/alertas
```

- [ ] **Passo 5: commit**

```bash
git add "src/app/(app)/configuracoes/sf-alertas/intervalos-editor.tsx" "src/app/(app)/configuracoes/sf-alertas/regra-form.tsx" "src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form-intervalos.test.tsx"
git commit -m "alertas: editor de intervalos de turno no formulário da regra"
```

---

### Task 9: A lista de regras e a tela de ocorrências

**Arquivos:**
- Modificar: `src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx`
- Modificar: `src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx` (se mostrar a janela)
- Testar: os `__tests__` correspondentes que já existem

**Leia primeiro** as duas telas e os testes delas. A coluna "Janela" usa `resumoJanela`, que a
Task 3 já tratou — então pode ser que **nada precise mudar**. A tarefa é conferir e, se já
estiver certo, **dizer isso no relatório em vez de mexer**.

- [ ] **Passo 1: conferir**

Renderize a lista com uma regra de janela `intervalos` no teste e veja a coluna "Janela". Se sair
"Blocos de 1 h", está pronto.

- [ ] **Passo 2: se faltar algo, acrescentar o teste que falha, implementar e rodar**
- [ ] **Passo 3: rodar a suíte inteira do módulo e da pasta**
- [ ] **Passo 4: commit (ou relatar que não houve mudança)**

---

## Depois das tarefas

1. **Revisão de branch inteira** (modelo mais capaz disponível), com o pacote de revisão da branch.
2. **0139 no Dev** → `docker compose restart rest` (o cache de esquema do PostgREST **não** recarrega
   sozinho; já quebrou a tela de alertas depois da 0137) → smoke guiado.
3. **Smoke:** criar uma regra com 07:00–12:00 · 13:30–17:30 e passo de 1 h; conferir o aviso da
   sobra com passo de 1h30; "Avaliar agora" (`avaliarAgoraAction`) e ver se o bloco certo é medido;
   deixar um posto reprovar dentro de um bloco e conferir a mensagem no Telegram com a faixa.
4. **Ordem de deploy: 0139 ANTES do app.** A tabela filha precisa existir antes de o app tentar
   gravar intervalos. (E `ehJanelaTipo` do app antigo não conhece `'intervalos'`: ele cairia no
   `: 'tempo'` de `regras-repository.ts:59` e trataria a regra como janela corrediça — mas isso só
   acontece se alguém criar a regra, e só o app novo consegue criar.)
