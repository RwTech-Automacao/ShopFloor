# Alertas — tipos de regra, destinatários do ShopFloor e filtro de PMO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As regras de alerta do ShopFloor passam a ter três tipos (Taxa de aprovação, Tempo médio por peça, Defeito repetido), só mandam aviso para quem tem `shopfloor.administrar` e podem ser restritas a uma lista de PMOs.

**Architecture:** Tudo que decide continua no banco, numa migração nova `0115_alertas_tipos.sql` aplicada por cima da 0113/0114 (a 0113 não é editada). `alerta_regras` ganha `tipo` + campos de cada tipo + `pmos`, com um check por tipo e um trigger que impede trocar o tipo. `alerta_avaliar()` passa a juntar as medições dos três tipos numa consulta só (`alerta_taxas` com PMO, `alerta_tempos` e `alerta_defeitos` novas) e aplica as mesmas transições de antes (abrir / lembrar / normalizar), agora por regra × posto × defeito (índice único novo com `coalesce(defeito,'')`). A fila de envio fica como está: o avaliar põe as linhas pendentes na mesma transação, e a reserva (`for update skip locked`) segue igual — só ganha o filtro de permissão do destinatário, que é checada por `usuario_tem_permissao(usuario, modulo, perm)` (lê `perfil_permissao` pelo `usuarios.perfil_id` do usuário **listado**, não de quem chama). No TS, o domínio ganha o tipo da regra, a validação por tipo, o `mm:ss` e os textos por tipo; a tela ganha a escolha do tipo (3 cartões), o formulário por tipo, as PMOs e as colunas novas.

**Tech Stack:** Next.js 16.2.10 (App Router, Server Actions), React 19.2.4, TypeScript strict, Supabase (`@supabase/ssr` + `supabase-js`), Postgres 15 com RLS/RBAC por módulo, Tailwind v4 + componentes de `src/components/ui`, vitest 4 + Testing Library, testes SQL em Postgres descartável via Docker. **Nenhuma dependência npm nova.**

## Global Constraints

- Worktree: `/home/rwtech/Área de trabalho/ShopFloor-alertas-tipos`, branch `feat/shopfloor-alertas-tipos` (criada da main `161d1b6`). **Todos os caminhos deste plano são relativos a essa raiz.**
- O worktree **não tem `node_modules`**: rode `npm ci` uma vez antes do primeiro teste (Task 1, Step 1).
- **Não ler `.env*`.** `git add` sempre com caminhos explícitos (nunca `git add .`/`-A`).
- Idioma: textos de UI, mensagens de erro, comentários e mensagens de commit em **PT-BR**. Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **A `0113_alertas.sql` NÃO pode ser editada** (já aplicada no Dev, na demo e indo pro RDS). Tudo entra em `supabase/migrations/0115_alertas_tipos.sql`.
- A 0115: roda no RDS com `psql -1 -v ON_ERROR_STOP=1 -f` e no SQL Editor do Supabase (Dev/demo) colada inteira; corpo de função **sempre** com `$func$` (o SQL Editor não aceita dois cifrões, **nem em comentário**); idempotente (`add column if not exists`, `drop constraint if exists`, `drop trigger if exists`, `drop function if exists` da assinatura antiga antes de recriar); policies, se houver, no formato `(select tem_permissao(...))`; `revoke`/`grant` explícitos em toda função; **última linha** `notify pgrst, 'reload schema';`.
- Função que ganha parâmetro ou muda o retorno: `drop function if exists <assinatura antiga>` antes do `create` (senão as duas convivem e o PostgREST não sabe qual chamar). Nesta migração: `alerta_taxas(text[], text, int)`, `alerta_previa(text[], text, int, int)` e `alerta_listar_ocorrencias(timestamptz, timestamptz, text)`.
- Tipos: `tipo in ('aprovacao', 'tempo', 'defeito')`, `not null default 'aprovacao'` (regras existentes viram `aprovacao`). O tipo **não muda** depois de criado.
- Campos por tipo (spec §2): **aprovacao** = `taxa_minima` (0–100) + `minimo_bipes`, janela `tempo`|`bipes`|`op`; **tempo** = `limite_tempo_seg` (1–3600) + `minimo_bipes` (= mínimo de **intervalos**) + `pausa_max_min` (1–240, padrão 30), janela `tempo`|`op`; **defeito** = `limite_ocorrencias` (≥ 2), janela só `tempo`, `minimo_bipes` **nulo**. Campos dos outros tipos: nulos.
- Janela `tempo` ≤ 10080 min; `bipes` com teto de 30 dias; `op` = OP do último bipe do posto (só das PMOs da regra, quando há filtro), ignorada se esse bipe tem mais de 2 h.
- Comparação: aprovação **abaixo** = `taxa < taxa_minima`; tempo **abaixo** = `média > limite_tempo_seg`; defeito **abaixo** = `contagem >= limite_ocorrencias`. Normaliza = não-abaixo com o mínimo atingido (defeito não tem mínimo).
- `pmos text[] not null default '{}'`: vazio = todas as PMOs; vale para os 3 tipos e para a escolha do "último bipe" da janela `op`.
- Destinatário = usuário **ativo** com `shopfloor.administrar` no **perfil dele** (`usuario_tem_permissao`), checado em `alerta_destinatarios`, `alerta_avaliar` (fila), `alerta_resolver_interno` (fila e botão) e `alerta_reservar_envios` (entrega).
- Fila de envio no banco mantida (inserção na mesma transação da decisão; reserva com `for update skip locked`, reserva de 15 min, teto de 3 tentativas, 24 h). Exclusão lógica de regra mantida. Lançamento escondido por `ALERTAS_LIBERADO_PARA` (vazia = ninguém) mantido.
- Mensagens (spec §6): tempo `🔴 {posto} lento: {m:ss} por peça {janela} (limite {m:ss}) · {n} peças` / `🟢 {posto} normalizou: {m:ss} por peça`; defeito `🔴 Defeito {código} ({descrição}) repetido no {posto}: {n} vezes {janela} (limite {N})` / `🟢 Defeito {código} normalizou no {posto}`. Lembrete e Resolvido seguem o padrão atual. A formatação mora **só no TS**; o banco grava números em `alerta_envios.dados`.
- Tela: componentes de `src/components/ui` (checkbox nativo como no formulário atual); toast `{ position: 'bottom-center' }`; "ⓘ" com o `Explica` de `src/app/(app)/configuracoes/sf-alertas/explica.tsx` em cada campo de cálculo novo; tempo na tela em `mm:ss`, guardado em segundos.
- `npx tsc --noEmit` só volta a ficar verde no fim da Task 6 (a Task 1 muda tipos compartilhados que a infra e as telas só acompanham nas Tasks 5 e 6). Cada task roda os **próprios** testes (vitest ou SQL); a Task 7 roda tudo.
- Fora de escopo (spec §7): escolher defeitos específicos por regra; janela por bipes para tempo/defeito; resumo por turno.

## Decisões que a spec não fixava (tomadas neste plano)

| # | Decisão |
|---|---|
| D1 | `alerta_ocorrencias` ganha colunas **genéricas** `valor_abertura`/`valor_ultimo numeric(12,2)` + `amostras int` + `defeito text`. `taxa_abertura`/`taxa_ultima` ficam (agora nulas fora de `aprovacao`) e as ocorrências antigas são copiadas para as genéricas (`valor_* = taxa_*`, `amostras = aprovados + reprovados`). Valor: aprovação = taxa (%); tempo = média em segundos; defeito = contagem. |
| D2 | Tempo médio: um **bipe = um `data_hora` distinto** do posto (bipe com 3 linhas de defeito grava 3 linhas com o mesmo `data_hora` e conta como 1 peça). `{n} peças` = bipes distintos na janela. Média truncada em 2 casas no banco; `mm:ss` truncado na tela. |
| D3 | Limite de tempo de `0:01` a `60:00` (1–3600 s). A tela aceita `m:ss` ou só minutos (`3` = `3:00`). |
| D4 | Padrões: tempo = `2:00`, mínimo de 10 intervalos, pausa 30 min, janela 60 min; defeito = 5 repetições, janela 60 min. Os da aprovação não mudam. |
| D5 | "Descrição do catálogo": em `sf_defeitos` o `codigo` **já é** "número + descrição" (`'2040 COMPONENTE FALTANDO'`, mesmo texto gravado em `sf_registros.codigo_defeito`). Não há join: o banco guarda o código inteiro e o TS separa com `separarCodigoDefeito` + `capitalizarDescricaoDefeito` (de `src/modules/shopfloor/domain/defeito.ts`) → `2040 (Componente Faltando)`. O mesmo rótulo vale para alerta, normalizou, prévia e ocorrências. |
| D6 | Defeito conta por **linha** reprovada com código, só onde `posto` = posto da regra (não usa `posto_origem`). |
| D7 | O tipo fixo é garantido no banco por trigger (`TIPO_FIXO`); o update do repositório nem manda `tipo`. |
| D8 | `minimo_bipes` mantém o default 20 da 0113: quem grava regra de defeito manda `null` explícito (o check recusa o default). |
| D9 | Destinatário que perdeu `shopfloor.administrar` também não resolve pelo botão da mensagem (`NAO_DESTINATARIO`), além de sair da fila e da reserva. |
| D10 | A lista de PMOs vem de `alerta_pmos()` (nova, `shopfloor.administrar`), que devolve **um `text[]`** com as PMOs distintas de `sf_ordens` — um valor só, então o teto de 1000 linhas do PostgREST não corta. PMO salva que sumiu da lista continua aparecendo marcada. |
| D11 | Alerta de tempo/defeito ganha a 2ª linha `Regra: {nome} · {dd/mm HH:mm}` (igual à aprovação). Lembrete de tempo/defeito: `⏰ Lembrete — continua há {min} min` (sem "abaixo"). O normalizou do defeito usa o mesmo rótulo do alerta (`2040 (Componente Faltando)`). |
| D12 | `dados` sem `regra_tipo` = aprovação: linhas pendentes criadas antes da 0115 saem com o texto de sempre. |
| D13 | `alerta_previa` nova: 8 parâmetros nomeados e retorno largo; no tipo defeito devolve uma linha por (posto, defeito com contagem ≥ N) ou uma linha (posto, `defeito = null`) quando nenhum chega a N. |
| D14 | Testes SQL: o runner roda o teste da 0113 como hoje, aplica a 0115 **duas vezes** com `psql -1` (prova a idempotência, por cima de dados reais da 0113) e roda o arquivo novo `supabase/tests/alertas_tipos_test.sql`. |
| D15 | O aviso de destinatário descartado ao abrir o formulário passa a dizer "inativo(s) ou sem permissão de administrar o ShopFloor". |
| D16 | Ordem de deploy: aplicar a 0115 **antes** de subir o app novo e subir logo em seguida (o app velho só perde a prévia do formulário nesse intervalo — a `alerta_previa` de 4 parâmetros some). |

---

## Mapa de arquivos

**Banco**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0115_alertas_tipos.sql` | Criar. Parte A (Task 2): colunas/checks por tipo, trigger de tipo fixo, colunas da ocorrência + índice único com defeito, `usuario_tem_permissao`, `alerta_pmos`. Parte B (Task 3): `alerta_ultima_op`, `alerta_taxas` com PMO, `alerta_tempos`, `alerta_defeitos`, `alerta_avaliar` generalizado, `alerta_previa` e `alerta_listar_ocorrencias` novas. Parte C (Task 4): filtro de permissão em `alerta_avaliar`, `alerta_reservar_envios`, `alerta_resolver_interno`, `alerta_destinatarios`. |
| `supabase/tests/_stubs.sql` | Modificar (Task 2): `perfis`, `perfil_permissao`, `usuarios.perfil_id`, `sf_ordens`, `sf_registros.codigo_defeito`. |
| `supabase/tests/rodar-alertas-test.sh` | Modificar (Task 2): aplica a 0115 duas vezes com `-1` e roda `alertas_tipos_test.sql`. |
| `supabase/tests/alertas_tipos_test.sql` | Criar (Task 2) e estender (Tasks 3 e 4): migração, checks, índice, permissões, cálculo de cada tipo, PMO, prévia, listagem, destinatários. |

**Domínio (puro)** — `src/modules/alertas/domain/`

| Arquivo | Responsabilidade |
|---|---|
| `tipos.ts` | + `TipoRegra`, `TIPOS_REGRA`, `NOME_TIPO_REGRA`, `DESCRICAO_TIPO_REGRA`, `ehTipoRegra`. |
| `tempo.ts` | Criar: `formatarMmSs`, `lerMmSs`, `LIMITE_TEMPO_MAX_SEG`. |
| `taxa.ts` | + `formatarTaxaValor` (taxa já calculada, 1 casa truncada). |
| `regra.ts` | Reescrever: `EntradaRegra`/`RegraValida` com tipo, `validarRegra` por tipo, `EntradaPrevia`/`PreviaValida`/`validarPrevia`, `PADROES_TIPO`, `resumoLimite`, `resumoPmos`. |
| `mensagens.ts` | + `rotuloDefeito`, `textoAlertaTempo`, `textoNormalizouTempo`, `textoAlertaDefeito`, `textoNormalizouDefeito`, `textoLembreteTipo`. |
| `envio.ts` | Reescrever `textoDoEnvio`: despacha por `dados.regra_tipo`. |
| `ocorrencia.ts` | Reescrever: `PreviaPosto` e `OcorrenciaLinha` com os campos novos, `formatarValorOcorrencia`, `textoPreviaPosto`. |
| `erros.ts` | + `TIPO_FIXO`, `TIPO_INVALIDO`, `PAUSA_INVALIDA`, `LIMITE_INVALIDO`. |

**Infra / aplicação**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/alertas/infra/regras-repository.ts` | Reescrever (Task 5): colunas novas, insert com tipo / update sem tipo, prévia por tipo, ocorrências com defeito e valor, `listarPmosAlerta`. |
| `src/modules/alertas/application/alertas-actions.ts` | Modificar (Task 5): `previaRegraAction(EntradaPrevia)`, log com tipo/limite/PMOs. |

**Telas** — `src/app/(app)/configuracoes/sf-alertas/`

| Arquivo | Responsabilidade |
|---|---|
| `tipo-escolha.tsx` | Criar: os 3 cartões de tipo. |
| `pmos-selecao.tsx` | Criar: lista de marcar com busca + "Nenhuma marcada = todas as PMOs." |
| `regra-form.tsx` | Reescrever: campos por tipo, ⓘ novos, PMOs no fim, prévia por tipo. |
| `regra-dialog.tsx` | Reescrever: `RegraConteudo` (escolha → formulário; editar vai direto) + `RegraDialog`. |
| `regras-lista.tsx` | Reescrever: colunas Tipo, Limite, PMOs. |
| `ocorrencias-lista.tsx` | Reescrever: coluna Defeito e valores por tipo. |
| `alertas-tela.tsx`, `page.tsx` | Modificar: carregar e repassar as PMOs. |

**Docs**

| Arquivo | Responsabilidade |
|---|---|
| `tools/alertas/README.md` | Modificar (Task 7): seção da 0115 (Dev, demo, RDS) + conferências. |
| `docs/superpowers/plans/2026-09-18-alertas-tipos-smoke.md` | Criar (Task 7): roteiro de smoke dos tipos. |

---
### Task 1: Domínio — tipos de regra, validação por tipo, mm:ss e textos por tipo

**Files:**
- Modify: `src/modules/alertas/domain/tipos.ts` (acrescentar no fim)
- Create: `src/modules/alertas/domain/tempo.ts`
- Modify: `src/modules/alertas/domain/taxa.ts` (acrescentar no fim)
- Modify (reescrever inteiro): `src/modules/alertas/domain/regra.ts`
- Modify: `src/modules/alertas/domain/mensagens.ts` (imports + acrescentar no fim)
- Modify (reescrever inteiro): `src/modules/alertas/domain/envio.ts`
- Modify (reescrever inteiro): `src/modules/alertas/domain/ocorrencia.ts`
- Modify: `src/modules/alertas/domain/erros.ts`
- Modify: `src/modules/alertas/domain/__tests__/regra.test.ts` (2 expectativas)
- Test: `src/modules/alertas/domain/__tests__/tempo.test.ts`, `regra-tipos.test.ts`, `mensagens-tipos.test.ts`, `envio-tipos.test.ts`, `ocorrencia-tipos.test.ts`

**Interfaces:**
- Consumes: `separarCodigoDefeito(codigo: string): { numero: string; descricao: string }` e `capitalizarDescricaoDefeito(texto: string): string` de `@/modules/shopfloor/domain/defeito` (já existem); `formatarMeta`, `formatarTaxa`, `textoJanela`, `type Janela`, `formatarDataHoraCurta` (já existem).
- Produces (usados nas Tasks 5 e 6):
  - `tipos.ts`: `type TipoRegra = 'aprovacao' | 'tempo' | 'defeito'`; `TIPOS_REGRA: readonly TipoRegra[]`; `NOME_TIPO_REGRA: Record<TipoRegra, string>`; `DESCRICAO_TIPO_REGRA: Record<TipoRegra, string>`; `ehTipoRegra(v: unknown): v is TipoRegra`.
  - `tempo.ts`: `LIMITE_TEMPO_MAX_SEG = 3600`; `formatarMmSs(segundos: number): string`; `lerMmSs(texto: string | null | undefined): number | null`.
  - `taxa.ts`: `formatarTaxaValor(taxa: number): string`.
  - `regra.ts`: `interface EntradaRegra { tipo?: string; nome; postos; taxaMinima: string | number; janelaTipo; janelaValor; minimoBipes: string | number; limiteTempo?: string; limiteOcorrencias?: string | number | null; pausaMaxMin?: string | number | null; lembreteMin; canais; destinatarios; pmos?: string[]; ativa }`; `interface RegraValida { tipo: TipoRegra; nome: string; postos: string[]; taxaMinima: number | null; janelaTipo: JanelaTipo; janelaValor: number | null; minimoBipes: number | null; limiteTempoSeg: number | null; limiteOcorrencias: number | null; pausaMaxMin: number | null; lembreteMin: number | null; canais: Canal[]; destinatarios: string[]; pmos: string[]; ativa: boolean }`; `RegraAlerta extends RegraValida { id: string; atualizadoEm: string }`; `interface EntradaPrevia { tipo?: string; postos: string[]; janelaTipo: string; janelaValor: string | number | null; minimoBipes: string | number; pausaMaxMin?: string | number | null; limiteOcorrencias?: string | number | null; pmos?: string[] }`; `interface PreviaValida { tipo: TipoRegra; postos: string[]; janelaTipo: JanelaTipo; janelaValor: number | null; minimoBipes: number | null; pausaMaxMin: number | null; limiteOcorrencias: number | null; pmos: string[] }`; `validarRegra(e: EntradaRegra)`; `validarPrevia(e: EntradaPrevia)`; `PADROES_TIPO`; `resumoLimite(r: Pick<RegraValida, 'tipo' | 'taxaMinima' | 'limiteTempoSeg' | 'limiteOcorrencias'>): string`; `resumoPmos(pmos: string[]): string`.
  - `mensagens.ts`: `rotuloDefeito(codigo: string): string`; `textoAlertaTempo(d: DadosMensagemTempo)`; `textoNormalizouTempo(d: { posto: string; mediaSeg: number })`; `textoAlertaDefeito(d: DadosMensagemDefeito)`; `textoNormalizouDefeito(d: { posto: string; defeito: string })`; `textoLembreteTipo(alerta: string, abertaEm: Date, em: Date)`.
  - `ocorrencia.ts`: `interface PreviaPosto { posto; defeito: string | null; aprovados; reprovados; taxa: number | null; mediaSeg: number | null; intervalos: number; pecas: number; ocorrencias: number; avaliavel: boolean; pmo; op }`; `interface OcorrenciaLinha` + `regraTipo: TipoRegra; defeito: string | null; taxaAbertura: number | null; taxaUltima: number | null; valorAbertura: number | null; valorUltimo: number | null; amostras: number | null`; `formatarValorOcorrencia(tipo: TipoRegra, valor: number | null): string`; `textoPreviaPosto(tipo: TipoRegra, p: PreviaPosto, limiteOcorrencias: number | null): string`.
  - `envio.ts`: `textoDoEnvio(tipo, dados)` lê `dados.regra_tipo` (ausente = `aprovacao`). Chaves por tipo — tempo: `media_seg`, `limite_tempo_seg`, `pecas`; defeito: `defeito`, `ocorrencias`, `limite_ocorrencias`; comuns: `regra_nome`, `posto`, `janela_tipo`, `janela_valor`, `pmo`, `op`, `aberta_em`, `agora`.

- [ ] **Step 1: Instalar as dependências do worktree**

Run: `cd "/home/rwtech/Área de trabalho/ShopFloor-alertas-tipos" && npm ci`
Expected: termina sem erro (cria `node_modules`).

- [ ] **Step 2: Escrever os testes que falham**

Crie `src/modules/alertas/domain/__tests__/tempo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatarMmSs, lerMmSs, LIMITE_TEMPO_MAX_SEG } from '../tempo'

describe('formatarMmSs', () => {
  it('minutos e segundos com dois dígitos', () => {
    expect(formatarMmSs(120)).toBe('2:00')
    expect(formatarMmSs(65)).toBe('1:05')
    expect(formatarMmSs(5)).toBe('0:05')
    expect(formatarMmSs(3600)).toBe('60:00')
  })
  it('trunca a fração de segundo (mesma régua da taxa)', () => {
    expect(formatarMmSs(68.33)).toBe('1:08')
    expect(formatarMmSs(179.99)).toBe('2:59')
  })
  it('negativo ou inválido vira 0:00', () => {
    expect(formatarMmSs(-3)).toBe('0:00')
    expect(formatarMmSs(Number.NaN)).toBe('0:00')
  })
})

describe('lerMmSs', () => {
  it('lê m:ss', () => {
    expect(lerMmSs('2:00')).toBe(120)
    expect(lerMmSs(' 1:30 ')).toBe(90)
    expect(lerMmSs('0:45')).toBe(45)
    expect(lerMmSs('60:00')).toBe(3600)
  })
  it('número sozinho é minutos', () => {
    expect(lerMmSs('3')).toBe(180)
  })
  it('recusa fora do formato ou fora de 0:01–60:00', () => {
    for (const t of ['', '2:5', '2:60', '1:2:3', 'abc', '0:00', '60:01', '61', '-1:00', '2,5', null, undefined]) {
      expect(lerMmSs(t)).toBeNull()
    }
  })
  it('teto de 60 minutos', () => {
    expect(LIMITE_TEMPO_MAX_SEG).toBe(3600)
  })
})
```

Crie `src/modules/alertas/domain/__tests__/regra-tipos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validarRegra, validarPrevia, resumoLimite, resumoPmos, PADROES_TIPO, type EntradaRegra } from '../regra'
import { NOME_TIPO_REGRA, TIPOS_REGRA, ehTipoRegra } from '../tipos'
import { mensagemErroAlerta } from '../erros'

const COMUM = {
  nome: ' Teste  lento ',
  postos: ['Teste'],
  lembreteMin: '',
  canais: ['telegram'],
  destinatarios: ['u1'],
  ativa: true,
}

const TEMPO: EntradaRegra = {
  ...COMUM,
  tipo: 'tempo',
  taxaMinima: '',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '10',
  limiteTempo: '2:00',
  pausaMaxMin: '30',
  limiteOcorrencias: '',
  pmos: [' PMOA ', 'PMOA', 'PMOB'],
}

const DEFEITO: EntradaRegra = {
  ...COMUM,
  tipo: 'defeito',
  taxaMinima: '',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  limiteTempo: '',
  pausaMaxMin: '',
  limiteOcorrencias: '5',
  pmos: [],
}

describe('tipos de regra', () => {
  it('três tipos, com nome de tela', () => {
    expect(TIPOS_REGRA).toEqual(['aprovacao', 'tempo', 'defeito'])
    expect(NOME_TIPO_REGRA).toEqual({
      aprovacao: 'Taxa de aprovação',
      tempo: 'Tempo médio por peça',
      defeito: 'Defeito repetido',
    })
    expect(ehTipoRegra('tempo')).toBe(true)
    expect(ehTipoRegra('lua')).toBe(false)
  })
})

describe('validarRegra — tempo médio por peça', () => {
  it('valida e guarda o limite em segundos; PMOs sem repetição', () => {
    expect(validarRegra(TEMPO)).toEqual({
      ok: true,
      valor: {
        tipo: 'tempo',
        nome: 'Teste lento',
        postos: ['Teste'],
        taxaMinima: null,
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: 10,
        limiteTempoSeg: 120,
        limiteOcorrencias: null,
        pausaMaxMin: 30,
        lembreteMin: null,
        canais: ['telegram'],
        destinatarios: ['u1'],
        pmos: ['PMOA', 'PMOB'],
        ativa: true,
      },
    })
  })
  it('ignora a taxa digitada (não é campo do tipo)', () => {
    const r = validarRegra({ ...TEMPO, taxaMinima: '999' })
    expect(r.ok && r.valor.taxaMinima).toBeNull()
  })
  it('aceita a janela da OP em andamento e recusa a janela por bipes', () => {
    const r = validarRegra({ ...TEMPO, janelaTipo: 'op', janelaValor: null })
    expect(r.ok).toBe(true)
    expect(r.ok && r.valor.janelaValor).toBeNull()
    expect(validarRegra({ ...TEMPO, janelaTipo: 'bipes', janelaValor: '50' })).toEqual({
      ok: false,
      erro: 'Tempo médio por peça usa a janela por minutos ou a OP em andamento.',
    })
  })
  it('limite em mm:ss, de 0:01 a 60:00', () => {
    const erro = { ok: false, erro: 'Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00).' }
    expect(validarRegra({ ...TEMPO, limiteTempo: '2:75' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, limiteTempo: '' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, limiteTempo: '60:01' })).toEqual(erro)
    const r = validarRegra({ ...TEMPO, limiteTempo: '3' })
    expect(r.ok && r.valor.limiteTempoSeg).toBe(180)
  })
  it('pausas ignoradas de 1 a 240 minutos', () => {
    const erro = { ok: false, erro: 'Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.' }
    expect(validarRegra({ ...TEMPO, pausaMaxMin: '0' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, pausaMaxMin: '241' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, pausaMaxMin: '' })).toEqual(erro)
    const r = validarRegra({ ...TEMPO, pausaMaxMin: '240' })
    expect(r.ok && r.valor.pausaMaxMin).toBe(240)
  })
  it('mínimo de intervalos', () => {
    expect(validarRegra({ ...TEMPO, minimoBipes: '0' })).toEqual({
      ok: false,
      erro: 'O mínimo de intervalos deve ser um número inteiro maior que zero.',
    })
  })
})

describe('validarRegra — defeito repetido', () => {
  it('valida; o mínimo de bipes fica nulo', () => {
    expect(validarRegra(DEFEITO)).toEqual({
      ok: true,
      valor: {
        tipo: 'defeito',
        nome: 'Teste lento',
        postos: ['Teste'],
        taxaMinima: null,
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: null,
        limiteTempoSeg: null,
        limiteOcorrencias: 5,
        pausaMaxMin: null,
        lembreteMin: null,
        canais: ['telegram'],
        destinatarios: ['u1'],
        pmos: [],
        ativa: true,
      },
    })
  })
  it('só janela por minutos', () => {
    const erro = { ok: false, erro: 'Defeito repetido usa só a janela por minutos.' }
    expect(validarRegra({ ...DEFEITO, janelaTipo: 'op', janelaValor: null })).toEqual(erro)
    expect(validarRegra({ ...DEFEITO, janelaTipo: 'bipes', janelaValor: '50' })).toEqual(erro)
  })
  it('repetições: inteiro, 2 ou mais', () => {
    const erro = { ok: false, erro: 'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).' }
    expect(validarRegra({ ...DEFEITO, limiteOcorrencias: '1' })).toEqual(erro)
    expect(validarRegra({ ...DEFEITO, limiteOcorrencias: '2,5' })).toEqual(erro)
    expect(validarRegra({ ...DEFEITO, limiteOcorrencias: '' })).toEqual(erro)
    const r = validarRegra({ ...DEFEITO, limiteOcorrencias: '2' })
    expect(r.ok && r.valor.limiteOcorrencias).toBe(2)
  })
  it('a janela de minutos continua com teto de 7 dias', () => {
    expect(validarRegra({ ...DEFEITO, janelaValor: '10081' })).toEqual({
      ok: false,
      erro: 'A janela de tempo pode ter no máximo 7 dias (10080 minutos).',
    })
  })
})

describe('validarRegra — tipo', () => {
  it('tipo desconhecido é recusado', () => {
    expect(validarRegra({ ...TEMPO, tipo: 'lua' })).toEqual({ ok: false, erro: 'Escolha o tipo da regra.' })
  })
  it('sem tipo = taxa de aprovação (chamadas de antes dos tipos)', () => {
    const r = validarRegra({ ...COMUM, taxaMinima: '90', janelaTipo: 'tempo', janelaValor: '60', minimoBipes: '20' })
    expect(r.ok && r.valor.tipo).toBe('aprovacao')
    expect(r.ok && r.valor.pmos).toEqual([])
  })
})

describe('validarPrevia por tipo', () => {
  it('tempo leva a pausa e as PMOs', () => {
    expect(
      validarPrevia({
        tipo: 'tempo',
        postos: ['Teste'],
        janelaTipo: 'tempo',
        janelaValor: '60',
        minimoBipes: '10',
        pausaMaxMin: '30',
        pmos: ['PMOA'],
      }),
    ).toEqual({
      ok: true,
      valor: {
        tipo: 'tempo',
        postos: ['Teste'],
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: 10,
        pausaMaxMin: 30,
        limiteOcorrencias: null,
        pmos: ['PMOA'],
      },
    })
  })
  it('defeito exige as repetições', () => {
    expect(
      validarPrevia({
        tipo: 'defeito',
        postos: ['Teste'],
        janelaTipo: 'tempo',
        janelaValor: '60',
        minimoBipes: '',
        limiteOcorrencias: '1',
      }),
    ).toEqual({ ok: false, erro: 'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).' })
  })
})

describe('resumos da lista de regras', () => {
  it('limite formatado por tipo', () => {
    expect(resumoLimite({ tipo: 'aprovacao', taxaMinima: 90, limiteTempoSeg: null, limiteOcorrencias: null })).toBe('≥ 90%')
    expect(resumoLimite({ tipo: 'aprovacao', taxaMinima: 92.5, limiteTempoSeg: null, limiteOcorrencias: null })).toBe(
      '≥ 92,5%',
    )
    expect(resumoLimite({ tipo: 'tempo', taxaMinima: null, limiteTempoSeg: 120, limiteOcorrencias: null })).toBe(
      '≤ 2:00/peça',
    )
    expect(resumoLimite({ tipo: 'defeito', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: 5 })).toBe(
      '≥ 5 vezes',
    )
    expect(resumoLimite({ tipo: 'tempo', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: null })).toBe('—')
  })
  it('PMOs: vazio = Todas', () => {
    expect(resumoPmos([])).toBe('Todas')
    expect(resumoPmos(['PMOA', 'PMOB'])).toBe('PMOA, PMOB')
  })
  it('padrões dos tipos novos', () => {
    expect(PADROES_TIPO).toEqual({
      tempo: { limiteTempo: '2:00', janelaTempo: 60, minimoIntervalos: 10, pausaMaxMin: 30 },
      defeito: { limiteOcorrencias: 5, janelaTempo: 60 },
    })
  })
})

describe('erros novos do banco', () => {
  it('traduz os códigos da 0115', () => {
    expect(mensagemErroAlerta('ERROR: TIPO_FIXO')).toBe('O tipo da regra não muda depois de criado.')
    expect(mensagemErroAlerta('TIPO_INVALIDO')).toBe('Escolha o tipo da regra.')
    expect(mensagemErroAlerta('PAUSA_INVALIDA')).toBe(
      'Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.',
    )
    expect(mensagemErroAlerta('LIMITE_INVALIDO')).toBe(
      'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).',
    )
  })
})
```

Crie `src/modules/alertas/domain/__tests__/mensagens-tipos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  rotuloDefeito,
  textoAlertaDefeito,
  textoAlertaTempo,
  textoLembreteTipo,
  textoNormalizouDefeito,
  textoNormalizouTempo,
} from '../mensagens'

// 17/09/2026 14:05 em São Paulo
const EM = new Date('2026-09-17T17:05:00Z')

const TEMPO = {
  posto: 'Teste',
  regraNome: 'Teste lento',
  mediaSeg: 180,
  limiteSeg: 120,
  pecas: 11,
  janela: { tipo: 'tempo' as const, valor: 60 },
  em: EM,
}

const DEFEITO = {
  posto: 'Teste',
  regraNome: 'Defeito 3x',
  defeito: '2040 COMPONENTE FALTANDO',
  ocorrencias: 3,
  limite: 3,
  janela: { tipo: 'tempo' as const, valor: 60 },
  em: EM,
}

describe('rotuloDefeito', () => {
  it('número + descrição capitalizada', () => {
    expect(rotuloDefeito('2040 COMPONENTE FALTANDO')).toBe('2040 (Componente Faltando)')
  })
  it('só descrição', () => {
    expect(rotuloDefeito('TRILHA ROMPIDA')).toBe('Trilha Rompida')
  })
  it('só número', () => {
    expect(rotuloDefeito('777')).toBe('777')
  })
})

describe('tempo médio por peça', () => {
  it('alerta', () => {
    expect(textoAlertaTempo(TEMPO)).toBe(
      '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\nRegra: Teste lento · 17/09 14:05',
    )
  })
  it('janela da OP em andamento', () => {
    expect(textoAlertaTempo({ ...TEMPO, janela: { tipo: 'op', valor: null, pmo: 'PMOX', op: '7001' } })).toContain(
      '3:00 por peça na OP PMOX/7001 (limite 2:00)',
    )
  })
  it('normalizou', () => {
    expect(textoNormalizouTempo({ posto: 'Teste', mediaSeg: 68.33 })).toBe('🟢 Teste normalizou: 1:08 por peça')
  })
})

describe('defeito repetido', () => {
  it('alerta', () => {
    expect(textoAlertaDefeito(DEFEITO)).toBe(
      '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)\n' +
        'Regra: Defeito 3x · 17/09 14:05',
    )
  })
  it('janela de 90 minutos', () => {
    expect(textoAlertaDefeito({ ...DEFEITO, janela: { tipo: 'tempo', valor: 90 } })).toContain('3 vezes nos últimos 90 minutos')
  })
  it('normalizou', () => {
    expect(textoNormalizouDefeito({ posto: 'Teste', defeito: '2040 COMPONENTE FALTANDO' })).toBe(
      '🟢 Defeito 2040 (Componente Faltando) normalizou no Teste',
    )
  })
})

describe('lembrete dos tipos novos', () => {
  it('cabeçalho com o tempo desde a abertura, sem "abaixo"', () => {
    expect(textoLembreteTipo('🔴 corpo', new Date('2026-09-17T16:35:00Z'), EM)).toBe(
      '⏰ Lembrete — continua há 30 min\n🔴 corpo',
    )
  })
})
```

Crie `src/modules/alertas/domain/__tests__/envio-tipos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DadosEnvioInvalidos, textoDoEnvio } from '../envio'

/** `dados` como o alerta_avaliar da 0115 grava para cada tipo. */
const COMUNS = {
  posto: 'Teste',
  janela_tipo: 'tempo',
  janela_valor: 60,
  pmo: null,
  op: null,
  aberta_em: '2026-09-17T16:35:00+00:00',
  agora: '2026-09-17T17:05:00+00:00',
}

const TEMPO = {
  ...COMUNS,
  regra_tipo: 'tempo',
  regra_nome: 'Teste lento',
  media_seg: 180,
  limite_tempo_seg: 120,
  pecas: 11,
}

const DEFEITO = {
  ...COMUNS,
  regra_tipo: 'defeito',
  regra_nome: 'Defeito 3x',
  defeito: '2040 COMPONENTE FALTANDO',
  ocorrencias: 3,
  limite_ocorrencias: 3,
}

describe('textoDoEnvio — tempo médio por peça', () => {
  it('alerta', () => {
    expect(textoDoEnvio('alerta', TEMPO)).toBe(
      '🔴 Teste lento: 3:00 por peça na última hora (limite 2:00) · 11 peças\nRegra: Teste lento · 17/09 14:05',
    )
  })
  it('lembrete', () => {
    expect(textoDoEnvio('lembrete', TEMPO)).toMatch(/^⏰ Lembrete — continua há 30 min\n🔴 Teste lento: 3:00 por peça/)
  })
  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...TEMPO, media_seg: 68.33 })).toBe('🟢 Teste normalizou: 1:08 por peça')
  })
  it('janela da OP guardada', () => {
    expect(textoDoEnvio('alerta', { ...TEMPO, janela_tipo: 'op', janela_valor: null, pmo: 'PMOX', op: '7001' })).toContain(
      'na OP PMOX/7001',
    )
  })
  it('sem a média, não monta', () => {
    expect(() => textoDoEnvio('alerta', { ...TEMPO, media_seg: null })).toThrow(DadosEnvioInvalidos)
  })
})

describe('textoDoEnvio — defeito repetido', () => {
  it('alerta', () => {
    expect(textoDoEnvio('alerta', DEFEITO)).toBe(
      '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)\n' +
        'Regra: Defeito 3x · 17/09 14:05',
    )
  })
  it('lembrete', () => {
    expect(textoDoEnvio('lembrete', DEFEITO)).toMatch(/^⏰ Lembrete — continua há 30 min\n🔴 Defeito 2040/)
  })
  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...DEFEITO, ocorrencias: 0 })).toBe(
      '🟢 Defeito 2040 (Componente Faltando) normalizou no Teste',
    )
  })
  it('sem o defeito, não monta', () => {
    expect(() => textoDoEnvio('alerta', { ...DEFEITO, defeito: '' })).toThrow(DadosEnvioInvalidos)
  })
})

describe('textoDoEnvio — tipo da regra', () => {
  it('tipo desconhecido não monta', () => {
    expect(() => textoDoEnvio('alerta', { ...TEMPO, regra_tipo: 'lua' })).toThrow(DadosEnvioInvalidos)
  })
  it('sem regra_tipo = taxa de aprovação (fila de antes da 0115)', () => {
    const t = textoDoEnvio('alerta', {
      ...COMUNS,
      regra_nome: 'Teste abaixo de 90',
      taxa: 75,
      taxa_minima: 90,
      aprovados: 15,
      reprovados: 5,
    })
    expect(t).toBe(
      '🔴 Teste abaixo da meta\n' +
        'Taxa: 75,0% na última hora (mínimo 90%) · 15 aprovados, 5 reprovados\n' +
        'Regra: Teste abaixo de 90 · 17/09 14:05',
    )
  })
  it('regra_tipo aprovacao explícito dá o mesmo texto', () => {
    const dados = { ...COMUNS, regra_nome: 'R', taxa: 75, taxa_minima: 90, aprovados: 15, reprovados: 5 }
    expect(textoDoEnvio('alerta', { ...dados, regra_tipo: 'aprovacao' })).toBe(textoDoEnvio('alerta', dados))
  })
})
```

Crie `src/modules/alertas/domain/__tests__/ocorrencia-tipos.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatarValorOcorrencia, textoPreviaPosto, type PreviaPosto } from '../ocorrencia'
import { formatarTaxaValor } from '../taxa'

const P: PreviaPosto = {
  posto: 'Teste',
  defeito: null,
  aprovados: 0,
  reprovados: 0,
  taxa: null,
  mediaSeg: null,
  intervalos: 0,
  pecas: 0,
  ocorrencias: 0,
  avaliavel: false,
  pmo: null,
  op: null,
}

describe('formatarTaxaValor', () => {
  it('1 casa truncada, sem erro de ponto flutuante', () => {
    expect(formatarTaxaValor(88.88)).toBe('88,8')
    expect(formatarTaxaValor(75)).toBe('75,0')
    expect(formatarTaxaValor(0.29)).toBe('0,2')
    expect(formatarTaxaValor(99.99)).toBe('99,9')
  })
})

describe('formatarValorOcorrencia', () => {
  it('por tipo', () => {
    expect(formatarValorOcorrencia('aprovacao', 88.88)).toBe('88,8%')
    expect(formatarValorOcorrencia('tempo', 180)).toBe('3:00/peça')
    expect(formatarValorOcorrencia('defeito', 4)).toBe('4 vezes')
    expect(formatarValorOcorrencia('defeito', 1)).toBe('1 vez')
  })
  it('sem valor', () => {
    expect(formatarValorOcorrencia('tempo', null)).toBe('—')
  })
})

describe('textoPreviaPosto', () => {
  it('taxa de aprovação', () => {
    expect(textoPreviaPosto('aprovacao', { ...P, aprovados: 15, reprovados: 5, taxa: 75, avaliavel: true }, null)).toBe(
      'Teste: 75,0% (15 aprovados, 5 reprovados)',
    )
    expect(textoPreviaPosto('aprovacao', { ...P, aprovados: 3, reprovados: 1 }, null)).toBe(
      'Teste: bipes insuficientes na janela (4)',
    )
  })
  it('tempo médio por peça', () => {
    expect(textoPreviaPosto('tempo', { ...P, mediaSeg: 68.33, intervalos: 29, pecas: 30, avaliavel: true }, null)).toBe(
      'Teste: 1:08 por peça (29 intervalos, 30 peças)',
    )
    expect(textoPreviaPosto('tempo', { ...P, intervalos: 3, pecas: 4 }, null)).toBe(
      'Teste: intervalos insuficientes na janela (3)',
    )
  })
  it('defeito repetido', () => {
    expect(
      textoPreviaPosto('defeito', { ...P, defeito: '2040 COMPONENTE FALTANDO', ocorrencias: 3, avaliavel: true }, 3),
    ).toBe('Teste: 2040 (Componente Faltando) — 3 vezes')
    expect(textoPreviaPosto('defeito', { ...P, avaliavel: true }, 5)).toBe(
      'Teste: nenhum defeito repetido 5 vezes ou mais',
    )
  })
})
```

Em `src/modules/alertas/domain/__tests__/regra.test.ts`, troque a expectativa do primeiro teste (`normaliza nome, postos, canais e destinatários...`):

```ts
    expect(r.valor).toEqual({
      nome: 'Teste abaixo de 90',
      postos: ['Teste'],
      taxaMinima: 92.5,
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: 20,
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1', 'u2'],
      ativa: true,
    })
```

por:

```ts
    expect(r.valor).toEqual({
      tipo: 'aprovacao',
      nome: 'Teste abaixo de 90',
      postos: ['Teste'],
      taxaMinima: 92.5,
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: 20,
      limiteTempoSeg: null,
      limiteOcorrencias: null,
      pausaMaxMin: null,
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1', 'u2'],
      pmos: [],
      ativa: true,
    })
```

E, no `describe('validarPrevia')`, troque:

```ts
    expect(r).toEqual({ ok: true, valor: { postos: ['Teste'], janelaTipo: 'op', janelaValor: null, minimoBipes: 20 } })
```

por:

```ts
    expect(r).toEqual({
      ok: true,
      valor: {
        tipo: 'aprovacao',
        postos: ['Teste'],
        janelaTipo: 'op',
        janelaValor: null,
        minimoBipes: 20,
        pausaMaxMin: null,
        limiteOcorrencias: null,
        pmos: [],
      },
    })
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/modules/alertas/domain`
Expected: FAIL — `tempo.test.ts` com "Failed to resolve import '../tempo'", os outros arquivos novos com funções inexistentes (`rotuloDefeito is not a function` etc.), e `regra.test.ts` com diferença nas chaves `tipo`/`pmos`.

- [ ] **Step 4: `tipos.ts` — acrescentar no fim do arquivo**

```ts
/** Tipo da regra (spec 2026-09-18). O tipo não muda depois de criado. */
export type TipoRegra = 'aprovacao' | 'tempo' | 'defeito'
export const TIPOS_REGRA: readonly TipoRegra[] = ['aprovacao', 'tempo', 'defeito']

export const NOME_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de aprovação',
  tempo: 'Tempo médio por peça',
  defeito: 'Defeito repetido',
}

/** A frase de cada cartão da escolha do tipo. */
export const DESCRICAO_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Avisa quando a taxa de aprovação do posto cai abaixo da meta.',
  tempo: 'Avisa quando o tempo médio entre um bipe e o próximo passa do limite.',
  defeito: 'Avisa quando o mesmo defeito se repete várias vezes no posto em pouco tempo.',
}

/** É um tipo de regra conhecido? */
export function ehTipoRegra(valor: unknown): valor is TipoRegra {
  return valor === 'aprovacao' || valor === 'tempo' || valor === 'defeito'
}
```

- [ ] **Step 5: Criar `src/modules/alertas/domain/tempo.ts`**

```ts
/** Teto do "tempo máximo por peça" (60:00), igual ao check da 0115. */
export const LIMITE_TEMPO_MAX_SEG = 3600

/**
 * Segundos em 'm:ss' (120 → '2:00', 68,33 → '1:08'). A fração de segundo é TRUNCADA — mesma régua
 * da taxa: a tela nunca mostra o posto mais rápido do que ele foi.
 */
export function formatarMmSs(segundos: number): string {
  const total = Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const RE_MMSS = /^(\d{1,2}):([0-5]\d)$/
const RE_MINUTOS = /^\d{1,2}$/

/**
 * Lê o que o gestor digitou: 'm:ss' ('2:00', '0:45') ou só minutos ('3' = 3:00). Devolve segundos,
 * ou null fora do formato ou fora de 0:01–60:00.
 */
export function lerMmSs(texto: string | null | undefined): number | null {
  const t = String(texto ?? '').trim()
  let segundos: number
  const m = RE_MMSS.exec(t)
  if (m) segundos = Number(m[1]) * 60 + Number(m[2])
  else if (RE_MINUTOS.test(t)) segundos = Number(t) * 60
  else return null
  return segundos >= 1 && segundos <= LIMITE_TEMPO_MAX_SEG ? segundos : null
}
```

- [ ] **Step 6: `taxa.ts` — acrescentar no fim do arquivo**

```ts
/**
 * Taxa JÁ CALCULADA (o banco grava com 2 casas: 88,88) mostrada com 1 casa TRUNCADA (88,8) — a
 * mesma régua de `formatarTaxa`. Arredonda para centésimos inteiros antes de truncar, para não
 * depender do arredondamento binário (0,29 × 100 = 28,999...).
 */
export function formatarTaxaValor(taxa: number): string {
  const decimos = Math.floor(Math.round(taxa * 100) / 10)
  return (decimos / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}
```

- [ ] **Step 7: Reescrever `src/modules/alertas/domain/regra.ts` inteiro**

```ts
import {
  CANAIS,
  NOME_CANAL,
  ehJanelaTipo,
  ehTipoRegra,
  type Canal,
  type JanelaTipo,
  type TipoRegra,
} from './tipos'
import { formatarMeta } from './taxa'
import { formatarMmSs, lerMmSs } from './tempo'

/** O que vem do formulário (tudo pode chegar como texto). Campos de outro tipo são ignorados. */
export interface EntradaRegra {
  /** Ausente = 'aprovacao' (chamadas de antes dos tipos). */
  tipo?: string
  nome: string
  postos: string[]
  taxaMinima: string | number
  janelaTipo: string
  janelaValor: string | number | null
  /** Aprovação: mínimo de bipes. Tempo: mínimo de INTERVALOS. Defeito: ignorado. */
  minimoBipes: string | number
  /** Tempo médio: 'm:ss' (ex.: '2:00'). */
  limiteTempo?: string
  /** Defeito repetido: N. */
  limiteOcorrencias?: string | number | null
  /** Tempo médio: minutos. */
  pausaMaxMin?: string | number | null
  lembreteMin: string | number | null
  canais: string[]
  destinatarios: string[]
  /** Vazio = todas as PMOs. */
  pmos?: string[]
  ativa: boolean
}

/** A regra já conferida, pronta para o banco. Campo que não é do tipo = null. */
export interface RegraValida {
  tipo: TipoRegra
  nome: string
  postos: string[]
  taxaMinima: number | null
  janelaTipo: JanelaTipo
  janelaValor: number | null
  minimoBipes: number | null
  limiteTempoSeg: number | null
  limiteOcorrencias: number | null
  pausaMaxMin: number | null
  lembreteMin: number | null
  canais: Canal[]
  destinatarios: string[]
  pmos: string[]
  ativa: boolean
}

export interface RegraAlerta extends RegraValida {
  id: string
  atualizadoEm: string
}

export interface DestinatarioDisponivel {
  usuarioId: string
  nome: string
  email: string
  telegram: boolean
  discord: boolean
}

/** O que a prévia do formulário precisa (nome/canais/destinatários ainda podem faltar). */
export interface EntradaPrevia {
  tipo?: string
  postos: string[]
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
  pausaMaxMin?: string | number | null
  limiteOcorrencias?: string | number | null
  pmos?: string[]
}

export interface PreviaValida {
  tipo: TipoRegra
  postos: string[]
  janelaTipo: JanelaTipo
  janelaValor: number | null
  minimoBipes: number | null
  pausaMaxMin: number | null
  limiteOcorrencias: number | null
  pmos: string[]
}

/** Teto da janela `tempo` (7 dias), igual ao check da 0113. */
export const JANELA_TEMPO_MAX_MIN = 10080

/** Padrões da spec de 2026-09-17 (taxa de aprovação). */
export const PADROES_REGRA = { taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 }

/** Padrões dos tipos novos (spec de 2026-09-18). */
export const PADROES_TIPO = {
  tempo: { limiteTempo: '2:00', janelaTempo: 60, minimoIntervalos: 10, pausaMaxMin: 30 },
  defeito: { limiteOcorrencias: 5, janelaTempo: 60 },
} as const

/** "Ignorar pausas acima de" aceita de 1 a 240 minutos (check da 0115). */
export const PAUSA_MAX_MIN = { min: 1, max: 240 } as const

const RE_DECIMAL = /^\d{1,3}([.,]\d{1,2})?$/

type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string }

function erro(mensagem: string): { ok: false; erro: string } {
  return { ok: false, erro: mensagem }
}

function textoLimpo(v: string | number | null | undefined): string {
  return String(v ?? '').trim()
}

/** Número inteiro ou null (vazio). NaN quando o texto não é número. */
function inteiro(v: string | number | null | undefined): number | null {
  const s = textoLimpo(v).replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isInteger(n) ? n : Number.NaN
}

// Payload malformado (ex.: JSON de terceiro, campo faltando) pode chegar sem ser array — trata
// como lista vazia em vez de estourar `.map`/`.includes`, e a regra de "pelo menos 1" recusa.
function unicos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  return [
    ...new Set(
      lista
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter((x) => x !== ''),
    ),
  ]
}

export function validarRegra(e: EntradaRegra): Resultado<RegraValida> {
  const tipoBruto = e.tipo === undefined || e.tipo === null || e.tipo === '' ? 'aprovacao' : e.tipo
  if (!ehTipoRegra(tipoBruto)) return erro('Escolha o tipo da regra.')
  const tipo: TipoRegra = tipoBruto

  const nome = textoLimpo(e.nome).replace(/\s+/g, ' ')
  if (nome === '') return erro('Informe o nome da regra.')

  const postos = unicos(e.postos)
  if (postos.length === 0) return erro('Escolha pelo menos 1 posto.')

  let taxaMinima: number | null = null
  if (tipo === 'aprovacao') {
    const taxaTexto = textoLimpo(e.taxaMinima)
    const taxa = Number(taxaTexto.replace(',', '.'))
    if (taxaTexto === '' || !Number.isFinite(taxa) || taxa < 0 || taxa > 100) {
      return erro('A taxa mínima deve ficar entre 0 e 100.')
    }
    // Conferido no TEXTO: em ponto flutuante 90,125 "arredonda" e passaria escondido.
    if (!RE_DECIMAL.test(taxaTexto)) return erro('A taxa mínima aceita até 2 casas decimais.')
    taxaMinima = taxa
  }

  if (!ehJanelaTipo(e.janelaTipo)) return erro('Escolha a janela da regra.')
  const janelaTipo: JanelaTipo = e.janelaTipo
  if (tipo === 'tempo' && janelaTipo === 'bipes') {
    return erro('Tempo médio por peça usa a janela por minutos ou a OP em andamento.')
  }
  if (tipo === 'defeito' && janelaTipo !== 'tempo') return erro('Defeito repetido usa só a janela por minutos.')

  let janelaValor: number | null = null
  if (janelaTipo !== 'op') {
    const v = inteiro(e.janelaValor)
    if (v === null || Number.isNaN(v) || v <= 0) {
      return erro(janelaTipo === 'tempo' ? 'Informe quantos minutos a janela olha.' : 'Informe quantos bipes a janela olha.')
    }
    if (janelaTipo === 'tempo' && v > JANELA_TEMPO_MAX_MIN) {
      return erro('A janela de tempo pode ter no máximo 7 dias (10080 minutos).')
    }
    janelaValor = v
  }

  let minimoBipes: number | null = null
  if (tipo !== 'defeito') {
    const m = inteiro(e.minimoBipes)
    if (m === null || Number.isNaN(m) || m <= 0) {
      return erro(
        tipo === 'tempo'
          ? 'O mínimo de intervalos deve ser um número inteiro maior que zero.'
          : 'O mínimo de bipes deve ser um número inteiro maior que zero.',
      )
    }
    minimoBipes = m
  }
  // Janela de 10 bipes com mínimo de 20 NUNCA decidiria nada — melhor recusar do que ficar muda.
  if (tipo === 'aprovacao' && janelaTipo === 'bipes' && janelaValor !== null && minimoBipes !== null && janelaValor < minimoBipes) {
    return erro('A janela de bipes precisa ser maior ou igual ao mínimo de bipes.')
  }

  let limiteTempoSeg: number | null = null
  let pausaMaxMin: number | null = null
  if (tipo === 'tempo') {
    limiteTempoSeg = lerMmSs(textoLimpo(e.limiteTempo))
    if (limiteTempoSeg === null) return erro('Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00).')
    const p = inteiro(e.pausaMaxMin)
    if (p === null || Number.isNaN(p) || p < PAUSA_MAX_MIN.min || p > PAUSA_MAX_MIN.max) {
      return erro('Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.')
    }
    pausaMaxMin = p
  }

  let limiteOcorrencias: number | null = null
  if (tipo === 'defeito') {
    const n = inteiro(e.limiteOcorrencias)
    if (n === null || Number.isNaN(n) || n < 2) {
      return erro('Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).')
    }
    limiteOcorrencias = n
  }

  const lembrete = inteiro(e.lembreteMin)
  if (lembrete !== null && (Number.isNaN(lembrete) || lembrete <= 0)) {
    return erro('O lembrete deve ser um número inteiro de minutos (ou vazio).')
  }

  const canaisEntrada = Array.isArray(e.canais) ? e.canais : []
  const canais = CANAIS.filter((c) => canaisEntrada.includes(c))
  if (canais.length === 0) return erro('Escolha pelo menos 1 canal.')

  const destinatarios = unicos(e.destinatarios)
  if (destinatarios.length === 0) return erro('Escolha pelo menos 1 destinatário.')

  return {
    ok: true,
    valor: {
      tipo,
      nome,
      postos,
      taxaMinima,
      janelaTipo,
      janelaValor,
      minimoBipes,
      limiteTempoSeg,
      limiteOcorrencias,
      pausaMaxMin,
      lembreteMin: lembrete,
      canais: [...canais],
      destinatarios,
      pmos: unicos(e.pmos),
      ativa: e.ativa,
    },
  }
}

/** A prévia só precisa de tipo + postos + janela + parâmetros de cálculo + PMOs. */
export function validarPrevia(e: EntradaPrevia): Resultado<PreviaValida> {
  const r = validarRegra({
    tipo: e.tipo,
    nome: 'previa',
    postos: e.postos,
    taxaMinima: 100,
    janelaTipo: e.janelaTipo,
    janelaValor: e.janelaValor,
    minimoBipes: e.minimoBipes,
    limiteTempo: '1:00',
    pausaMaxMin: e.pausaMaxMin,
    limiteOcorrencias: e.limiteOcorrencias,
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['previa'],
    pmos: e.pmos,
    ativa: true,
  })
  if (!r.ok) return r
  const v = r.valor
  return {
    ok: true,
    valor: {
      tipo: v.tipo,
      postos: v.postos,
      janelaTipo: v.janelaTipo,
      janelaValor: v.janelaValor,
      minimoBipes: v.minimoBipes,
      pausaMaxMin: v.pausaMaxMin,
      limiteOcorrencias: v.limiteOcorrencias,
      pmos: v.pmos,
    },
  }
}

/** Coluna "Limite" da lista de regras: '≥ 90%', '≤ 2:00/peça', '≥ 5 vezes'. */
export function resumoLimite(
  r: Pick<RegraValida, 'tipo' | 'taxaMinima' | 'limiteTempoSeg' | 'limiteOcorrencias'>,
): string {
  if (r.tipo === 'tempo') return r.limiteTempoSeg === null ? '—' : `≤ ${formatarMmSs(r.limiteTempoSeg)}/peça`
  if (r.tipo === 'defeito') return r.limiteOcorrencias === null ? '—' : `≥ ${r.limiteOcorrencias} vezes`
  return r.taxaMinima === null ? '—' : `≥ ${formatarMeta(r.taxaMinima)}%`
}

/** Coluna "PMOs": nenhuma = todas. */
export function resumoPmos(pmos: string[]): string {
  return pmos.length === 0 ? 'Todas' : pmos.join(', ')
}

/** Avisos do diálogo: quem está escolhido mas não recebe por algum canal marcado. */
export function destinatariosSemCanal(
  disponiveis: DestinatarioDisponivel[],
  selecionados: string[],
  canais: Canal[],
): string[] {
  return disponiveis
    .filter((d) => selecionados.includes(d.usuarioId))
    .flatMap((d) => canais.filter((c) => !d[c]).map((c) => `${d.nome} sem ${NOME_CANAL[c]}`))
}
```

- [ ] **Step 8: `mensagens.ts` — imports e funções novas**

No topo de `src/modules/alertas/domain/mensagens.ts`, troque:

```ts
import { formatarMeta, formatarTaxa } from './taxa'
import { textoJanela, type Janela } from './janela'
```

por:

```ts
import { capitalizarDescricaoDefeito, separarCodigoDefeito } from '@/modules/shopfloor/domain/defeito'
import { formatarMeta, formatarTaxa } from './taxa'
import { textoJanela, type Janela } from './janela'
import { formatarMmSs } from './tempo'
```

E acrescente no fim do arquivo:

```ts
// ---------------------------------------------------------------------------
// Tipos novos (spec 2026-09-18): tempo médio por peça e defeito repetido
// ---------------------------------------------------------------------------

/**
 * '2040 COMPONENTE FALTANDO' → '2040 (Componente Faltando)'. Em `sf_defeitos` o código JÁ É
 * "número + descrição" (o mesmo texto de `sf_registros.codigo_defeito`), então a descrição do
 * catálogo sai daqui, sem consulta. Sem número → só a descrição; sem descrição → só o número.
 */
export function rotuloDefeito(codigo: string): string {
  const { numero, descricao } = separarCodigoDefeito(codigo)
  const desc = descricao ? capitalizarDescricaoDefeito(descricao) : ''
  if (numero && desc) return `${numero} (${desc})`
  return numero || desc || codigo.trim()
}

export interface DadosMensagemTempo {
  posto: string
  regraNome: string
  mediaSeg: number
  limiteSeg: number
  pecas: number
  janela: Janela
  em: Date
}

export function textoAlertaTempo(d: DadosMensagemTempo): string {
  return (
    `🔴 ${d.posto} lento: ${formatarMmSs(d.mediaSeg)} por peça ${textoJanela(d.janela)} ` +
    `(limite ${formatarMmSs(d.limiteSeg)}) · ${d.pecas} peças\n` +
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  )
}

export function textoNormalizouTempo(d: { posto: string; mediaSeg: number }): string {
  return `🟢 ${d.posto} normalizou: ${formatarMmSs(d.mediaSeg)} por peça`
}

export interface DadosMensagemDefeito {
  posto: string
  regraNome: string
  defeito: string
  ocorrencias: number
  limite: number
  janela: Janela
  em: Date
}

export function textoAlertaDefeito(d: DadosMensagemDefeito): string {
  return (
    `🔴 Defeito ${rotuloDefeito(d.defeito)} repetido no ${d.posto}: ${d.ocorrencias} vezes ` +
    `${textoJanela(d.janela)} (limite ${d.limite})\n` +
    `Regra: ${d.regraNome} · ${formatarDataHoraCurta(d.em)}`
  )
}

export function textoNormalizouDefeito(d: { posto: string; defeito: string }): string {
  return `🟢 Defeito ${rotuloDefeito(d.defeito)} normalizou no ${d.posto}`
}

/** Lembrete de tempo/defeito: o cabeçalho não fala em "abaixo" (um posto lento está ACIMA do limite). */
export function textoLembreteTipo(alerta: string, abertaEm: Date, em: Date): string {
  const min = Math.max(0, Math.floor((em.getTime() - abertaEm.getTime()) / 60_000))
  return `⏰ Lembrete — continua há ${min} min\n${alerta}`
}
```

- [ ] **Step 9: Reescrever `src/modules/alertas/domain/envio.ts` inteiro**

```ts
import { ehCanal, ehJanelaTipo, ehTipoRegra, type Canal, type TipoEnvio } from './tipos'
import type { Janela } from './janela'
import {
  textoAlerta,
  textoAlertaDefeito,
  textoAlertaTempo,
  textoLembrete,
  textoLembreteTipo,
  textoNormalizou,
  textoNormalizouDefeito,
  textoNormalizouTempo,
  textoResolvido,
  textoTeste,
} from './mensagens'

/**
 * Uma linha da fila (`alerta_envios`) já RESERVADA por esta rodada (`alerta_reservar_envios`):
 * `tentativas` já conta esta tentativa, e `externoId` é o da conta vinculada de AGORA.
 */
export interface EnvioReservado {
  id: string
  ocorrenciaId: string | null
  usuarioId: string
  canal: Canal
  externoId: string
  tipo: TipoEnvio
  /** O que o banco guardou para montar o texto (ver `textoDoEnvio`). */
  dados: Record<string, unknown>
  comBotao: boolean
  tentativas: number
}

const TIPOS: readonly TipoEnvio[] = ['alerta', 'lembrete', 'resolvido', 'normalizou', 'teste']

function ehTipoEnvio(v: unknown): v is TipoEnvio {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v)
}

/**
 * Converte uma linha devolvida pelo `alerta_reservar_envios`. Linha que não reconhece (canal ou
 * tipo novo no banco) volta `null` e é pulada — a reserva vence e ela volta numa rodada futura.
 */
export function lerEnvioReservado(bruto: unknown): EnvioReservado | null {
  const l = (bruto ?? {}) as Record<string, unknown>
  if (!ehCanal(l.canal) || !ehTipoEnvio(l.tipo)) return null
  const id = String(l.id ?? '')
  const externoId = String(l.externo_id ?? '')
  if (id === '' || externoId === '') return null
  const dados = l.dados && typeof l.dados === 'object' && !Array.isArray(l.dados)
    ? (l.dados as Record<string, unknown>)
    : {}
  return {
    id,
    ocorrenciaId: l.ocorrencia_id === null || l.ocorrencia_id === undefined ? null : String(l.ocorrencia_id),
    usuarioId: String(l.usuario_id ?? ''),
    canal: l.canal,
    externoId,
    tipo: l.tipo,
    dados,
    comBotao: l.com_botao === true,
    tentativas: Number(l.tentativas ?? 0) || 0,
  }
}

/** Erro de montagem: a linha não tem os dados que o tipo exige. */
export class DadosEnvioInvalidos extends Error {
  constructor(campo: string) {
    super(`DADOS_INVALIDOS: ${campo}`)
    this.name = 'DadosEnvioInvalidos'
  }
}

function texto(d: Record<string, unknown>, campo: string): string {
  const v = d[campo]
  if (v === null || v === undefined || String(v) === '') throw new DadosEnvioInvalidos(campo)
  return String(v)
}

function textoOuNulo(d: Record<string, unknown>, campo: string): string | null {
  const v = d[campo]
  return v === null || v === undefined ? null : String(v)
}

function numero(d: Record<string, unknown>, campo: string): number {
  const n = Number(d[campo])
  if (d[campo] === null || d[campo] === undefined || !Number.isFinite(n)) throw new DadosEnvioInvalidos(campo)
  return n
}

function data(d: Record<string, unknown>, campo: string): Date {
  const v = new Date(texto(d, campo))
  if (Number.isNaN(v.getTime())) throw new DadosEnvioInvalidos(campo)
  return v
}

/** Envios que nascem de uma ocorrência — os únicos cujo texto depende do tipo da regra. */
type TipoEnvioOcorrencia = Exclude<TipoEnvio, 'teste' | 'resolvido'>

function janelaDe(d: Record<string, unknown>): Janela {
  const tipo = d.janela_tipo
  if (!ehJanelaTipo(tipo)) throw new DadosEnvioInvalidos('janela_tipo')
  const valor = d.janela_valor === null || d.janela_valor === undefined ? null : numero(d, 'janela_valor')
  return { tipo, valor, pmo: textoOuNulo(d, 'pmo'), op: textoOuNulo(d, 'op') }
}

function textoAprovacao(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const posto = texto(dados, 'posto')
  const aprovados = numero(dados, 'aprovados')
  const reprovados = numero(dados, 'reprovados')
  const abertaEm = data(dados, 'aberta_em')
  const agora = data(dados, 'agora')
  if (tipo === 'normalizou') return textoNormalizou({ posto, aprovados, reprovados, abertaEm, em: agora })
  const base = {
    posto,
    regraNome: texto(dados, 'regra_nome'),
    taxaMinima: numero(dados, 'taxa_minima'),
    aprovados,
    reprovados,
    janela: janelaDe(dados),
    em: agora,
  }
  if (tipo === 'alerta') return textoAlerta(base)
  return textoLembrete({ ...base, abertaEm })
}

function textoTempo(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const posto = texto(dados, 'posto')
  const mediaSeg = numero(dados, 'media_seg')
  if (tipo === 'normalizou') return textoNormalizouTempo({ posto, mediaSeg })
  const agora = data(dados, 'agora')
  const alerta = textoAlertaTempo({
    posto,
    regraNome: texto(dados, 'regra_nome'),
    mediaSeg,
    limiteSeg: numero(dados, 'limite_tempo_seg'),
    pecas: numero(dados, 'pecas'),
    janela: janelaDe(dados),
    em: agora,
  })
  if (tipo === 'alerta') return alerta
  return textoLembreteTipo(alerta, data(dados, 'aberta_em'), agora)
}

function textoDefeito(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const posto = texto(dados, 'posto')
  const defeito = texto(dados, 'defeito')
  if (tipo === 'normalizou') return textoNormalizouDefeito({ posto, defeito })
  const agora = data(dados, 'agora')
  const alerta = textoAlertaDefeito({
    posto,
    regraNome: texto(dados, 'regra_nome'),
    defeito,
    ocorrencias: numero(dados, 'ocorrencias'),
    limite: numero(dados, 'limite_ocorrencias'),
    janela: janelaDe(dados),
    em: agora,
  })
  if (tipo === 'alerta') return alerta
  return textoLembreteTipo(alerta, data(dados, 'aberta_em'), agora)
}

/**
 * Monta o texto de uma linha da fila a partir dos `dados` gravados pelo banco. A formatação
 * (fuso de São Paulo, taxa truncada, mm:ss, duração) existe SÓ aqui no TS — o SQL guarda os números.
 * Como os dados foram congelados quando a linha nasceu, o reenvio sai idêntico à primeira vez.
 * Lança `DadosEnvioInvalidos` se faltar algo (quem chama trata por item).
 *
 * Chaves (as mesmas do jsonb_build_object do alerta_avaliar da 0115):
 *   comuns (alerta/lembrete/normalizou): regra_tipo, regra_nome, posto, janela_tipo, janela_valor,
 *                                        pmo, op, aberta_em, agora
 *   aprovacao: taxa, taxa_minima, aprovados, reprovados
 *   tempo:     media_seg, limite_tempo_seg, pecas
 *   defeito:   defeito, ocorrencias, limite_ocorrencias
 *   resolvido: posto, resolvida_por_nome, resolvida_em
 *   teste: nome
 * `regra_tipo` ausente = 'aprovacao' (linhas enfileiradas antes da 0115).
 */
export function textoDoEnvio(tipo: TipoEnvio, dados: Record<string, unknown>): string {
  if (tipo === 'teste') return textoTeste(texto(dados, 'nome'))
  if (tipo === 'resolvido') {
    return textoResolvido({
      posto: texto(dados, 'posto'),
      nome: texto(dados, 'resolvida_por_nome'),
      em: data(dados, 'resolvida_em'),
    })
  }

  const regraTipo = dados.regra_tipo === null || dados.regra_tipo === undefined ? 'aprovacao' : dados.regra_tipo
  if (!ehTipoRegra(regraTipo)) throw new DadosEnvioInvalidos('regra_tipo')
  if (regraTipo === 'tempo') return textoTempo(tipo, dados)
  if (regraTipo === 'defeito') return textoDefeito(tipo, dados)
  return textoAprovacao(tipo, dados)
}
```

- [ ] **Step 10: Reescrever `src/modules/alertas/domain/ocorrencia.ts` inteiro**

```ts
import type { EstadoOcorrencia, TipoRegra } from './tipos'
import { formatarTaxa, formatarTaxaValor } from './taxa'
import { formatarMmSs } from './tempo'
import { rotuloDefeito } from './mensagens'

/**
 * Uma linha da prévia do formulário (o valor de agora, sem gravar nada). Cada tipo usa os seus
 * campos: aprovação (aprovados/reprovados/taxa), tempo (mediaSeg/intervalos/pecas), defeito
 * (defeito/ocorrencias — `defeito` null = nenhum código chegou ao limite naquele posto).
 */
export interface PreviaPosto {
  posto: string
  defeito: string | null
  aprovados: number
  reprovados: number
  taxa: number | null
  mediaSeg: number | null
  intervalos: number
  pecas: number
  ocorrencias: number
  avaliavel: boolean
  pmo: string | null
  op: string | null
}

export interface FiltroOcorrencias {
  /** 'YYYY-MM-DD' */
  de: string
  /** 'YYYY-MM-DD' */
  ate: string
  /** '' = todos os estados */
  estado: '' | EstadoOcorrencia
}

export interface OcorrenciaLinha {
  id: string
  regraId: string
  regraNome: string
  regraTipo: TipoRegra
  posto: string
  /** Só no tipo defeito: o código do defeito da ocorrência. */
  defeito: string | null
  pmo: string | null
  op: string | null
  estado: EstadoOcorrencia
  /** Só no tipo aprovação (colunas antigas). */
  taxaAbertura: number | null
  taxaUltima: number | null
  /** Valor medido: taxa (%), média (segundos) ou contagem, conforme o tipo. */
  valorAbertura: number | null
  valorUltimo: number | null
  amostras: number | null
  aprovados: number
  reprovados: number
  abertaEm: string
  resolvidaPorNome: string
  resolvidaEm: string | null
  normalizadaEm: string | null
  enviosOk: number
  enviosFalha: number
}

/** Valor medido na régua do tipo: '88,8%', '3:00/peça', '4 vezes'. */
export function formatarValorOcorrencia(tipo: TipoRegra, valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return '—'
  if (tipo === 'tempo') return `${formatarMmSs(valor)}/peça`
  if (tipo === 'defeito') return valor === 1 ? '1 vez' : `${valor} vezes`
  return `${formatarTaxaValor(valor)}%`
}

/** Uma linha da prévia, no texto da tela. `limiteOcorrencias` só importa no tipo defeito. */
export function textoPreviaPosto(tipo: TipoRegra, p: PreviaPosto, limiteOcorrencias: number | null): string {
  if (tipo === 'tempo') {
    if (p.avaliavel && p.mediaSeg !== null) {
      return `${p.posto}: ${formatarMmSs(p.mediaSeg)} por peça (${p.intervalos} intervalos, ${p.pecas} peças)`
    }
    return `${p.posto}: intervalos insuficientes na janela (${p.intervalos})`
  }
  if (tipo === 'defeito') {
    if (p.defeito === null) return `${p.posto}: nenhum defeito repetido ${limiteOcorrencias ?? '—'} vezes ou mais`
    return `${p.posto}: ${rotuloDefeito(p.defeito)} — ${p.ocorrencias} vezes`
  }
  if (p.avaliavel) {
    return `${p.posto}: ${formatarTaxa(p.aprovados, p.reprovados)}% (${p.aprovados} aprovados, ${p.reprovados} reprovados)`
  }
  return `${p.posto}: bipes insuficientes na janela (${p.aprovados + p.reprovados})`
}

const FUSO = 'America/Sao_Paulo'
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/

/** Dia 'YYYY-MM-DD' no fuso da fábrica (o servidor roda em UTC). */
export function dataIsoSaoPaulo(d: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

/**
 * Converte os dois dias do filtro no intervalo que o banco recebe. O deslocamento é fixo em -03:00:
 * o Brasil não tem horário de verão desde 2019.
 */
export function periodoOcorrencias(de: string, ate: string): { de: string; ate: string } | null {
  if (!RE_DIA.test(de) || !RE_DIA.test(ate) || de > ate) return null
  return { de: `${de}T00:00:00-03:00`, ate: `${ate}T23:59:59.999-03:00` }
}

/** Filtro inicial da aba Ocorrências: os últimos 7 dias. */
export function filtroOcorrenciasPadrao(hoje: Date): FiltroOcorrencias {
  const seteDias = new Date(hoje.getTime() - 6 * 24 * 60 * 60 * 1000)
  return { de: dataIsoSaoPaulo(seteDias), ate: dataIsoSaoPaulo(hoje), estado: '' }
}
```

- [ ] **Step 11: `erros.ts` — códigos novos**

Em `src/modules/alertas/domain/erros.ts`, troque a linha:

```ts
  JANELA_INVALIDA: 'Informe um valor de janela maior que zero.',
```

por:

```ts
  JANELA_INVALIDA: 'Informe um valor de janela maior que zero.',
  TIPO_FIXO: 'O tipo da regra não muda depois de criado.',
  TIPO_INVALIDO: 'Escolha o tipo da regra.',
  PAUSA_INVALIDA: 'Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.',
  LIMITE_INVALIDO: 'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).',
```

- [ ] **Step 12: Rodar e ver passar (e sem regressão nos testes que já existiam)**

Run: `npx vitest run src/modules/alertas "src/app/(app)/configuracoes/sf-alertas"`
Expected: PASS em todos os arquivos (os de domínio novos e antigos, os de aplicação/infra e o `regra-form.test.tsx` — o formulário ainda não manda `tipo`, e sem tipo a validação assume `aprovacao`).

- [ ] **Step 13: Commit**

```bash
git add src/modules/alertas/domain/tipos.ts src/modules/alertas/domain/tempo.ts src/modules/alertas/domain/taxa.ts \
  src/modules/alertas/domain/regra.ts src/modules/alertas/domain/mensagens.ts src/modules/alertas/domain/envio.ts \
  src/modules/alertas/domain/ocorrencia.ts src/modules/alertas/domain/erros.ts \
  src/modules/alertas/domain/__tests__/tempo.test.ts src/modules/alertas/domain/__tests__/regra-tipos.test.ts \
  src/modules/alertas/domain/__tests__/mensagens-tipos.test.ts src/modules/alertas/domain/__tests__/envio-tipos.test.ts \
  src/modules/alertas/domain/__tests__/ocorrencia-tipos.test.ts src/modules/alertas/domain/__tests__/regra.test.ts
git commit -m "feat(alertas): domínio dos tipos de regra (tempo médio, defeito repetido), mm:ss e textos por tipo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: 0115 parte A — colunas e checks por tipo, ocorrência com defeito, `usuario_tem_permissao`, `alerta_pmos`

**Files:**
- Create: `supabase/migrations/0115_alertas_tipos.sql`
- Modify: `supabase/tests/_stubs.sql`
- Modify: `supabase/tests/rodar-alertas-test.sh`
- Test: `supabase/tests/alertas_tipos_test.sql` (criar)

**Interfaces:**
- Consumes: tabelas e funções da 0113 (`alerta_regras`, `alerta_ocorrencias`, `alerta_contas`, `alerta_avaliar()`); `perfil_permissao (perfil_id, modulo, permissao)` e `usuarios.perfil_id` (0001/0038 no banco real, stub no teste); `sf_ordens (pmo, op)`.
- Produces:
  - `alerta_regras`: `tipo text not null default 'aprovacao'`, `limite_tempo_seg int`, `limite_ocorrencias int`, `pausa_max_min int`, `pmos text[] not null default '{}'`; `taxa_minima` e `minimo_bipes` aceitam nulo; constraints `alerta_regras_tipo_valido`, `alerta_regras_campos_por_tipo`, `alerta_regras_pmos_sem_nulo`; trigger `alerta_regras_tipo_fixo` (erro `TIPO_FIXO`).
  - `alerta_ocorrencias`: `defeito text`, `valor_abertura numeric(12,2)`, `valor_ultimo numeric(12,2)`, `amostras int`; `taxa_abertura`/`taxa_ultima` aceitam nulo; índice único `alerta_ocorrencias_viva_defeito (regra_id, posto, coalesce(defeito, '')) where estado in ('aberta','resolvida')` (o `alerta_ocorrencias_viva` antigo some).
  - `public.usuario_tem_permissao(p_usuario uuid, p_modulo text, p_perm text) returns boolean` — só `service_role` executa direto (as funções `security definer` de alerta chamam como dono).
  - `public.alerta_pmos() returns text[]` — `shopfloor.administrar`; PMOs distintas de `sf_ordens`, ordenadas, sem vazio.
  - Arquivo de teste `supabase/tests/alertas_tipos_test.sql` com os helpers `teste_regra(...) returns uuid` e `teste_regra_recusada(...)` (usados nas Tasks 3 e 4) e o perfil `Gestor` (`...a1`, com `shopfloor.administrar`) / `Operador` (`...a2`, sem).

- [ ] **Step 1: Stubs — `supabase/tests/_stubs.sql`**

Troque o bloco:

```sql
create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  posto text not null,
  pmo text not null default '',
  op text not null default '',
  status text not null default ''
);

grant select on public.usuarios, public.sf_registros to anon, authenticated, service_role;
```

por:

```sql
-- RBAC por módulo (0001/0038): o perfil do usuário e as permissões de cada perfil. A 0115 lê isto
-- em usuario_tem_permissao (permissão do DESTINATÁRIO, não de quem chama).
create table public.perfis (
  id uuid primary key,
  nome text not null default ''
);
create table public.perfil_permissao (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  modulo    text not null,
  permissao text not null,
  primary key (perfil_id, modulo, permissao)
);

create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true,
  -- nulo no stub (no banco real é not null): os testes da 0113 criam usuários sem perfil
  perfil_id uuid references public.perfis(id)
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  posto text not null,
  pmo text not null default '',
  op text not null default '',
  status text not null default '',
  codigo_defeito text not null default ''
);

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null
);

grant select on public.usuarios, public.sf_registros, public.sf_ordens, public.perfis, public.perfil_permissao
  to anon, authenticated, service_role;
```

- [ ] **Step 2: Runner — `supabase/tests/rodar-alertas-test.sh`**

No comentário do topo, troque:

```bash
# A 0113 é aplicada com `psql -1 -v ON_ERROR_STOP=1 -f`, exatamente como roda no RDS — assim o
# teste também garante que a migração passa inteira como transação única. A 0114 usa `create index
# concurrently`, que não roda dentro de transação nenhuma (nem com -1), então vai à parte, sem -1.
```

por:

```bash
# A 0113 é aplicada com `psql -1 -v ON_ERROR_STOP=1 -f`, exatamente como roda no RDS — assim o
# teste também garante que a migração passa inteira como transação única. A 0114 usa `create index
# concurrently`, que não roda dentro de transação nenhuma (nem com -1), então vai à parte, sem -1.
# Depois dos testes da 0113, a 0115 (tipos de regra) é aplicada POR CIMA, com -1 e DUAS VEZES
# (prova que é idempotente e que migra dados de verdade da 0113), e roda alertas_tipos_test.sql.
```

E troque a última linha do arquivo:

```bash
echo "ALERTAS SQL OK"
```

por:

```bash
# ---------- 0115: tipos de regra, destinatários do ShopFloor, filtro de PMO ----------
docker cp supabase/migrations/0115_alertas_tipos.sql "$NOME":/tmp/0115.sql
docker cp supabase/tests/alertas_tipos_test.sql "$NOME":/tmp/teste_tipos.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0115.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0115.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_tipos.sql
echo "0115 (tipos de regra): ok"

echo "ALERTAS SQL OK"
```

- [ ] **Step 3: Escrever o teste que falha — criar `supabase/tests/alertas_tipos_test.sql`**

```sql
-- Testes SQL da 0115 (tipos de regra, destinatários do ShopFloor, filtro de PMO). Rodar com
-- supabase/tests/rodar-alertas-test.sh: roda DEPOIS de alertas_test.sql, na mesma base, com a 0115
-- aplicada por cima da 0113/0114 (igual à produção, onde a 0113 já tem regras e ocorrências).
--
-- Duas réguas de permissão, de propósito:
--   tem_permissao(...)         -> stub de SESSÃO (teste.perms): é QUEM CHAMA (a tela);
--   usuario_tem_permissao(...) -> real, lê perfil_permissao pelo usuarios.perfil_id: é o
--                                 DESTINATÁRIO listado na regra.

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- T1. Migração: tudo o que já existia virou 'aprovacao', sem PMO, e as ocorrências antigas ganharam
--     valor_abertura/valor_ultimo iguais à taxa e amostras = aprovados + reprovados.
do $t$
begin
  if not exists (select 1 from alerta_regras) then
    raise exception 'FALHOU: sem regras antigas para conferir a migração';
  end if;
  if exists (select 1 from alerta_regras where tipo <> 'aprovacao' or pmos <> '{}'::text[]) then
    raise exception 'FALHOU: regra antiga não virou aprovacao sem PMO';
  end if;
  if not exists (select 1 from alerta_ocorrencias) then
    raise exception 'FALHOU: sem ocorrências antigas para conferir a migração';
  end if;
  if exists (select 1 from alerta_ocorrencias
              where valor_abertura is distinct from taxa_abertura
                 or valor_ultimo is distinct from taxa_ultima
                 or amostras is distinct from aprovados + reprovados
                 or defeito is not null) then
    raise exception 'FALHOU: backfill das ocorrências antigas';
  end if;
  if exists (select 1 from pg_indexes where indexname = 'alerta_ocorrencias_viva') then
    raise exception 'FALHOU: índice único antigo (sem defeito) continua lá';
  end if;
end $t$;

-- Preparação: desliga as regras dos testes da 0113 e encerra as ocorrências vivas delas; a fila
-- antiga sai do caminho (tentativas = 3 = desistiu).
update public.alerta_regras set ativa = false where ativa;
set role service_role;
do $t$ begin perform alerta_avaliar(); end $t$;
reset role;
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;

-- Perfis: Gestor administra o ShopFloor; Operador não (administrar de OUTRO módulo não vale).
insert into public.perfis (id, nome) values
  ('00000000-0000-0000-0000-0000000000a1', 'Gestor'),
  ('00000000-0000-0000-0000-0000000000a2', 'Operador');
insert into public.perfil_permissao (perfil_id, modulo, permissao) values
  ('00000000-0000-0000-0000-0000000000a1', 'shopfloor', 'visualizar'),
  ('00000000-0000-0000-0000-0000000000a1', 'shopfloor', 'administrar'),
  ('00000000-0000-0000-0000-0000000000a2', 'shopfloor', 'visualizar'),
  ('00000000-0000-0000-0000-0000000000a2', 'shopfloor', 'lancar'),
  ('00000000-0000-0000-0000-0000000000a2', 'recebimento', 'administrar');
-- Ana, Bruno e os inativos (Zeca, Dora) = Gestor; Carla = Operador.
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a1'
 where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
              '00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000010');
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a2'
 where id = '00000000-0000-0000-0000-000000000003';
-- Carla ganha Telegram: assim, quando ela ficar fora da fila, é pela PERMISSÃO, não por falta de conta.
insert into public.alerta_contas (usuario_id, canal, externo_id)
values ('00000000-0000-0000-0000-000000000003', 'telegram', 'T3')
on conflict (usuario_id, canal) do nothing;

insert into public.sf_ordens (pmo, op) values ('PMOB', '1'), ('PMOA', '1'), ('PMOA', '2'), ('', '3');

-- Helper: cria uma regra (Ana e Bruno como destinatários por padrão, Telegram + Discord).
create function public.teste_regra(
  p_nome text, p_tipo text, p_postos text[], p_taxa numeric, p_janela_tipo text, p_janela_valor int,
  p_minimo int, p_limite_tempo int, p_limite_oc int, p_pausa int,
  p_pmos text[] default '{}', p_lembrete int default null, p_ativa boolean default true,
  p_destinatarios uuid[] default array['00000000-0000-0000-0000-000000000001',
                                       '00000000-0000-0000-0000-000000000002']::uuid[]
) returns uuid language sql as $f$
  insert into public.alerta_regras
    (nome, tipo, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, limite_tempo_seg,
     limite_ocorrencias, pausa_max_min, pmos, lembrete_min, canais, destinatarios, ativa, criado_por)
  values (p_nome, p_tipo, p_postos, p_taxa, p_janela_tipo, p_janela_valor, p_minimo, p_limite_tempo,
          p_limite_oc, p_pausa, p_pmos, p_lembrete, array['telegram', 'discord'], p_destinatarios,
          p_ativa, '00000000-0000-0000-0000-000000000001')
  returning id
$f$;

-- Helper: a regra TEM que ser recusada pelo check (check_violation); se passar, o teste falha.
create function public.teste_regra_recusada(
  p_rotulo text, p_tipo text, p_taxa numeric, p_janela_tipo text, p_janela_valor int,
  p_minimo int, p_limite_tempo int, p_limite_oc int, p_pausa int
) returns void language plpgsql as $f$
begin
  begin
    perform public.teste_regra('Recusada', p_tipo, array['X'], p_taxa, p_janela_tipo, p_janela_valor,
                               p_minimo, p_limite_tempo, p_limite_oc, p_pausa, '{}', null, false);
  exception when check_violation then
    return;
  end;
  raise exception 'FALHOU: regra aceita (%)', p_rotulo;
end
$f$;

-- T2. Checks por tipo: cada tipo exige os seus campos e recusa os dos outros.
do $t$
begin
  perform teste_regra_recusada('aprovação sem taxa',            'aprovacao', null, 'tempo', 60,   20,   null, null, null);
  perform teste_regra_recusada('aprovação com limite de tempo', 'aprovacao', 90,   'tempo', 60,   20,   120,  null, null);
  perform teste_regra_recusada('aprovação sem mínimo',          'aprovacao', 90,   'tempo', 60,   null, null, null, null);
  perform teste_regra_recusada('tempo com janela por bipes',    'tempo',     null, 'bipes', 50,   10,   120,  null, 30);
  perform teste_regra_recusada('tempo sem pausa',               'tempo',     null, 'tempo', 60,   10,   120,  null, null);
  perform teste_regra_recusada('tempo com pausa 241',           'tempo',     null, 'tempo', 60,   10,   120,  null, 241);
  perform teste_regra_recusada('tempo com limite 3601 s',       'tempo',     null, 'tempo', 60,   10,   3601, null, 30);
  perform teste_regra_recusada('tempo sem limite',              'tempo',     null, 'tempo', 60,   10,   null, null, 30);
  perform teste_regra_recusada('tempo com taxa',                'tempo',     90,   'tempo', 60,   10,   120,  null, 30);
  perform teste_regra_recusada('tempo sem mínimo',              'tempo',     null, 'tempo', 60,   null, 120,  null, 30);
  perform teste_regra_recusada('defeito com janela op',         'defeito',   null, 'op',    null, null, null, 3,    null);
  perform teste_regra_recusada('defeito com limite 1',          'defeito',   null, 'tempo', 60,   null, null, 1,    null);
  perform teste_regra_recusada('defeito com mínimo de bipes',   'defeito',   null, 'tempo', 60,   20,   null, 3,    null);
  perform teste_regra_recusada('defeito com pausa',             'defeito',   null, 'tempo', 60,   null, null, 3,    30);
  perform teste_regra_recusada('tipo desconhecido',             'xyz',       90,   'tempo', 60,   20,   null, null, null);
end $t$;

-- T2b. O default de minimo_bipes (20, da 0113) NÃO serve pra defeito: quem grava manda null.
do $t$
begin
  begin
    insert into alerta_regras (nome, tipo, postos, janela_tipo, janela_valor, limite_ocorrencias, canais,
                               destinatarios, ativa)
    values ('Default', 'defeito', array['X'], 'tempo', 60, 3, array['telegram'],
            array['00000000-0000-0000-0000-000000000001']::uuid[], false);
    raise exception 'FALHOU: defeito aceitou o mínimo de bipes padrão (20)';
  exception when check_violation then
    null;
  end;
  -- PMO nula dentro da lista
  begin
    perform teste_regra('PMO nula', 'aprovacao', array['X'], 90, 'tempo', 60, 20, null, null, null,
                        array['PMOA', null], null, false);
    raise exception 'FALHOU: aceitou PMO nula';
  exception when check_violation then
    null;
  end;
end $t$;

-- T3. Regras válidas de cada tipo; o tipo não muda depois de criado (TIPO_FIXO), os outros campos sim.
do $t$
declare v uuid;
begin
  perform teste_regra('Válida tempo',    'tempo',   array['X'], null, 'tempo', 60,    10,   120,  null, 30,  '{}',           null, false);
  perform teste_regra('Válida tempo OP', 'tempo',   array['X'], null, 'op',    null,  10,   3600, null, 1,   array['PMOA'],  null, false);
  v := teste_regra('Válida defeito',     'defeito', array['X'], null, 'tempo', 10080, null, null, 2,    null, '{}',          null, false);
  begin
    update alerta_regras set tipo = 'aprovacao', taxa_minima = 90, minimo_bipes = 20, limite_ocorrencias = null
     where id = v;
    raise exception 'FALHOU: o tipo da regra mudou';
  exception when others then
    if sqlerrm not like '%TIPO_FIXO%' then raise; end if;
  end;
  update alerta_regras set limite_ocorrencias = 4 where id = v;
  if (select limite_ocorrencias from alerta_regras where id = v) <> 4 then
    raise exception 'FALHOU: não editou o limite da regra de defeito';
  end if;
end $t$;

-- T4. Índice único: uma ocorrência viva por regra x posto x DEFEITO (sem defeito = '').
do $t$
declare g uuid;
begin
  select id into g from alerta_regras where nome = 'Válida defeito';
  insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '2040 A', 3, 3);
  insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '1002 B', 3, 3);
  begin
    insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '2040 A', 5, 5);
    raise exception 'FALHOU: duas ocorrências vivas do mesmo defeito';
  exception when unique_violation then
    null;
  end;
  insert into alerta_ocorrencias (regra_id, posto, valor_abertura, valor_ultimo) values (g, 'Y', 1, 1);
  begin
    insert into alerta_ocorrencias (regra_id, posto, valor_abertura, valor_ultimo) values (g, 'Y', 2, 2);
    raise exception 'FALHOU: duas ocorrências vivas sem defeito na mesma regra x posto';
  exception when unique_violation then
    null;
  end;
  -- encerrada não conta: o mesmo defeito pode abrir de novo
  update alerta_ocorrencias set estado = 'normalizada', normalizada_em = now() where regra_id = g;
  insert into alerta_ocorrencias (regra_id, posto, defeito, valor_abertura, valor_ultimo) values (g, 'X', '2040 A', 3, 3);
  update alerta_ocorrencias set estado = 'normalizada', normalizada_em = now()
   where regra_id = g and estado = 'aberta';
end $t$;

-- T5. usuario_tem_permissao: olha o perfil do USUÁRIO LISTADO (não quem chama), só ativo, só o módulo pedido.
do $t$
begin
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: Ana (Gestor) sem administrar';
  end if;
  if usuario_tem_permissao('00000000-0000-0000-0000-000000000003', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: Carla (Operador) com administrar do ShopFloor';
  end if;
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000003', 'recebimento', 'administrar') then
    raise exception 'FALHOU: a checagem não respeita o módulo';
  end if;
  if usuario_tem_permissao('00000000-0000-0000-0000-000000000010', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: Dora (inativa) com permissão';
  end if;
  if usuario_tem_permissao(null, 'shopfloor', 'administrar')
     or usuario_tem_permissao('00000000-0000-0000-0000-000000000099', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: usuário nulo/inexistente com permissão';
  end if;
end $t$;
-- quem chama sem permissão nenhuma (teste.perms vazio) não muda a resposta sobre a Ana
select set_config('teste.perms', '', false);
do $t$
begin
  if not usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar') then
    raise exception 'FALHOU: usuario_tem_permissao dependeu de quem chama';
  end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
-- e a tela (authenticated) não chama direto: é função de servidor
set role authenticated;
do $t$
begin
  begin
    perform usuario_tem_permissao('00000000-0000-0000-0000-000000000001', 'shopfloor', 'administrar');
    raise exception 'FALHOU: authenticated executou usuario_tem_permissao';
  exception when insufficient_privilege then
    null;
  end;
end $t$;

-- T6. alerta_pmos: distintas, ordenadas, sem vazio; só com administrar.
do $t$
begin
  if alerta_pmos() is distinct from array['PMOA', 'PMOB'] then
    raise exception 'FALHOU: alerta_pmos %', alerta_pmos();
  end if;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  begin
    perform alerta_pmos();
    raise exception 'FALHOU: alerta_pmos sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
reset role;
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-alertas-test.sh`
Expected: os testes da 0113 passam ("trava do alerta_avaliar: ok" ...) e o script para com erro no `docker cp` de `supabase/migrations/0115_alertas_tipos.sql` ("no such file or directory"), sem imprimir `ALERTAS SQL OK`.

- [ ] **Step 5: Criar `supabase/migrations/0115_alertas_tipos.sql` (parte A)**

```sql
-- =============================================================
-- ALERTAS — TIPOS DE REGRA, DESTINATÁRIOS DO SHOPFLOOR E FILTRO DE PMO
-- Spec: docs/superpowers/specs/2026-09-18-alertas-tipos-de-regra-design.md
--
-- Aplica POR CIMA da 0113/0114 (já em produção — a 0113 NÃO é editada). Idempotente: rodar de
-- novo não quebra (add column if not exists, drop ... if exists antes de recriar).
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql
--
-- O que muda:
--   A. alerta_regras ganha tipo ('aprovacao' | 'tempo' | 'defeito') + os campos de cada tipo +
--      pmos; a ocorrência ganha defeito e valores genéricos; usuario_tem_permissao; alerta_pmos.
--   B. alerta_avaliar decide os 3 tipos (alerta_taxas com PMO, alerta_tempos, alerta_defeitos);
--      alerta_previa e alerta_listar_ocorrencias novas.
--   C. Destinatário = usuário ativo com shopfloor.administrar no PERFIL DELE: na lista da tela, na
--      fila, na reserva e no botão Resolvido.
--
-- Convenções (as mesmas da 0113): corpo de função com $func$ (o SQL Editor não aceita dois
-- cifrões, nem em comentário); grants e revokes explícitos; notify pgrst na última linha.
-- =============================================================

-- ---------- A1. Regras: tipo, campos de cada tipo e PMOs ----------
alter table public.alerta_regras
  add column if not exists tipo               text   not null default 'aprovacao',
  add column if not exists limite_tempo_seg   int,
  add column if not exists limite_ocorrencias int,
  add column if not exists pausa_max_min      int,
  add column if not exists pmos               text[] not null default '{}'::text[];

-- Cada tipo usa só os seus campos: taxa_minima e minimo_bipes deixam de ser obrigatórios. (O
-- default 20 de minimo_bipes fica — quem grava regra de defeito manda null explícito.)
alter table public.alerta_regras alter column taxa_minima  drop not null;
alter table public.alerta_regras alter column minimo_bipes drop not null;

alter table public.alerta_regras drop constraint if exists alerta_regras_tipo_valido;
alter table public.alerta_regras add constraint alerta_regras_tipo_valido
  check (tipo in ('aprovacao', 'tempo', 'defeito'));

-- coalesce(..., false): sem ele, um campo NULO faria a expressão dar NULL — e check com NULL PASSA.
alter table public.alerta_regras drop constraint if exists alerta_regras_campos_por_tipo;
alter table public.alerta_regras add constraint alerta_regras_campos_por_tipo check (coalesce(
  case tipo
    when 'aprovacao' then
          taxa_minima is not null and minimo_bipes is not null
      and limite_tempo_seg is null and limite_ocorrencias is null and pausa_max_min is null
    when 'tempo' then
          janela_tipo in ('tempo', 'op')
      and limite_tempo_seg between 1 and 3600
      and minimo_bipes is not null
      and pausa_max_min between 1 and 240
      and taxa_minima is null and limite_ocorrencias is null
    when 'defeito' then
          janela_tipo = 'tempo'
      and limite_ocorrencias >= 2
      and taxa_minima is null and minimo_bipes is null
      and limite_tempo_seg is null and pausa_max_min is null
  end, false));

alter table public.alerta_regras drop constraint if exists alerta_regras_pmos_sem_nulo;
alter table public.alerta_regras add constraint alerta_regras_pmos_sem_nulo
  check (array_position(pmos, null) is null);

-- O tipo não muda depois de criado (spec §1, decisão 2). Trigger, não policy: a policy de update não
-- enxerga a linha antiga.
create or replace function public.alerta_regras_tipo_fixo()
returns trigger
language plpgsql
as $func$
begin
  if new.tipo is distinct from old.tipo then
    raise exception 'TIPO_FIXO';
  end if;
  return new;
end
$func$;

drop trigger if exists alerta_regras_tipo_fixo on public.alerta_regras;
create trigger alerta_regras_tipo_fixo
  before update on public.alerta_regras
  for each row execute function public.alerta_regras_tipo_fixo();

-- ---------- A2. Ocorrências: defeito + valores genéricos ----------
-- valor_* = o que foi medido na régua do tipo: aprovação = taxa (%), tempo = média (segundos),
-- defeito = contagem. amostras = bipes com resultado (aprovação), peças (tempo) ou vezes (defeito).
-- taxa_abertura/taxa_ultima continuam (só aprovação) para não quebrar nada que já lê essas colunas.
alter table public.alerta_ocorrencias
  add column if not exists defeito        text,
  add column if not exists valor_abertura numeric(12,2),
  add column if not exists valor_ultimo   numeric(12,2),
  add column if not exists amostras       int;
alter table public.alerta_ocorrencias alter column taxa_abertura drop not null;
alter table public.alerta_ocorrencias alter column taxa_ultima   drop not null;

-- Ocorrências de antes da 0115 (todas de aprovação): copia a taxa para os valores genéricos.
update public.alerta_ocorrencias
   set valor_abertura = taxa_abertura,
       valor_ultimo   = taxa_ultima,
       amostras       = aprovados + reprovados
 where valor_abertura is null and taxa_abertura is not null;

-- Uma ocorrência viva por regra x posto x DEFEITO (tipos sem defeito: ''). Cada defeito que passa do
-- limite abre a SUA ocorrência. O índice antigo (regra x posto) impediria isso — sai.
drop index if exists public.alerta_ocorrencias_viva;
create unique index if not exists alerta_ocorrencias_viva_defeito
  on public.alerta_ocorrencias (regra_id, posto, coalesce(defeito, ''))
  where estado in ('aberta', 'resolvida');

-- ---------- A3. usuario_tem_permissao(): a permissão de UM USUÁRIO (não de quem chama) ----------
-- Mesma régua da tem_permissao(text, text) da 0043 (perfil_permissao pelo usuarios.perfil_id, só
-- usuário ativo), mas para o usuário informado: é assim que a fila sabe se o DESTINATÁRIO ainda
-- administra o ShopFloor. Só o servidor chama direto; as funções de alerta (security definer)
-- chamam como dono.
create or replace function public.usuario_tem_permissao(p_usuario uuid, p_modulo text, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $func$
  select exists (
    select 1
      from public.usuarios u
      join public.perfil_permissao pp on pp.perfil_id = u.perfil_id
     where u.id = p_usuario
       and u.ativo
       and pp.modulo = p_modulo
       and pp.permissao = p_perm
  )
$func$;

revoke all on function public.usuario_tem_permissao(uuid, text, text) from public, anon, authenticated;
grant execute on function public.usuario_tem_permissao(uuid, text, text) to service_role;

-- ---------- A4. alerta_pmos(): as PMOs que o formulário oferece ----------
-- Um array só (não uma linha por PMO): o PostgREST corta resultado em 1000 linhas, e um valor único
-- não é cortado.
create or replace function public.alerta_pmos()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $func$
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return (
    select coalesce(array_agg(x.pmo order by x.pmo), '{}'::text[])
      from (select distinct btrim(o.pmo) as pmo from public.sf_ordens o where btrim(o.pmo) <> '') x
  );
end
$func$;

revoke all on function public.alerta_pmos() from public, anon;
grant execute on function public.alerta_pmos() to authenticated, service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 6: Rodar e ver passar**

Run: `bash supabase/tests/rodar-alertas-test.sh`
Expected: termina com `0115 (tipos de regra): ok` e `ALERTAS SQL OK` (a 0115 aplicada duas vezes sem erro).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0115_alertas_tipos.sql supabase/tests/_stubs.sql supabase/tests/rodar-alertas-test.sh \
  supabase/tests/alertas_tipos_test.sql
git commit -m "feat(alertas): 0115 parte A — tipo da regra, campos e checks por tipo, ocorrência por defeito, usuario_tem_permissao, alerta_pmos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: 0115 parte B — cálculo por tipo, filtro de PMO, `alerta_avaliar`, `alerta_previa` e listagem

**Files:**
- Modify: `supabase/migrations/0115_alertas_tipos.sql` (inserir a parte B **antes** da linha final `notify pgrst, 'reload schema';`)
- Test: `supabase/tests/alertas_tipos_test.sql` (acrescentar no fim)

**Interfaces:**
- Consumes: parte A (Task 2): colunas `tipo`, `limite_tempo_seg`, `limite_ocorrencias`, `pausa_max_min`, `pmos`; `alerta_ocorrencias.defeito/valor_abertura/valor_ultimo/amostras`; índice `alerta_ocorrencias_viva_defeito`; helpers de teste `teste_regra(...)`; helper da 0113 `teste_bipes(p_posto, p_pmo, p_op, p_aprovados, p_reprovados, p_minutos_atras)`.
- Produces (internas, sem grant): `alerta_ultima_op(p_posto text, p_pmos text[]) returns table (pmo text, op text)`; `alerta_taxas(p_postos text[], p_janela_tipo text, p_janela_valor int, p_pmos text[]) returns table (posto text, aprovados int, reprovados int, pmo text, op text)`; `alerta_tempos(p_postos text[], p_janela_tipo text, p_janela_valor int, p_pausa_max_min int, p_pmos text[]) returns table (posto text, intervalos int, media_seg numeric, pecas int, pmo text, op text)`; `alerta_defeitos(p_postos text[], p_janela_min int, p_pmos text[]) returns table (posto text, defeito text, ocorrencias int)`.
- Produces (com grant, usados pela Task 5):
  - `alerta_avaliar() returns jsonb` — mesmo retorno; `alerta_envios.dados` agora com `regra_tipo` + chaves do tipo (ver Task 1, `envio.ts`).
  - `alerta_previa(p_tipo text, p_postos text[], p_janela_tipo text, p_janela_valor int, p_minimo int, p_pausa_max_min int, p_limite_ocorrencias int, p_pmos text[]) returns table (posto text, defeito text, aprovados int, reprovados int, taxa numeric, media_seg numeric, intervalos int, pecas int, ocorrencias int, avaliavel boolean, pmo text, op text)` — `authenticated`/`service_role`, `shopfloor.administrar`; erros `SEM_PERMISSAO`, `TIPO_INVALIDO`, `JANELA_INVALIDA`, `PAUSA_INVALIDA`, `LIMITE_INVALIDO`.
  - `alerta_listar_ocorrencias(p_de timestamptz, p_ate timestamptz, p_estado text default '')` — mesmas colunas de antes **+** `regra_tipo text, defeito text, valor_abertura numeric, valor_ultimo numeric, amostras int` (no fim).

- [ ] **Step 1: Escrever os testes que falham — acrescentar no fim de `supabase/tests/alertas_tipos_test.sql`**

```sql
-- =====================================================================
-- Tipos de regra: cálculo, transições e filtro de PMO (0115 parte B)
-- =====================================================================

-- Helpers. teste_ritmo: N bipes aprovados a cada P segundos, começando S segundos atrás.
create function public.teste_ritmo(
  p_posto text, p_pmo text, p_op text, p_qtd int, p_passo_seg int, p_inicio_seg_atras int
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status)
  select now() - make_interval(secs => p_inicio_seg_atras) + make_interval(secs => p_passo_seg * (g - 1)),
         p_posto, p_pmo, p_op, 'Aprovado'
    from generate_series(1, p_qtd) g;
$f$;

-- teste_defeitos: N linhas com um código de defeito e um status, M minutos atrás.
create function public.teste_defeitos(
  p_posto text, p_pmo text, p_codigo text, p_qtd int, p_status text, p_minutos_atras int
) returns void language sql as $f$
  insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito)
  select now() - make_interval(mins => p_minutos_atras) - make_interval(secs => g),
         p_posto, p_pmo, '1', p_status, p_codigo
    from generate_series(1, p_qtd) g;
$f$;

-- teste_fila: o que a avaliação desta transação pôs na fila para regra x posto x defeito — os
-- `dados` da primeira linha + tipo, ocorrência e n = quantas linhas (destinatário x canal).
-- plpgsql (não sql) de propósito, como o teste_acao da 0113.
create function public.teste_fila(p_regra text, p_posto text, p_defeito text default null) returns jsonb
language plpgsql as $f$
declare v jsonb;
begin
  with x as (
    select e.*
      from public.alerta_envios e
      join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
      join public.alerta_regras rg on rg.id = oc.regra_id
     where e.criado_em = now()
       and rg.nome = p_regra and oc.posto = p_posto
       and coalesce(oc.defeito, '') = coalesce(p_defeito, '')
       and e.tipo in ('alerta', 'lembrete', 'normalizou')
  )
  select x.dados || jsonb_build_object('tipo', x.tipo, 'ocorrencia_id', x.ocorrencia_id,
                                       'n', (select count(*) from x))
    into v
    from x
   order by x.usuario_id, x.canal
   limit 1;
  return v;
end
$f$;

-- Quantas linhas (destinatário x canal) a fila deve ter para Ana + Bruno.
create function public.teste_contas_ana_bruno() returns int language sql as $f$
  select count(*)::int from public.alerta_contas
   where usuario_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
     and canal in ('telegram', 'discord')
$f$;

-- As assinaturas antigas sumiram (senão o PostgREST não sabe qual chamar).
do $t$
begin
  if (select count(*) from pg_proc where proname = 'alerta_previa' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'alerta_taxas' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_proc where proname = 'alerta_listar_ocorrencias' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'FALHOU: assinatura antiga convivendo com a nova';
  end if;
  if not exists (select 1 from pg_proc where proname = 'alerta_previa' and pronargs = 8) then
    raise exception 'FALHOU: alerta_previa nova (8 parâmetros) não existe';
  end if;
end $t$;

-- ---------- Tempo médio por peça ----------
-- T-Lento: 11 bipes a cada 180 s (40 a 10 min atrás) = 10 intervalos, média 3:00.
select public.teste_ritmo('T-Lento', 'PMOA', '1', 11, 180, 2400);
-- Um bipe com 3 linhas de defeito grava 3 linhas com o MESMO data_hora: é UMA peça só.
insert into public.sf_registros (data_hora, posto, pmo, op, status, codigo_defeito)
select r.data_hora, r.posto, r.pmo, r.op, 'Reprovado', '2040 COMPONENTE FALTANDO'
  from public.sf_registros r where r.posto = 'T-Lento' order by r.data_hora limit 3;
-- T-Pausa: 6 bipes a cada 60 s (50 min atrás), PAUSA de 40 min, 6 bipes a cada 60 s (5 min atrás).
select public.teste_ritmo('T-Pausa', 'PMOA', '1', 6, 60, 3000);
select public.teste_ritmo('T-Pausa', 'PMOA', '1', 6, 60, 300);
-- T-Poucos: só 3 intervalos (mínimo da regra = 5).
select public.teste_ritmo('T-Poucos', 'PMOA', '1', 4, 300, 1800);

do $t$ begin
  perform teste_regra('Tempo 2:00', 'tempo', array['T-Lento', 'T-Pausa', 'T-Poucos'], null, 'tempo', 60, 5, 120, null, 30);
end $t$;

set role service_role;
do $t$
declare r jsonb; a jsonb;
begin
  r := alerta_avaliar();
  a := teste_fila('Tempo 2:00', 'T-Lento');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: tempo não alertou % %', r, a; end if;
  if a->>'regra_tipo' <> 'tempo' or (a->>'media_seg')::numeric <> 180 or (a->>'limite_tempo_seg')::numeric <> 120
     or (a->>'pecas')::int <> 11 or a->>'janela_tipo' <> 'tempo' or (a->>'janela_valor')::int <> 60
     or a->>'regra_nome' <> 'Tempo 2:00' then
    raise exception 'FALHOU: dados do alerta de tempo %', a;
  end if;
  if (a->>'n')::int <> teste_contas_ana_bruno() then raise exception 'FALHOU: linhas na fila %', a; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Tempo 2:00' and oc.posto = 'T-Lento' and oc.estado = 'aberta'
                    and oc.valor_abertura = 180 and oc.valor_ultimo = 180 and oc.amostras = 11
                    and oc.taxa_abertura is null and oc.defeito is null) then
    raise exception 'FALHOU: ocorrência de tempo';
  end if;
  -- a pausa de 40 min (> 30) sai da média: 60 s por peça, dentro do limite
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Tempo 2:00' and oc.posto = 'T-Pausa') then
    raise exception 'FALHOU: a pausa entrou na média';
  end if;
  -- 3 intervalos < mínimo 5: não decide
  if exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Tempo 2:00' and oc.posto = 'T-Poucos') then
    raise exception 'FALHOU: avaliou sem o mínimo de intervalos';
  end if;
end $t$;
reset role;

-- Prévia do tempo: pausa descartada, mínimo, e o efeito de NÃO descartar a pausa.
set role authenticated;
do $t$
declare p record;
begin
  select * into p from alerta_previa('tempo', array['T-Pausa', 'T-Poucos'], 'tempo', 60, 5, 30, null, '{}')
   where posto = 'T-Pausa';
  if not found or p.intervalos <> 10 or p.media_seg <> 60 or p.pecas <> 12 or p.avaliavel is not true then
    raise exception 'FALHOU: prévia T-Pausa %', p;
  end if;
  select * into p from alerta_previa('tempo', array['T-Pausa'], 'tempo', 60, 5, 240, null, '{}');
  if p.intervalos <> 11 or p.media_seg <= 120 then raise exception 'FALHOU: prévia sem descartar a pausa %', p; end if;
  select * into p from alerta_previa('tempo', array['T-Poucos'], 'tempo', 60, 5, 30, null, '{}');
  if p.intervalos <> 3 or p.avaliavel is not false then raise exception 'FALHOU: prévia T-Poucos %', p; end if;
end $t$;
reset role;

-- Normalizou: 20 bipes rápidos (10 s) logo depois do último lento (+60 s).
-- Média = (10 x 180 + 60 + 19 x 10) / 30 = 68,33 s.
insert into public.sf_registros (data_hora, posto, pmo, op, status)
select (select max(r.data_hora) from public.sf_registros r where r.posto = 'T-Lento')
         + make_interval(secs => 60 + 10 * (g - 1)),
       'T-Lento', 'PMOA', '1', 'Aprovado'
  from generate_series(1, 20) g;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Tempo 2:00', 'T-Lento');
  if a is null or a->>'tipo' <> 'normalizou' or (a->>'media_seg')::numeric <> 68.33 or (a->>'pecas')::int <> 31 then
    raise exception 'FALHOU: tempo não normalizou %', a;
  end if;
end $t$;
reset role;

-- Janela OP + PMO: o "último bipe do posto" considera só as PMOs da regra.
select public.teste_ritmo('T-OPF', 'PMOX', '7001', 11, 150, 1800);  -- 30 a 5 min atrás, 150 s/peça
select public.teste_ritmo('T-OPF', 'PMOY', '8001', 3, 10, 120);     -- o último bipe do posto é de OUTRA PMO
do $t$ begin
  perform teste_regra('Tempo OP PMOX', 'tempo', array['T-OPF'], null, 'op', null, 5, 120, null, 30, array['PMOX']);
  perform teste_regra('Tempo OP todas', 'tempo', array['T-OPF'], null, 'op', null, 5, 120, null, 30);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Tempo OP PMOX', 'T-OPF');
  if a is null or a->>'tipo' <> 'alerta' or a->>'pmo' <> 'PMOX' or a->>'op' <> '7001'
     or (a->>'media_seg')::numeric <> 150 or a->>'janela_tipo' <> 'op' then
    raise exception 'FALHOU: janela OP com filtro de PMO %', a;
  end if;
  -- sem filtro, a OP em andamento é a PMOY/8001 (só 2 intervalos): não decide
  if teste_fila('Tempo OP todas', 'T-OPF') is not null then raise exception 'FALHOU: OP sem filtro decidiu'; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Tempo OP PMOX' and oc.pmo = 'PMOX' and oc.op = '7001' and oc.estado = 'aberta') then
    raise exception 'FALHOU: ocorrência da janela OP sem PMO/OP';
  end if;
end $t$;
reset role;

-- Janela de minutos + PMO: PMOX a cada 200 s e PMOY intercalada (100 s depois de cada PMOX).
-- Todas as PMOs: 100 s por peça (normal). Só PMOX: 200 s por peça (lento).
select public.teste_ritmo('T-Mix', 'PMOX', '1', 11, 200, 2400);
select public.teste_ritmo('T-Mix', 'PMOY', '1', 10, 200, 2300);
do $t$ begin
  perform teste_regra('Tempo PMOX', 'tempo', array['T-Mix'], null, 'tempo', 60, 5, 120, null, 30, array['PMOX']);
  perform teste_regra('Tempo todas as PMOs', 'tempo', array['T-Mix'], null, 'tempo', 60, 5, 120, null, 30);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Tempo PMOX', 'T-Mix');
  if a is null or a->>'tipo' <> 'alerta' or (a->>'media_seg')::numeric <> 200 or (a->>'pecas')::int <> 11 then
    raise exception 'FALHOU: filtro de PMO no tempo %', a;
  end if;
  if teste_fila('Tempo todas as PMOs', 'T-Mix') is not null then
    raise exception 'FALHOU: sem filtro devia dar 100 s por peça (normal)';
  end if;
end $t$;
reset role;

-- ---------- Defeito repetido ----------
select public.teste_defeitos('D-Posto', 'PMOA', '2040 COMPONENTE FALTANDO', 3, 'Reprovado', 5);
select public.teste_defeitos('D-Posto', 'PMOA', '1002 TRILHA ROMPIDA',      4, 'REPROVADO', 10);
select public.teste_defeitos('D-Posto', 'PMOA', '777 SOLDA FRIA',           2, 'Reprovado', 5);
select public.teste_defeitos('D-Posto', 'PMOA', '777 SOLDA FRIA',           2, 'Aprovado',  5);   -- aprovado não conta
select public.teste_defeitos('D-Posto', 'PMOA', '777 SOLDA FRIA',           5, 'Reprovado', 90);  -- fora da janela
select public.teste_defeitos('D-Posto', 'PMOA', '',                         6, 'Reprovado', 5);   -- reprova sem código
do $t$ begin
  perform teste_regra('Defeito 3x', 'defeito', array['D-Posto'], null, 'tempo', 60, null, null, 3, null, '{}', 10);
end $t$;

-- Prévia: uma linha por defeito que chega a N; posto sem nenhum = uma linha com defeito nulo.
set role authenticated;
do $t$
declare v text;
begin
  select string_agg(posto || ':' || coalesce(defeito, '-') || ':' || ocorrencias, ' | '
                    order by posto, ocorrencias desc)
    into v
    from alerta_previa('defeito', array['D-Posto', 'D-Vazio'], 'tempo', 60, null, null, 3, '{}');
  if v is distinct from 'D-Posto:1002 TRILHA ROMPIDA:4 | D-Posto:2040 COMPONENTE FALTANDO:3 | D-Vazio:-:0' then
    raise exception 'FALHOU: prévia de defeitos %', v;
  end if;
end $t$;
reset role;

-- Dois códigos acima de N -> duas ocorrências e dois avisos; o 777 (2 reprovas na janela) não.
set role service_role;
do $t$
declare a jsonb; b jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO');
  b := teste_fila('Defeito 3x', 'D-Posto', '1002 TRILHA ROMPIDA');
  if a is null or a->>'tipo' <> 'alerta' or a->>'regra_tipo' <> 'defeito' or (a->>'ocorrencias')::int <> 3
     or (a->>'limite_ocorrencias')::int <> 3 or a->>'defeito' <> '2040 COMPONENTE FALTANDO'
     or (a->>'n')::int <> teste_contas_ana_bruno() then
    raise exception 'FALHOU: alerta do defeito 2040 %', a;
  end if;
  if b is null or b->>'tipo' <> 'alerta' or (b->>'ocorrencias')::int <> 4 then
    raise exception 'FALHOU: alerta do defeito 1002 %', b;
  end if;
  if teste_fila('Defeito 3x', 'D-Posto', '777 SOLDA FRIA') is not null then
    raise exception 'FALHOU: 777 alertou (aprovado/fora da janela contaram)';
  end if;
  if (select count(*) from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Defeito 3x' and oc.estado = 'aberta') <> 2 then
    raise exception 'FALHOU: devia ter 2 ocorrências abertas (uma por defeito)';
  end if;
end $t$;
-- Reavaliar sem mudança: nada novo na fila.
do $t$
begin
  perform alerta_avaliar();
  if teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO') is not null
     or teste_fila('Defeito 3x', 'D-Posto', '1002 TRILHA ROMPIDA') is not null then
    raise exception 'FALHOU: reavaliar sem mudança pôs algo na fila';
  end if;
end $t$;
reset role;

-- Lembrete por defeito: só o 1002 passou do intervalo.
update public.alerta_ocorrencias
   set ultimo_envio_em = now() - interval '11 minutes', aberta_em = now() - interval '11 minutes'
 where defeito = '1002 TRILHA ROMPIDA' and estado = 'aberta';
set role service_role;
do $t$
declare b jsonb;
begin
  perform alerta_avaliar();
  b := teste_fila('Defeito 3x', 'D-Posto', '1002 TRILHA ROMPIDA');
  if b is null or b->>'tipo' <> 'lembrete' or b->>'defeito' <> '1002 TRILHA ROMPIDA' then
    raise exception 'FALHOU: lembrete do defeito %', b;
  end if;
  if teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO') is not null then
    raise exception 'FALHOU: lembrete do 2040 antes da hora';
  end if;
end $t$;
reset role;

-- Normalização POR CÓDIGO: as reprovas do 2040 saem da janela; o 1002 continua aberto.
update public.sf_registros set data_hora = data_hora - interval '2 hours'
 where posto = 'D-Posto' and codigo_defeito = '2040 COMPONENTE FALTANDO';
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO');
  if a is null or a->>'tipo' <> 'normalizou' or (a->>'ocorrencias')::int <> 0 then
    raise exception 'FALHOU: 2040 não normalizou %', a;
  end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Defeito 3x' and oc.defeito = '2040 COMPONENTE FALTANDO'
                    and oc.estado = 'normalizada' and oc.valor_ultimo = 0) then
    raise exception 'FALHOU: ocorrência do 2040 não ficou normalizada com valor 0';
  end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Defeito 3x' and oc.defeito = '1002 TRILHA ROMPIDA' and oc.estado = 'aberta') then
    raise exception 'FALHOU: o 1002 não devia normalizar junto';
  end if;
end $t$;
reset role;

-- Caiu de novo: ocorrência NOVA do 2040.
select public.teste_defeitos('D-Posto', 'PMOA', '2040 COMPONENTE FALTANDO', 3, 'Reprovado', 1);
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito 3x', 'D-Posto', '2040 COMPONENTE FALTANDO');
  if a is null or a->>'tipo' <> 'alerta' then raise exception 'FALHOU: 2040 não reabriu %', a; end if;
  if (select count(*) from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
       where rg.nome = 'Defeito 3x' and oc.defeito = '2040 COMPONENTE FALTANDO') <> 2 then
    raise exception 'FALHOU: devia ter 2 ocorrências do 2040 (a normalizada e a nova)';
  end if;
end $t$;
reset role;

-- Defeito + PMO: 3 reprovas na PMOY e 2 na PMOX (limite 3).
select public.teste_defeitos('D-Mix', 'PMOY', '555 CURTO', 3, 'Reprovado', 5);
select public.teste_defeitos('D-Mix', 'PMOX', '555 CURTO', 2, 'Reprovado', 5);
do $t$ begin
  perform teste_regra('Defeito PMOX', 'defeito', array['D-Mix'], null, 'tempo', 60, null, null, 3, null, array['PMOX']);
  perform teste_regra('Defeito todas as PMOs', 'defeito', array['D-Mix'], null, 'tempo', 60, null, null, 3, null);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Defeito todas as PMOs', 'D-Mix', '555 CURTO');
  if a is null or (a->>'ocorrencias')::int <> 5 then raise exception 'FALHOU: defeito sem filtro %', a; end if;
  if teste_fila('Defeito PMOX', 'D-Mix', '555 CURTO') is not null then
    raise exception 'FALHOU: filtro de PMO no defeito contou a PMOY';
  end if;
end $t$;
reset role;

-- ---------- Taxa de aprovação + PMO ----------
select public.teste_bipes('A-Mix', 'PMOX', '1', 20, 0, 5);
select public.teste_bipes('A-Mix', 'PMOY', '1', 0, 20, 5);
do $t$ begin
  perform teste_regra('Taxa PMOX', 'aprovacao', array['A-Mix'], 90, 'tempo', 60, 10, null, null, null, array['PMOX']);
  perform teste_regra('Taxa todas as PMOs', 'aprovacao', array['A-Mix'], 90, 'tempo', 60, 10, null, null, null);
end $t$;
set role service_role;
do $t$
declare a jsonb;
begin
  perform alerta_avaliar();
  a := teste_fila('Taxa todas as PMOs', 'A-Mix');
  if a is null or a->>'tipo' <> 'alerta' or a->>'regra_tipo' <> 'aprovacao' or (a->>'taxa')::numeric <> 50
     or (a->>'aprovados')::int <> 20 or (a->>'reprovados')::int <> 20 or (a->>'taxa_minima')::numeric <> 90 then
    raise exception 'FALHOU: aprovação sem filtro %', a;
  end if;
  if teste_fila('Taxa PMOX', 'A-Mix') is not null then raise exception 'FALHOU: filtro de PMO na taxa'; end if;
  if not exists (select 1 from alerta_ocorrencias oc join alerta_regras rg on rg.id = oc.regra_id
                  where rg.nome = 'Taxa todas as PMOs' and oc.estado = 'aberta'
                    and oc.taxa_abertura = 50 and oc.valor_abertura = 50 and oc.amostras = 40) then
    raise exception 'FALHOU: ocorrência de aprovação sem taxa/valor/amostras';
  end if;
end $t$;
reset role;

-- Prévia da aprovação com PMO e janela OP: a OP é a do último bipe DA PMOX.
set role authenticated;
do $t$
declare p record;
begin
  select * into p from alerta_previa('aprovacao', array['A-Mix'], 'op', null, 10, null, null, array['PMOX']);
  if not found or p.pmo <> 'PMOX' or p.aprovados <> 20 or p.reprovados <> 0 or p.taxa <> 100
     or p.avaliavel is not true then
    raise exception 'FALHOU: prévia da aprovação com PMO %', p;
  end if;
end $t$;

-- Prévia: validações e permissão.
do $t$
begin
  begin
    perform * from alerta_previa('xyz', array['X'], 'tempo', 60, 1, null, null, '{}');
    raise exception 'FALHOU: tipo inválido na prévia';
  exception when others then
    if sqlerrm not like '%TIPO_INVALIDO%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('tempo', array['X'], 'bipes', 50, 5, 30, null, '{}');
    raise exception 'FALHOU: tempo com janela por bipes na prévia';
  exception when others then
    if sqlerrm not like '%JANELA_INVALIDA%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('defeito', array['X'], 'op', null, null, null, 3, '{}');
    raise exception 'FALHOU: defeito com janela OP na prévia';
  exception when others then
    if sqlerrm not like '%JANELA_INVALIDA%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('defeito', array['X'], 'tempo', 60, null, null, 1, '{}');
    raise exception 'FALHOU: defeito com limite 1 na prévia';
  exception when others then
    if sqlerrm not like '%LIMITE_INVALIDO%' then raise; end if;
  end;
  begin
    perform * from alerta_previa('tempo', array['X'], 'tempo', 60, 5, 0, null, '{}');
    raise exception 'FALHOU: tempo com pausa 0 na prévia';
  exception when others then
    if sqlerrm not like '%PAUSA_INVALIDA%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar', false);
do $t$
begin
  begin
    perform * from alerta_previa('tempo', array['T-Pausa'], 'tempo', 60, 5, 30, null, '{}');
    raise exception 'FALHOU: prévia sem administrar';
  exception when others then
    if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if;
  end;
end $t$;
select set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);

-- Listagem de ocorrências com tipo, defeito e valores.
do $t$
declare o record;
begin
  select * into o
    from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', 'aberta')
   where regra_nome = 'Defeito 3x' and defeito = '1002 TRILHA ROMPIDA';
  if not found or o.regra_tipo <> 'defeito' or o.valor_abertura <> 4 or o.valor_ultimo <> 4
     or o.amostras <> 4 or o.taxa_abertura is not null then
    raise exception 'FALHOU: listagem da ocorrência de defeito %', o;
  end if;
  select * into o
    from alerta_listar_ocorrencias(now() - interval '1 day', now() + interval '1 day', '')
   where regra_nome = 'Tempo OP PMOX';
  if not found or o.regra_tipo <> 'tempo' or o.valor_abertura <> 150 or o.amostras <> 11 or o.defeito is not null then
    raise exception 'FALHOU: listagem da ocorrência de tempo %', o;
  end if;
end $t$;
reset role;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-alertas-test.sh`
Expected: FAIL em `alertas_tipos_test.sql` com `FALHOU: assinatura antiga convivendo com a nova` ou `FALHOU: alerta_previa nova (8 parâmetros) não existe` (a parte B ainda não existe).

- [ ] **Step 3: Implementar a parte B — inserir no `0115_alertas_tipos.sql` ANTES da linha final `notify pgrst, 'reload schema';`**

```sql
-- ---------- B1. alerta_ultima_op(): a OP do último bipe do posto (só PMOs da regra) ----------
-- Função INTERNA (sem grant). Janela 'op': o último bipe do posto nas PMOs da regra (vazio = todas)
-- e só se ele tem menos de 2 horas.
create or replace function public.alerta_ultima_op(p_posto text, p_pmos text[])
returns table (pmo text, op text)
language sql
stable
security definer
set search_path = public
as $func$
  select r.pmo, r.op
    from sf_registros r
   where r.posto = p_posto
     and r.data_hora >= now() - interval '2 hours'
     and (coalesce(cardinality(p_pmos), 0) = 0 or r.pmo = any (p_pmos))
   order by r.data_hora desc
   limit 1
$func$;

revoke all on function public.alerta_ultima_op(text, text[]) from public, anon, authenticated, service_role;

-- ---------- B2. alerta_taxas(): aprovados/reprovados por posto, agora com filtro de PMO ----------
-- Função INTERNA. Ganhou p_pmos: a assinatura antiga (3 parâmetros) sai antes.
drop function if exists public.alerta_taxas(text[], text, int);
create or replace function public.alerta_taxas(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_pmos text[]
)
returns table (posto text, aprovados int, reprovados int, pmo text, op text)
language sql
stable
security definer
set search_path = public
as $func$
  select p.posto,
         coalesce(c.aprovados, 0)::int,
         coalesce(c.reprovados, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    left join lateral (
      select x.pmo, x.op from public.alerta_ultima_op(p.posto, p_pmos) x where p_janela_tipo = 'op'
    ) u on true
    left join lateral (
      select count(*) filter (where lower(y.status) = 'aprovado')  as aprovados,
             count(*) filter (where lower(y.status) = 'reprovado') as reprovados
        from (
          -- janela 'tempo': os bipes do posto nos últimos N minutos, de todas as OPs (das PMOs da regra)
          select r.status
            from sf_registros r
           where p_janela_tipo = 'tempo'
             and r.posto = p.posto
             and r.data_hora >= now() - make_interval(mins => p_janela_valor)
             and lower(r.status) in ('aprovado', 'reprovado')
             and (coalesce(cardinality(p_pmos), 0) = 0 or r.pmo = any (p_pmos))
          union all
          -- janela 'bipes': os N últimos bipes COM status do posto, olhando no máximo 30 dias
          (select r.status
             from sf_registros r
            where p_janela_tipo = 'bipes'
              and r.posto = p.posto
              and lower(r.status) in ('aprovado', 'reprovado')
              and r.data_hora >= now() - interval '30 days'
              and (coalesce(cardinality(p_pmos), 0) = 0 or r.pmo = any (p_pmos))
            order by r.data_hora desc
            limit p_janela_valor)
          union all
          -- janela 'op': todos os bipes do posto naquela OP (a OP já saiu das PMOs da regra)
          select r.status
            from sf_registros r
           where p_janela_tipo = 'op'
             and r.posto = p.posto
             and r.pmo = u.pmo and r.op = u.op
             and lower(r.status) in ('aprovado', 'reprovado')
        ) y
    ) c on true
$func$;

revoke all on function public.alerta_taxas(text[], text, int, text[]) from public, anon, authenticated, service_role;

-- ---------- B3. alerta_tempos(): cadência do posto (tempo médio entre bipes seguidos) ----------
-- Função INTERNA. Um BIPE = um data_hora distinto do posto (um bipe com várias linhas de defeito
-- grava todas com o mesmo data_hora — conta como uma peça só). Qualquer status entra. Intervalos
-- maiores que p_pausa_max_min (almoço, troca de turno, máquina parada) ficam FORA da média.
--   intervalos = intervalos válidos (o mínimo da regra olha para isto);
--   media_seg  = média dos válidos, truncada em 2 casas (null sem nenhum válido);
--   pecas      = bipes distintos na janela.
create or replace function public.alerta_tempos(
  p_postos text[], p_janela_tipo text, p_janela_valor int, p_pausa_max_min int, p_pmos text[]
)
returns table (posto text, intervalos int, media_seg numeric, pecas int, pmo text, op text)
language sql
stable
security definer
set search_path = public
as $func$
  select p.posto,
         coalesce(m.intervalos, 0)::int,
         m.media_seg,
         coalesce(m.pecas, 0)::int,
         u.pmo,
         u.op
    from unnest(p_postos) as p(posto)
    left join lateral (
      select x.pmo, x.op from public.alerta_ultima_op(p.posto, p_pmos) x where p_janela_tipo = 'op'
    ) u on true
    left join lateral (
      select count(g.seg) filter (where g.seg <= p_pausa_max_min * 60)         as intervalos,
             trunc(avg(g.seg) filter (where g.seg <= p_pausa_max_min * 60), 2) as media_seg,
             count(*)                                                           as pecas
        from (
          select extract(epoch from b.data_hora - lag(b.data_hora) over (order by b.data_hora)) as seg
            from (
              -- `union` (sem all) já tira os data_hora repetidos
              select r.data_hora
                from sf_registros r
               where p_janela_tipo = 'tempo'
                 and r.posto = p.posto
                 and r.data_hora >= now() - make_interval(mins => p_janela_valor)
                 and (coalesce(cardinality(p_pmos), 0) = 0 or r.pmo = any (p_pmos))
              union
              select r.data_hora
                from sf_registros r
               where p_janela_tipo = 'op'
                 and r.posto = p.posto
                 and r.pmo = u.pmo and r.op = u.op
            ) b
        ) g
    ) m on true
$func$;

revoke all on function public.alerta_tempos(text[], text, int, int, text[]) from public, anon, authenticated, service_role;

-- ---------- B4. alerta_defeitos(): o mesmo código de defeito repetido no posto ----------
-- Função INTERNA. Linhas REPROVADAS com código de defeito preenchido, nos últimos p_janela_min
-- minutos, por posto x código (cada linha conta uma vez). Só devolve códigos com pelo menos 1.
create or replace function public.alerta_defeitos(p_postos text[], p_janela_min int, p_pmos text[])
returns table (posto text, defeito text, ocorrencias int)
language sql
stable
security definer
set search_path = public
as $func$
  select r.posto, r.codigo_defeito, count(*)::int
    from sf_registros r
   where r.posto = any (p_postos)
     and r.data_hora >= now() - make_interval(mins => p_janela_min)
     and lower(r.status) = 'reprovado'
     and btrim(r.codigo_defeito) <> ''
     and (coalesce(cardinality(p_pmos), 0) = 0 or r.pmo = any (p_pmos))
   group by r.posto, r.codigo_defeito
$func$;

revoke all on function public.alerta_defeitos(text[], int, text[]) from public, anon, authenticated, service_role;

-- ---------- B5. alerta_avaliar(): decide os 3 tipos e põe os envios na fila ----------
-- Mesmo contrato da 0113: {"ocupado", "avaliadas", "enfileirados", "normalizadas": [uuid]}.
-- Cada tipo vira uma MEDIÇÃO por (regra, posto, defeito) com o mesmo formato; as transições
-- (abrir / lembrar / normalizar) são as mesmas para todos:
--   aprovacao: valor = taxa (%),   abaixo = valor <  taxa_minima,       avaliável = bipes >= mínimo
--   tempo:     valor = média (s),  abaixo = valor >  limite_tempo_seg,  avaliável = intervalos >= mínimo
--   defeito:   valor = contagem,   abaixo = valor >= limite_ocorrencias, sempre avaliável
-- No defeito, além dos códigos da janela, entram os códigos que têm ocorrência VIVA (com contagem 0
-- se sumiram da janela) — é assim que cada defeito normaliza sozinho.
create or replace function public.alerta_avaliar()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_agora        timestamptz := now();
  v_avaliadas    int := 0;
  v_enfileirados int := 0;
  v_n            int;
  v_normalizadas uuid[];
  v_abaixo       boolean;
  v_tipo         text;
  v_lembrete     boolean;
  v_dados        jsonb;
  t              record;
  o              public.alerta_ocorrencias;
begin
  -- Duas avaliações ao mesmo tempo (cron atrasado + "Avaliar agora") abririam a MESMA ocorrência
  -- duas vezes. A segunda simplesmente vai embora avisando que está ocupado.
  if not pg_try_advisory_xact_lock(hashtext('alerta_avaliar')) then
    return jsonb_build_object('ocupado', true, 'avaliadas', 0, 'enfileirados', 0,
                              'normalizadas', '[]'::jsonb);
  end if;

  -- Regra desativada, EXCLUÍDA ou posto tirado da regra: a ocorrência viva encerra SEM envio.
  with encerradas as (
    update public.alerta_ocorrencias oc
       set estado = 'normalizada', normalizada_em = v_agora
      from public.alerta_regras rg
     where rg.id = oc.regra_id
       and oc.estado in ('aberta', 'resolvida')
       and (rg.ativa is false or rg.excluida_em is not null or not (oc.posto = any (rg.postos)))
    returning oc.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_normalizadas from encerradas;

  for t in
    select m.*
      from (
        -- Taxa de aprovação
        select rg.id as regra_id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.criado_em,
               tx.posto, null::text as defeito, tx.pmo, tx.op,
               tx.aprovados, tx.reprovados,
               (tx.aprovados + tx.reprovados) as amostras,
               (tx.aprovados + tx.reprovados) >= rg.minimo_bipes as avaliavel,
               case when tx.aprovados + tx.reprovados > 0
                    then trunc((tx.aprovados * 100.0) / (tx.aprovados + tx.reprovados), 2)
               end as valor,
               rg.taxa_minima::numeric as limite
          from public.alerta_regras rg
          cross join lateral public.alerta_taxas(rg.postos, rg.janela_tipo, rg.janela_valor, rg.pmos) tx
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'aprovacao'
        union all
        -- Tempo médio por peça
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.criado_em,
               tp.posto, null::text, tp.pmo, tp.op,
               0, 0,
               tp.pecas,
               tp.intervalos >= rg.minimo_bipes and tp.media_seg is not null,
               tp.media_seg,
               rg.limite_tempo_seg::numeric
          from public.alerta_regras rg
          cross join lateral public.alerta_tempos(rg.postos, rg.janela_tipo, rg.janela_valor,
                                                  rg.pausa_max_min, rg.pmos) tp
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'tempo'
        union all
        -- Defeito repetido: os códigos da janela + os que têm ocorrência viva (contagem 0 se sumiram)
        select rg.id, rg.nome, rg.tipo, rg.janela_tipo, rg.janela_valor, rg.lembrete_min,
               rg.canais, rg.destinatarios, rg.criado_em,
               df.posto, df.defeito, null::text, null::text,
               0, 0,
               df.ocorrencias,
               true,
               df.ocorrencias::numeric,
               rg.limite_ocorrencias::numeric
          from public.alerta_regras rg
          cross join lateral (
            with d as (
              select x.posto, x.defeito, x.ocorrencias
                from public.alerta_defeitos(rg.postos, rg.janela_valor, rg.pmos) x
            )
            select d.posto, d.defeito, d.ocorrencias from d
            union all
            select oc.posto, oc.defeito, 0
              from public.alerta_ocorrencias oc
             where oc.regra_id = rg.id
               and oc.estado in ('aberta', 'resolvida')
               and not exists (select 1 from d where d.posto = oc.posto and d.defeito = oc.defeito)
          ) df
         where rg.ativa and rg.excluida_em is null and rg.tipo = 'defeito'
      ) m
     order by m.criado_em, m.regra_id, m.posto, m.defeito nulls first
  loop
    v_avaliadas := v_avaliadas + 1;
    -- Sem o mínimo (bipes ou intervalos), a regra não decide NADA (nem abre, nem normaliza).
    if not coalesce(t.avaliavel, false) then
      continue;
    end if;
    v_abaixo := coalesce(case t.tipo
                           when 'aprovacao' then t.valor <  t.limite
                           when 'tempo'     then t.valor >  t.limite
                           else                  t.valor >= t.limite
                         end, false);
    v_tipo := null;

    select * into o
      from public.alerta_ocorrencias
     where regra_id = t.regra_id and posto = t.posto
       and coalesce(defeito, '') = coalesce(t.defeito, '')
       and estado in ('aberta', 'resolvida')
     for update;

    if not found then
      if v_abaixo then
        insert into public.alerta_ocorrencias
          (regra_id, posto, defeito, pmo, op, taxa_abertura, taxa_ultima, valor_abertura, valor_ultimo,
           amostras, aprovados, reprovados, aberta_em, ultimo_envio_em)
        values (t.regra_id, t.posto, t.defeito,
                case when t.janela_tipo = 'op' then t.pmo end,
                case when t.janela_tipo = 'op' then t.op end,
                case when t.tipo = 'aprovacao' then t.valor end,
                case when t.tipo = 'aprovacao' then t.valor end,
                t.valor, t.valor, t.amostras, t.aprovados, t.reprovados, v_agora, v_agora)
        returning * into o;
        v_tipo := 'alerta';
      end if;

    elsif not v_abaixo then
      update public.alerta_ocorrencias
         set estado = 'normalizada', normalizada_em = v_agora,
             taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados
       where id = o.id
      returning * into o;
      v_tipo := 'normalizou';
      v_normalizadas := v_normalizadas || o.id;

    else
      -- Decide o lembrete ANTES do update, num booleano — nunca comparando `ultimo_envio_em`
      -- com `v_agora` depois (duas avaliações no mesmo instante teriam o mesmo `now()`).
      v_lembrete := o.estado = 'aberta' and t.lembrete_min is not null
                    and v_agora - o.ultimo_envio_em >= make_interval(mins => t.lembrete_min);

      update public.alerta_ocorrencias
         set taxa_ultima  = case when t.tipo = 'aprovacao' then t.valor else taxa_ultima end,
             valor_ultimo = t.valor, amostras = t.amostras,
             aprovados = t.aprovados, reprovados = t.reprovados,
             ultimo_envio_em = case when v_lembrete then v_agora else o.ultimo_envio_em end
       where id = o.id
      returning * into o;
      if v_lembrete then
        v_tipo := 'lembrete';
      end if;
    end if;

    if v_tipo is not null then
      -- `dados` = o que o app precisa para montar o texto (ver domain/envio.ts). Números crus; a
      -- formatação (%, mm:ss, rótulo do defeito, fuso) mora só no TS.
      v_dados := jsonb_build_object(
                   'regra_tipo',   t.tipo,
                   'regra_nome',   t.nome,
                   'posto',        t.posto,
                   'janela_tipo',  t.janela_tipo,
                   'janela_valor', t.janela_valor,
                   'pmo',          t.pmo,
                   'op',           t.op,
                   'aberta_em',    o.aberta_em,
                   'agora',        v_agora)
                 || case t.tipo
                      when 'aprovacao' then jsonb_build_object(
                        'taxa', t.valor, 'taxa_minima', t.limite,
                        'aprovados', t.aprovados, 'reprovados', t.reprovados)
                      when 'tempo' then jsonb_build_object(
                        'media_seg', t.valor, 'limite_tempo_seg', t.limite, 'pecas', t.amostras)
                      else jsonb_build_object(
                        'defeito', t.defeito, 'ocorrencias', t.amostras, 'limite_ocorrencias', t.limite)
                    end;

      -- FILA: uma linha pendente por destinatário x canal da regra QUE TENHA vínculo AGORA e que
      -- esteja ATIVO. Mesma transação da decisão: ou as duas coisas ficam, ou nenhuma.
      insert into public.alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao)
      select o.id, c.usuario_id, c.canal, v_tipo, v_dados, v_tipo in ('alerta', 'lembrete')
        from public.alerta_contas c
        join public.usuarios u on u.id = c.usuario_id and u.ativo
       where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
       order by c.usuario_id, c.canal;
      get diagnostics v_n = row_count;
      v_enfileirados := v_enfileirados + v_n;
    end if;
  end loop;

  return jsonb_build_object('ocupado', false, 'avaliadas', v_avaliadas,
                            'enfileirados', v_enfileirados, 'normalizadas', to_jsonb(v_normalizadas));
end
$func$;

revoke all on function public.alerta_avaliar() from public, anon, authenticated;
grant execute on function public.alerta_avaliar() to service_role;

-- ---------- B6. alerta_previa(): o valor de agora, por tipo, sem gravar nada ----------
-- Assinatura nova (tipo + parâmetros de cálculo + PMOs): a antiga (4 parâmetros) sai antes.
-- Retorno largo, cada tipo preenche o seu pedaço:
--   aprovacao: aprovados, reprovados, taxa, avaliavel (bipes >= mínimo), pmo/op (janela OP)
--   tempo:     media_seg, intervalos, pecas, avaliavel (intervalos >= mínimo), pmo/op
--   defeito:   uma linha por (posto, defeito com contagem >= N); posto sem nenhum = uma linha com
--              defeito nulo e ocorrencias 0
drop function if exists public.alerta_previa(text[], text, int, int);
create or replace function public.alerta_previa(
  p_tipo text, p_postos text[], p_janela_tipo text, p_janela_valor int, p_minimo int,
  p_pausa_max_min int, p_limite_ocorrencias int, p_pmos text[]
)
returns table (posto text, defeito text, aprovados int, reprovados int, taxa numeric,
               media_seg numeric, intervalos int, pecas int, ocorrencias int, avaliavel boolean,
               pmo text, op text)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_pmos text[] := coalesce(p_pmos, '{}'::text[]);
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_tipo is null or p_tipo not in ('aprovacao', 'tempo', 'defeito') then
    raise exception 'TIPO_INVALIDO';
  end if;
  if p_janela_tipo is null or p_janela_tipo not in ('tempo', 'bipes', 'op')
     or (p_tipo = 'tempo' and p_janela_tipo = 'bipes')
     or (p_tipo = 'defeito' and p_janela_tipo <> 'tempo') then
    raise exception 'JANELA_INVALIDA';
  end if;
  if p_janela_tipo <> 'op' and coalesce(p_janela_valor, 0) <= 0 then
    raise exception 'JANELA_INVALIDA';
  end if;

  if p_tipo = 'aprovacao' then
    return query
      select t.posto, null::text, t.aprovados, t.reprovados,
             case when t.aprovados + t.reprovados > 0
                  then trunc((t.aprovados * 100.0) / (t.aprovados + t.reprovados), 2)
             end,
             null::numeric, 0, 0, 0,
             (t.aprovados + t.reprovados) >= greatest(coalesce(p_minimo, 1), 1),
             t.pmo, t.op
        from public.alerta_taxas(p_postos, p_janela_tipo, p_janela_valor, v_pmos) t;

  elsif p_tipo = 'tempo' then
    if coalesce(p_pausa_max_min, 0) not between 1 and 240 then raise exception 'PAUSA_INVALIDA'; end if;
    return query
      select t.posto, null::text, 0, 0, null::numeric,
             t.media_seg, t.intervalos, t.pecas, 0,
             t.intervalos >= greatest(coalesce(p_minimo, 1), 1) and t.media_seg is not null,
             t.pmo, t.op
        from public.alerta_tempos(p_postos, p_janela_tipo, p_janela_valor, p_pausa_max_min, v_pmos) t;

  else
    if coalesce(p_limite_ocorrencias, 0) < 2 then raise exception 'LIMITE_INVALIDO'; end if;
    return query
      select p.posto, d.defeito, 0, 0, null::numeric, null::numeric, 0, 0,
             coalesce(d.ocorrencias, 0), true, null::text, null::text
        from unnest(p_postos) as p(posto)
        left join lateral (
          select x.defeito, x.ocorrencias
            from public.alerta_defeitos(array[p.posto], p_janela_valor, v_pmos) x
           where x.ocorrencias >= p_limite_ocorrencias
        ) d on true
       order by p.posto, d.ocorrencias desc nulls last, d.defeito;
  end if;
end
$func$;

revoke all on function public.alerta_previa(text, text[], text, int, int, int, int, text[]) from public, anon;
grant execute on function public.alerta_previa(text, text[], text, int, int, int, int, text[])
  to authenticated, service_role;

-- ---------- B7. alerta_listar_ocorrencias(): + tipo, defeito e valores ----------
-- O retorno mudou (colunas novas no FIM): create or replace não troca retorno, então drop antes.
drop function if exists public.alerta_listar_ocorrencias(timestamptz, timestamptz, text);
create or replace function public.alerta_listar_ocorrencias(
  p_de timestamptz, p_ate timestamptz, p_estado text default ''
)
returns table (
  id uuid, regra_id uuid, regra_nome text, posto text, pmo text, op text, estado text,
  taxa_abertura numeric, taxa_ultima numeric, aprovados int, reprovados int,
  aberta_em timestamptz, resolvida_por_nome text, resolvida_em timestamptz,
  normalizada_em timestamptz, envios_ok int, envios_falha int,
  regra_tipo text, defeito text, valor_abertura numeric, valor_ultimo numeric, amostras int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select oc.id, oc.regra_id,
           rg.nome || case when rg.excluida_em is not null then ' (excluída)' else '' end,
           oc.posto, oc.pmo, oc.op, oc.estado,
           oc.taxa_abertura, oc.taxa_ultima, oc.aprovados, oc.reprovados, oc.aberta_em,
           coalesce(nullif(btrim(u.nome), ''), u.email, ''),
           oc.resolvida_em, oc.normalizada_em,
           coalesce(e.ok_qtd, 0)::int, coalesce(e.falha_qtd, 0)::int,
           rg.tipo, oc.defeito, oc.valor_abertura, oc.valor_ultimo, oc.amostras
      from alerta_ocorrencias oc
      join alerta_regras rg on rg.id = oc.regra_id
      left join usuarios u on u.id = oc.resolvida_por
      left join lateral (
        -- falha = tentou e não entregou, ou gastou as 3 tentativas (mesma régua da 0113)
        select count(*) filter (where ev.ok)                                        as ok_qtd,
               count(*) filter (where not ev.ok
                                  and (ev.erro is not null or ev.tentativas >= 3)) as falha_qtd
          from alerta_envios ev
         where ev.ocorrencia_id = oc.id
      ) e on true
     where oc.aberta_em >= p_de
       and oc.aberta_em <= p_ate
       and (coalesce(p_estado, '') = '' or oc.estado = p_estado)
     order by oc.aberta_em desc
     limit 500;
end
$func$;

revoke all on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.alerta_listar_ocorrencias(timestamptz, timestamptz, text)
  to authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash supabase/tests/rodar-alertas-test.sh`
Expected: `0115 (tipos de regra): ok` e `ALERTAS SQL OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0115_alertas_tipos.sql supabase/tests/alertas_tipos_test.sql
git commit -m "feat(alertas): 0115 parte B — tempo médio por peça, defeito repetido, filtro de PMO, avaliar/prévia/listagem por tipo

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: 0115 parte C — destinatários só com `shopfloor.administrar`

**Files:**
- Modify: `supabase/migrations/0115_alertas_tipos.sql` (um trecho do `alerta_avaliar` da parte B + parte C inserida **antes** da linha final `notify pgrst, 'reload schema';`)
- Test: `supabase/tests/alertas_tipos_test.sql` (acrescentar no fim)

**Interfaces:**
- Consumes: `usuario_tem_permissao(uuid, text, text)` (Task 2); `alerta_avaliar()` da parte B (Task 3); perfis `Gestor`/`Operador` e helpers `teste_regra`, `teste_bipes` do arquivo de teste.
- Produces (mesmas assinaturas da 0113, comportamento novo):
  - `alerta_destinatarios() returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)` — só usuários ativos com `shopfloor.administrar` no perfil deles.
  - `alerta_reservar_envios(p_canais text[], p_limite int default 30, p_ocorrencia_id uuid default null)` — não reserva linha de quem perdeu a permissão (a linha fica pendente, sem tentativa, e vence em 24 h).
  - `alerta_resolver_interno(uuid, uuid, boolean)` — com `p_exigir_destinatario`, recusa quem não tem a permissão (`NAO_DESTINATARIO`); o "✅ resolvido por" só vai para quem tem.
  - `alerta_avaliar()` — só enfileira para quem tem a permissão.

- [ ] **Step 1: Escrever os testes que falham — acrescentar no fim de `supabase/tests/alertas_tipos_test.sql`**

```sql
-- =====================================================================
-- Destinatários: só quem administra o ShopFloor (0115 parte C)
-- =====================================================================

-- D1. A lista da tela: Carla (Operador) e os inativos (Zeca, Dora — mesmo com perfil Gestor) ficam fora.
set role authenticated;
do $t$
declare v uuid[];
begin
  select array_agg(usuario_id order by usuario_id) into v from alerta_destinatarios();
  if v is distinct from array['00000000-0000-0000-0000-000000000001',
                              '00000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'FALHOU: destinatários disponíveis %', v;
  end if;
end $t$;
reset role;

-- D2. Fila: Carla está no array da regra e TEM Telegram, mas não administra — não entra.
update public.alerta_envios set tentativas = 3 where not ok and tentativas < 3;
select public.teste_bipes('P-Dest', 'PMOA', '1', 0, 20, 5);
do $t$ begin
  perform teste_regra('Destinos', 'aprovacao', array['P-Dest'], 90, 'tempo', 60, 10, null, null, null, '{}', null, true,
                      array['00000000-0000-0000-0000-000000000001',
                            '00000000-0000-0000-0000-000000000002',
                            '00000000-0000-0000-0000-000000000003']::uuid[]);
end $t$;
set role service_role;
do $t$
declare v uuid[];
begin
  perform alerta_avaliar();
  select array_agg(distinct e.usuario_id order by e.usuario_id) into v
    from alerta_envios e
    join alerta_ocorrencias oc on oc.id = e.ocorrencia_id
    join alerta_regras rg on rg.id = oc.regra_id
   where rg.nome = 'Destinos' and e.tipo = 'alerta';
  if v is distinct from array['00000000-0000-0000-0000-000000000001',
                              '00000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'FALHOU: fila com quem não administra o ShopFloor %', v;
  end if;
end $t$;
reset role;

-- D3. Perdeu a permissão DEPOIS de enfileirado e ANTES da entrega: a reserva não pega a linha dele.
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a2'
 where id = '00000000-0000-0000-0000-000000000002';
set role service_role;
do $t$
declare v uuid[];
begin
  select array_agg(distinct x.usuario_id order by x.usuario_id) into v
    from alerta_reservar_envios(array['telegram', 'discord'], 100) x;
  if v is distinct from array['00000000-0000-0000-0000-000000000001']::uuid[] then
    raise exception 'FALHOU: reserva com quem perdeu a permissão %', v;
  end if;
  if exists (select 1 from alerta_envios e
               join alerta_ocorrencias oc on oc.id = e.ocorrencia_id
               join alerta_regras rg on rg.id = oc.regra_id
              where rg.nome = 'Destinos' and e.usuario_id = '00000000-0000-0000-0000-000000000002'
                and (e.tentativas <> 0 or e.reservado_em is not null)) then
    raise exception 'FALHOU: a linha de quem perdeu a permissão foi mexida pela reserva';
  end if;
end $t$;
reset role;
-- Devolveu a permissão (ainda dentro das 24 h): a linha dele volta a ser entregável.
update public.usuarios set perfil_id = '00000000-0000-0000-0000-0000000000a1'
 where id = '00000000-0000-0000-0000-000000000002';
set role service_role;
do $t$
declare v uuid[];
begin
  select array_agg(distinct x.usuario_id order by x.usuario_id) into v
    from alerta_reservar_envios(array['telegram', 'discord'], 100) x;
  if v is distinct from array['00000000-0000-0000-0000-000000000002']::uuid[] then
    raise exception 'FALHOU: a linha do Bruno não voltou para a fila %', v;
  end if;
end $t$;

-- D4. Botão Resolvido: quem não administra não resolve; o "resolvido por" só vai para quem administra.
do $t$
declare oc uuid; r jsonb;
begin
  select o.id into oc
    from alerta_ocorrencias o join alerta_regras rg on rg.id = o.regra_id
   where rg.nome = 'Destinos' and o.estado = 'aberta';
  begin
    perform alerta_resolver(oc, '00000000-0000-0000-0000-000000000003');
    raise exception 'FALHOU: Carla (sem administrar) resolveu pelo botão';
  exception when others then
    if sqlerrm not like '%NAO_DESTINATARIO%' then raise; end if;
  end;
  r := alerta_resolver(oc, '00000000-0000-0000-0000-000000000001');
  if (r->>'ja_resolvida')::boolean is not false then raise exception 'FALHOU: Ana não resolveu %', r; end if;
  if exists (select 1 from alerta_envios where ocorrencia_id = oc and tipo = 'resolvido'
               and usuario_id <> '00000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: "resolvido" foi para quem não devia (Carla ou quem resolveu)';
  end if;
  if not exists (select 1 from alerta_envios where ocorrencia_id = oc and tipo = 'resolvido'
                   and usuario_id = '00000000-0000-0000-0000-000000000002') then
    raise exception 'FALHOU: Bruno devia receber o "resolvido"';
  end if;
end $t$;
reset role;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-alertas-test.sh`
Expected: FAIL em `alertas_tipos_test.sql` com `FALHOU: destinatários disponíveis {...0001,...0002,...0003}` (Carla ainda aparece).

- [ ] **Step 3: Filtro de permissão na fila do `alerta_avaliar`**

No `0115_alertas_tipos.sql` (bloco B5, `alerta_avaliar`), troque:

```sql
       where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
       order by c.usuario_id, c.canal;
```

por:

```sql
       where c.usuario_id = any (t.destinatarios) and c.canal = any (t.canais)
         -- destinatário precisa administrar o ShopFloor AGORA (spec 2026-09-18, decisão 5)
         and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
       order by c.usuario_id, c.canal;
```

- [ ] **Step 4: Parte C — inserir no `0115_alertas_tipos.sql` ANTES da linha final `notify pgrst, 'reload schema';`**

```sql
-- ---------- C1. alerta_reservar_envios(): só entrega a quem ainda administra o ShopFloor ----------
-- Igual à 0113 + o filtro de permissão. Quem perdeu shopfloor.administrar DEPOIS de a linha ser
-- enfileirada não recebe: a linha fica pendente, nunca é reservada (não conta tentativa nem falha)
-- e sai da fila sozinha quando passa das 24 h — o mesmo caminho do usuário desativado.
create or replace function public.alerta_reservar_envios(
  p_canais text[], p_limite int default 30, p_ocorrencia_id uuid default null
)
returns table (id uuid, ocorrencia_id uuid, usuario_id uuid, canal text, externo_id text,
               tipo text, dados jsonb, com_botao boolean, tentativas int)
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  return query
    with alvo as (
      select e.id, c.externo_id
        from public.alerta_envios e
        join public.alerta_contas c on c.usuario_id = e.usuario_id and c.canal = e.canal
        join public.usuarios u on u.id = e.usuario_id and u.ativo
        left join public.alerta_ocorrencias oc on oc.id = e.ocorrencia_id
       where e.ok = false
         and e.tentativas < 3
         and e.tipo <> 'teste'
         and e.criado_em >= now() - interval '24 hours'
         and e.canal = any (coalesce(p_canais, '{}'::text[]))
         and (p_ocorrencia_id is null or e.ocorrencia_id = p_ocorrencia_id)
         and (e.reservado_em is null or e.reservado_em < now() - interval '15 minutes')
         and (e.tipo not in ('alerta', 'lembrete') or oc.estado = 'aberta')
         and public.usuario_tem_permissao(e.usuario_id, 'shopfloor', 'administrar')
       order by (e.tentativas > 0), e.criado_em, e.id
       limit least(greatest(coalesce(p_limite, 30), 1), 100)
       for update of e skip locked
    ),
    reservadas as (
      update public.alerta_envios e
         set tentativas = e.tentativas + 1, reservado_em = now()
        from alvo
       where e.id = alvo.id
      returning e.id, e.ocorrencia_id, e.usuario_id, e.canal, alvo.externo_id, e.tipo, e.dados,
                e.com_botao, e.tentativas, e.criado_em
    )
    select r.id, r.ocorrencia_id, r.usuario_id, r.canal, r.externo_id, r.tipo, r.dados,
           r.com_botao, r.tentativas
      from reservadas r
     order by (r.tentativas > 1), r.criado_em, r.id;
end
$func$;

revoke all on function public.alerta_reservar_envios(text[], int, uuid) from public, anon, authenticated;
grant execute on function public.alerta_reservar_envios(text[], int, uuid) to service_role;

-- ---------- C2. alerta_resolver_interno(): destinatário precisa administrar o ShopFloor ----------
-- Igual à 0113 + a permissão: pelo botão (p_exigir_destinatario), quem perdeu shopfloor.administrar
-- recebe NAO_DESTINATARIO; o "✅ resolvido por" só vai para quem administra. Pela tela
-- (alerta_resolver_admin) a permissão já é checada em quem chama.
create or replace function public.alerta_resolver_interno(
  p_ocorrencia_id uuid, p_usuario_id uuid, p_exigir_destinatario boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  o     public.alerta_ocorrencias;
  r     public.alerta_regras;
  v_ja  boolean := true;
  v_nome text;
begin
  select * into o from alerta_ocorrencias where id = p_ocorrencia_id for update;
  if not found then raise exception 'OCORRENCIA_INEXISTENTE'; end if;
  select * into r from alerta_regras where id = o.regra_id;
  -- `p_usuario_id is null` explícito: falha FECHADA (null = any(...) dá NULL, não false).
  if p_exigir_destinatario and (p_usuario_id is null or not (p_usuario_id = any (r.destinatarios))) then
    raise exception 'NAO_DESTINATARIO';
  end if;
  -- Usuário inexistente, desativado OU sem shopfloor.administrar nunca é destinatário válido, mesmo
  -- que o uuid ainda esteja no array `destinatarios` da regra (usuario_tem_permissao já exige ativo).
  if p_exigir_destinatario
     and not public.usuario_tem_permissao(p_usuario_id, 'shopfloor', 'administrar') then
    raise exception 'NAO_DESTINATARIO';
  end if;
  if o.estado = 'normalizada' then raise exception 'OCORRENCIA_ENCERRADA'; end if;

  if o.estado = 'aberta' then
    update alerta_ocorrencias
       set estado = 'resolvida', resolvida_por = p_usuario_id, resolvida_em = now()
     where id = o.id
    returning * into o;
    v_ja := false;
  end if;

  select coalesce(nullif(btrim(nome), ''), email) into v_nome from usuarios where id = o.resolvida_por;

  -- FILA: "✅ resolvido por X" para os OUTROS destinatários ativos que administram o ShopFloor, na
  -- mesma transação da resolução. Só na primeira resolução.
  if not v_ja then
    insert into alerta_envios (ocorrencia_id, usuario_id, canal, tipo, dados, com_botao)
    select o.id, c.usuario_id, c.canal, 'resolvido',
           jsonb_build_object('posto', o.posto, 'resolvida_por_nome', coalesce(v_nome, ''),
                              'resolvida_em', o.resolvida_em),
           false
      from alerta_contas c
      join usuarios u on u.id = c.usuario_id and u.ativo
     where c.usuario_id = any (r.destinatarios)
       and c.canal = any (r.canais)
       and c.usuario_id is distinct from p_usuario_id
       and public.usuario_tem_permissao(c.usuario_id, 'shopfloor', 'administrar')
     order by c.usuario_id, c.canal;
  end if;

  return jsonb_build_object(
    'ocorrencia_id',      o.id,
    'regra_id',           o.regra_id,
    'posto',              o.posto,
    'ja_resolvida',       v_ja,
    'resolvida_por',      o.resolvida_por,
    'resolvida_por_nome', coalesce(v_nome, ''),
    'resolvida_em',       o.resolvida_em
  );
end
$func$;

revoke all on function public.alerta_resolver_interno(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;

-- ---------- C3. alerta_destinatarios(): quem a tela oferece ----------
-- Só usuários ATIVOS que administram o ShopFloor (a permissão do USUÁRIO listado, não de quem
-- chama). Devolve o vínculo como booleano (nunca o externo_id).
create or replace function public.alerta_destinatarios()
returns table (usuario_id uuid, nome text, email text, telegram boolean, discord boolean)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('shopfloor', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  return query
    select u.id,
           coalesce(nullif(btrim(u.nome), ''), u.email),
           u.email,
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'telegram'),
           exists (select 1 from alerta_contas c where c.usuario_id = u.id and c.canal = 'discord')
      from usuarios u
     where u.ativo
       and public.usuario_tem_permissao(u.id, 'shopfloor', 'administrar')
     order by lower(coalesce(nullif(btrim(u.nome), ''), u.email));
end
$func$;

revoke all on function public.alerta_destinatarios() from public, anon;
grant execute on function public.alerta_destinatarios() to authenticated, service_role;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `bash supabase/tests/rodar-alertas-test.sh`
Expected: `0115 (tipos de regra): ok` e `ALERTAS SQL OK`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0115_alertas_tipos.sql supabase/tests/alertas_tipos_test.sql
git commit -m "feat(alertas): 0115 parte C — destinatário só com shopfloor.administrar (lista, fila, reserva e botão)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Repositório e actions — gravar/editar por tipo, prévia por tipo, listagens com tipo e PMOs

**Files:**
- Modify (reescrever inteiro): `src/modules/alertas/infra/regras-repository.ts`
- Modify: `src/modules/alertas/application/alertas-actions.ts`
- Modify: `src/modules/alertas/infra/__tests__/regras-repository.test.ts` (só a constante `REGRA`)
- Modify: `src/modules/alertas/application/__tests__/alertas-actions.test.ts` (acrescentar casos)
- Test: `src/modules/alertas/infra/__tests__/regras-repository-tipos.test.ts` (criar)

**Interfaces:**
- Consumes: Task 1 (`RegraValida`, `RegraAlerta`, `PreviaValida`, `EntradaPrevia`, `validarPrevia`, `validarRegra`, `resumoLimite`, `resumoPmos`, `NOME_TIPO_REGRA`, `ehTipoRegra`, `PreviaPosto`, `OcorrenciaLinha`); banco das Tasks 2–4 (colunas novas de `alerta_regras`, `alerta_previa` de 8 parâmetros, `alerta_listar_ocorrencias` com `regra_tipo/defeito/valor_abertura/valor_ultimo/amostras`, `alerta_pmos(): text[]`).
- Produces (usados na Task 6):
  - `listarRegras(): Promise<RegraAlerta[]>` (agora com `tipo`, `limiteTempoSeg`, `limiteOcorrencias`, `pausaMaxMin`, `pmos`).
  - `inserirRegra(r: RegraValida)` — grava o `tipo`; `atualizarRegra(id: string, r: RegraValida)` — **não** manda `tipo`.
  - `previaRegra(p: PreviaValida): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }>`.
  - `listarOcorrencias(f: FiltroOcorrencias): Promise<OcorrenciaLinha[]>` com os campos novos.
  - `listarPmosAlerta(): Promise<string[]>`.
  - `previaRegraAction(entrada: EntradaPrevia): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }>`.
  - `salvarRegraAction(id: string | null, entrada: EntradaRegra)` — mesma assinatura; log com tipo, limite e PMOs.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/modules/alertas/infra/__tests__/regras-repository-tipos.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegraValida } from '../../domain/regra'

vi.mock('server-only', () => ({}))

afterEach(() => {
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

/** Supabase de mentira para insert/update: guarda o que seria gravado. */
function sbGravacao() {
  const gravado: { insert?: Record<string, unknown>; update?: Record<string, unknown> } = {}
  const q = {
    insert(v: Record<string, unknown>) {
      gravado.insert = v
      return q
    },
    update(v: Record<string, unknown>) {
      gravado.update = v
      return q
    },
    eq() {
      return q
    },
    is() {
      return q
    },
    select() {
      return q
    },
    single() {
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      const data = gravado.insert ? { id: 'nova' } : [{ id: 'r1' }]
      return Promise.resolve({ data, error: null }).then(ok, erro)
    },
  }
  return { sb: { from: () => q } as unknown as SupabaseClient, gravado }
}

/** Supabase de mentira para `.from(...).select(...).is(...).order(...)` (lista de regras). */
function sbLista(linhas: unknown[]) {
  const q = {
    select() {
      return q
    },
    is() {
      return q
    },
    order() {
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      return Promise.resolve({ data: linhas, error: null }).then(ok, erro)
    },
  }
  return { from: () => q } as unknown as SupabaseClient
}

/** Supabase de mentira para `.rpc(nome, args)`: guarda a chamada e devolve `data`. */
function sbRpc(data: unknown) {
  const chamadas: { nome: string; args: unknown }[] = []
  const sb = {
    rpc: async (nome: string, args?: unknown) => {
      chamadas.push({ nome, args })
      return { data, error: null }
    },
  } as unknown as SupabaseClient
  return { sb, chamadas }
}

async function repositorioCom(sb: SupabaseClient) {
  vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb }))
  return import('../regras-repository')
}

const TEMPO: RegraValida = {
  tipo: 'tempo',
  nome: 'Teste lento',
  postos: ['Teste'],
  taxaMinima: null,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 10,
  limiteTempoSeg: 120,
  limiteOcorrencias: null,
  pausaMaxMin: 30,
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  pmos: ['PMOA'],
  ativa: true,
}

const DEFEITO: RegraValida = {
  ...TEMPO,
  tipo: 'defeito',
  nome: 'Defeito 3x',
  minimoBipes: null,
  limiteTempoSeg: null,
  pausaMaxMin: null,
  limiteOcorrencias: 5,
  pmos: [],
}

describe('gravar regra por tipo', () => {
  it('inserirRegra grava o tipo e os campos do tipo', async () => {
    const { sb, gravado } = sbGravacao()
    const { inserirRegra } = await repositorioCom(sb)
    expect(await inserirRegra(TEMPO)).toEqual({ ok: true, id: 'nova' })
    expect(gravado.insert).toMatchObject({
      tipo: 'tempo',
      taxa_minima: null,
      minimo_bipes: 10,
      limite_tempo_seg: 120,
      limite_ocorrencias: null,
      pausa_max_min: 30,
      pmos: ['PMOA'],
    })
  })

  it('regra de defeito manda minimo_bipes nulo EXPLÍCITO (o default 20 do banco seria recusado)', async () => {
    const { sb, gravado } = sbGravacao()
    const { inserirRegra } = await repositorioCom(sb)
    await inserirRegra(DEFEITO)
    expect(gravado.insert).toHaveProperty('minimo_bipes', null)
    expect(gravado.insert).toMatchObject({ tipo: 'defeito', limite_ocorrencias: 5 })
  })

  it('atualizarRegra não manda o tipo (o tipo não muda depois de criado)', async () => {
    const { sb, gravado } = sbGravacao()
    const { atualizarRegra } = await repositorioCom(sb)
    expect(await atualizarRegra('r1', DEFEITO)).toEqual({ ok: true })
    expect(gravado.update).not.toHaveProperty('tipo')
    expect(gravado.update).toMatchObject({ limite_ocorrencias: 5, pmos: [], minimo_bipes: null })
  })
})

describe('listarRegras', () => {
  it('lê o tipo, os campos de cada tipo e as PMOs', async () => {
    const { listarRegras } = await repositorioCom(
      sbLista([
        {
          id: 'r1',
          tipo: 'tempo',
          nome: 'Teste lento',
          postos: ['Teste'],
          taxa_minima: null,
          janela_tipo: 'op',
          janela_valor: null,
          minimo_bipes: 10,
          limite_tempo_seg: 120,
          limite_ocorrencias: null,
          pausa_max_min: 30,
          pmos: ['PMOA'],
          lembrete_min: null,
          canais: ['telegram'],
          destinatarios: ['u1'],
          ativa: true,
          atualizado_em: '2026-09-18T12:00:00Z',
        },
        {
          id: 'r2',
          tipo: 'coisa-nova',
          nome: 'Antiga',
          postos: ['Teste'],
          taxa_minima: '90.00',
          janela_tipo: 'tempo',
          janela_valor: 60,
          minimo_bipes: 20,
          limite_tempo_seg: null,
          limite_ocorrencias: null,
          pausa_max_min: null,
          pmos: null,
          lembrete_min: null,
          canais: ['discord'],
          destinatarios: ['u1'],
          ativa: false,
          atualizado_em: '2026-09-18T12:00:00Z',
        },
      ]),
    )
    const [tempo, antiga] = await listarRegras()
    expect(tempo).toMatchObject({
      id: 'r1',
      tipo: 'tempo',
      taxaMinima: null,
      janelaTipo: 'op',
      limiteTempoSeg: 120,
      pausaMaxMin: 30,
      pmos: ['PMOA'],
    })
    expect(antiga).toMatchObject({ tipo: 'aprovacao', taxaMinima: 90, pmos: [] })
  })
})

describe('prévia por tipo', () => {
  it('manda os parâmetros nomeados da alerta_previa nova e lê as colunas novas', async () => {
    const { sb, chamadas } = sbRpc([
      {
        posto: 'Teste',
        defeito: '2040 COMPONENTE FALTANDO',
        aprovados: 0,
        reprovados: 0,
        taxa: null,
        media_seg: '68.33',
        intervalos: 29,
        pecas: 30,
        ocorrencias: 3,
        avaliavel: true,
        pmo: null,
        op: null,
      },
    ])
    const { previaRegra } = await repositorioCom(sb)
    const r = await previaRegra({
      tipo: 'defeito',
      postos: ['Teste'],
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: null,
      pausaMaxMin: null,
      limiteOcorrencias: 3,
      pmos: ['PMOA'],
    })
    expect(chamadas).toEqual([
      {
        nome: 'alerta_previa',
        args: {
          p_tipo: 'defeito',
          p_postos: ['Teste'],
          p_janela_tipo: 'tempo',
          p_janela_valor: 60,
          p_minimo: null,
          p_pausa_max_min: null,
          p_limite_ocorrencias: 3,
          p_pmos: ['PMOA'],
        },
      },
    ])
    expect(r).toEqual({
      ok: true,
      postos: [
        {
          posto: 'Teste',
          defeito: '2040 COMPONENTE FALTANDO',
          aprovados: 0,
          reprovados: 0,
          taxa: null,
          mediaSeg: 68.33,
          intervalos: 29,
          pecas: 30,
          ocorrencias: 3,
          avaliavel: true,
          pmo: null,
          op: null,
        },
      ],
    })
  })
})

describe('listarOcorrencias', () => {
  it('lê tipo, defeito e valores; taxa nula continua nula', async () => {
    const { sb } = sbRpc([
      {
        id: 'o1',
        regra_id: 'g1',
        regra_nome: 'Defeito 3x',
        posto: 'Teste',
        pmo: null,
        op: null,
        estado: 'aberta',
        taxa_abertura: null,
        taxa_ultima: null,
        aprovados: 0,
        reprovados: 0,
        aberta_em: '2026-09-18T12:00:00Z',
        resolvida_por_nome: '',
        resolvida_em: null,
        normalizada_em: null,
        envios_ok: 2,
        envios_falha: 0,
        regra_tipo: 'defeito',
        defeito: '2040 COMPONENTE FALTANDO',
        valor_abertura: '3.00',
        valor_ultimo: '4.00',
        amostras: 4,
      },
    ])
    const { listarOcorrencias } = await repositorioCom(sb)
    const [o] = await listarOcorrencias({ de: '2026-09-18', ate: '2026-09-18', estado: '' })
    expect(o).toMatchObject({
      regraTipo: 'defeito',
      defeito: '2040 COMPONENTE FALTANDO',
      taxaAbertura: null,
      taxaUltima: null,
      valorAbertura: 3,
      valorUltimo: 4,
      amostras: 4,
    })
  })
})

describe('listarPmosAlerta', () => {
  it('um array só, sem vazio nem repetida', async () => {
    const { sb, chamadas } = sbRpc(['PMOA', 'PMOB', '', 'PMOA'])
    const { listarPmosAlerta } = await repositorioCom(sb)
    expect(await listarPmosAlerta()).toEqual(['PMOA', 'PMOB'])
    expect(chamadas[0]!.nome).toBe('alerta_pmos')
  })
  it('sem dados = lista vazia', async () => {
    const { sb } = sbRpc(null)
    const { listarPmosAlerta } = await repositorioCom(sb)
    expect(await listarPmosAlerta()).toEqual([])
  })
})
```

Em `src/modules/alertas/application/__tests__/alertas-actions.test.ts`, acrescente dentro do `describe` existente, depois do último `it`:

```ts
  // Os casos acima fazem doUnmock da sessão; os de baixo registram a própria sessão de gestor.
  function comoGestor() {
    vi.doMock('@/modules/auth/application/get-sessao', () => ({
      getSessao: async () => ({ usuarioId: 'u1', nome: 'Gestor', email: 'gestor@x', perfil: GESTOR }),
    }))
  }

  function repositorioFalso(sobrescrever: Record<string, unknown>) {
    vi.doMock('../../infra/regras-repository', () => ({
      previaRegra: vi.fn(),
      atualizarRegra: vi.fn(),
      definirRegraAtiva: vi.fn(),
      excluirRegra: vi.fn(),
      inserirRegra: vi.fn(),
      listarOcorrencias: vi.fn(),
      resolverOcorrenciaComoAdmin: vi.fn(),
      ...sobrescrever,
    }))
  }

  function limparMocks() {
    vi.doUnmock('@/modules/auth/application/get-sessao')
    vi.doUnmock('../../infra/regras-repository')
    vi.doUnmock('@/modules/logs/application/registrar-log')
    vi.resetModules()
  }

  it('salvarRegraAction: tipo desconhecido é recusado antes do banco', async () => {
    comoGestor()
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction(null, {
      tipo: 'lua',
      nome: 'X',
      postos: ['Teste'],
      taxaMinima: '90',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '20',
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1'],
      ativa: true,
    })
    expect(r).toEqual({ ok: false, erro: 'Escolha o tipo da regra.' })
    limparMocks()
  })

  it('previaRegraAction: repassa o tipo, a pausa, o limite e as PMOs já validados', async () => {
    const previaRegra = vi.fn().mockResolvedValue({ ok: true, postos: [] })
    comoGestor()
    repositorioFalso({ previaRegra })
    vi.resetModules()
    const { previaRegraAction } = await import('../alertas-actions')
    const r = await previaRegraAction({
      tipo: 'tempo',
      postos: ['Teste'],
      janelaTipo: 'op',
      janelaValor: null,
      minimoBipes: '10',
      pausaMaxMin: '30',
      pmos: ['PMOA'],
    })
    expect(r).toEqual({ ok: true, postos: [] })
    expect(previaRegra).toHaveBeenCalledWith({
      tipo: 'tempo',
      postos: ['Teste'],
      janelaTipo: 'op',
      janelaValor: null,
      minimoBipes: 10,
      pausaMaxMin: 30,
      limiteOcorrencias: null,
      pmos: ['PMOA'],
    })
    limparMocks()
  })

  it('salvarRegraAction: regra nova de defeito vai com o tipo e o log diz tipo, limite e PMOs', async () => {
    const inserirRegra = vi.fn().mockResolvedValue({ ok: true, id: 'nova' })
    const registrarLog = vi.fn().mockResolvedValue(undefined)
    comoGestor()
    repositorioFalso({ inserirRegra })
    vi.doMock('@/modules/logs/application/registrar-log', () => ({ registrarLog }))
    vi.resetModules()
    const { salvarRegraAction } = await import('../alertas-actions')
    const r = await salvarRegraAction(null, {
      tipo: 'defeito',
      nome: 'Defeito 3x',
      postos: ['Teste'],
      taxaMinima: '',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '',
      limiteOcorrencias: '3',
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1'],
      pmos: [],
      ativa: true,
    })
    expect(r).toEqual({ ok: true, id: 'nova' })
    expect(inserirRegra.mock.calls[0]![0]).toMatchObject({ tipo: 'defeito', limiteOcorrencias: 3, minimoBipes: null })
    expect(registrarLog.mock.calls[0]![0].descricao).toBe(
      'Regra de alerta "Defeito 3x" criada (Defeito repetido; Teste; Últimos 60 min; limite ≥ 3 vezes; PMOs: Todas)',
    )
    limparMocks()
  })
```

Em `src/modules/alertas/infra/__tests__/regras-repository.test.ts`, troque a constante `REGRA` por:

```ts
const REGRA: RegraValida = {
  tipo: 'aprovacao',
  nome: 'Teste',
  postos: ['P1'],
  taxaMinima: 90,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 20,
  limiteTempoSeg: null,
  limiteOcorrencias: null,
  pausaMaxMin: null,
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  pmos: [],
  ativa: true,
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/alertas/infra src/modules/alertas/application/__tests__/alertas-actions.test.ts`
Expected: FAIL — `regras-repository-tipos.test.ts` (`listarPmosAlerta is not a function`, `gravado.insert` sem `tipo`, `alerta_previa` chamada com os 4 parâmetros antigos, `regraTipo` indefinido) e o teste do log em `alertas-actions.test.ts` (descrição antiga).

- [ ] **Step 3: Reescrever `src/modules/alertas/infra/regras-repository.ts` inteiro**

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ehCanal, ehJanelaTipo, ehTipoRegra, type EstadoOcorrencia } from '../domain/tipos'
import type { DestinatarioDisponivel, PreviaValida, RegraAlerta, RegraValida } from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { periodoOcorrencias } from '../domain/ocorrencia'
import { lerResolucao } from '../domain/resolucao'
import { codigoErroAlerta, mensagemErroAlerta } from '../domain/erros'
import type { ResultadoResolver } from '../application/portas'

const CAMPOS_REGRA =
  'id, tipo, nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, limite_tempo_seg, ' +
  'limite_ocorrencias, pausa_max_min, pmos, lembrete_min, canais, destinatarios, ativa, atualizado_em'

interface LinhaRegra {
  id: string
  tipo: string
  nome: string
  postos: string[] | null
  taxa_minima: number | string | null
  janela_tipo: string
  janela_valor: number | null
  minimo_bipes: number | null
  limite_tempo_seg: number | null
  limite_ocorrencias: number | null
  pausa_max_min: number | null
  pmos: string[] | null
  lembrete_min: number | null
  canais: string[] | null
  destinatarios: string[] | null
  ativa: boolean
  atualizado_em: string
}

/** numeric do Postgres chega como string no supabase-js; null continua null. */
function numeroOuNulo(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** RLS nega em vez de esconder em algumas operações; 42501 é justamente "sem permissão". */
function erroDeBanco(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Você não tem permissão para configurar alertas.'
  return mensagemErroAlerta(error.message)
}

function paraRegra(l: LinhaRegra): RegraAlerta {
  return {
    id: l.id,
    // Tipo desconhecido (banco mais novo que o app) cai em 'aprovacao' em vez de quebrar a lista.
    tipo: ehTipoRegra(l.tipo) ? l.tipo : 'aprovacao',
    nome: l.nome,
    postos: l.postos ?? [],
    taxaMinima: numeroOuNulo(l.taxa_minima),
    janelaTipo: ehJanelaTipo(l.janela_tipo) ? l.janela_tipo : 'tempo',
    janelaValor: l.janela_valor,
    minimoBipes: l.minimo_bipes,
    limiteTempoSeg: l.limite_tempo_seg,
    limiteOcorrencias: l.limite_ocorrencias,
    pausaMaxMin: l.pausa_max_min,
    lembreteMin: l.lembrete_min,
    canais: (l.canais ?? []).filter(ehCanal),
    destinatarios: l.destinatarios ?? [],
    pmos: l.pmos ?? [],
    ativa: l.ativa,
    atualizadoEm: l.atualizado_em,
  }
}

/**
 * Colunas gravadas. Os campos que não são do tipo vão como null EXPLÍCITO (o check da 0115 recusa,
 * por exemplo, o default 20 de minimo_bipes numa regra de defeito). O `tipo` só vai no INSERT:
 * depois de criada, a regra não muda de tipo (trigger TIPO_FIXO da 0115).
 */
function paraLinha(r: RegraValida, comTipo: boolean): Record<string, unknown> {
  const linha: Record<string, unknown> = {
    nome: r.nome,
    postos: r.postos,
    taxa_minima: r.taxaMinima,
    janela_tipo: r.janelaTipo,
    janela_valor: r.janelaValor,
    minimo_bipes: r.minimoBipes,
    limite_tempo_seg: r.limiteTempoSeg,
    limite_ocorrencias: r.limiteOcorrencias,
    pausa_max_min: r.pausaMaxMin,
    pmos: r.pmos,
    lembrete_min: r.lembreteMin,
    canais: r.canais,
    destinatarios: r.destinatarios,
    ativa: r.ativa,
  }
  if (comTipo) linha.tipo = r.tipo
  return linha
}

export async function listarRegras(): Promise<RegraAlerta[]> {
  const sb = await createServerSupabase()
  // Regra excluída (exclusão lógica) some da lista; as ocorrências dela continuam na aba Ocorrências.
  const { data, error } = await sb
    .from('alerta_regras')
    .select(CAMPOS_REGRA)
    .is('excluida_em', null)
    .order('nome')
  if (error) throw error
  return ((data ?? []) as unknown as LinhaRegra[]).map(paraRegra)
}

export async function inserirRegra(r: RegraValida): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('alerta_regras').insert(paraLinha(r, true)).select('id').single()
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true, id: (data as { id: string }).id }
}

export async function atualizarRegra(
  id: string,
  r: RegraValida,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('alerta_regras')
    .update({ ...paraLinha(r, false), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, erro: erroDeBanco(error) }
  if ((data ?? []).length === 0) return { ok: false, erro: 'Essa regra foi excluída.' }
  return { ok: true }
}

/**
 * Exclusão LÓGICA: a regra some da lista e para de alertar, mas o histórico (ocorrências e envios)
 * continua. Não existe delete físico — a 0113 nem tem policy de DELETE, e a FK das ocorrências é
 * `restrict`. As ocorrências vivas dessa regra são encerradas SEM envio na próxima avaliação (o
 * mesmo caminho de "desativar"), que também tira o botão "Resolvido" das mensagens delas.
 */
export async function excluirRegra(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const agora = new Date().toISOString()
  const { data, error } = await sb
    .from('alerta_regras')
    .update({ excluida_em: agora, ativa: false, atualizado_em: agora })
    .eq('id', id)
    .is('excluida_em', null)
    .select('id')
  if (error) return { ok: false, erro: erroDeBanco(error) }
  if ((data ?? []).length === 0) return { ok: false, erro: 'Essa regra foi excluída.' }
  return { ok: true }
}

export async function definirRegraAtiva(
  id: string,
  ativa: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('alerta_regras')
    .update({ ativa, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, erro: erroDeBanco(error) }
  if ((data ?? []).length === 0) return { ok: false, erro: 'Essa regra foi excluída.' }
  return { ok: true }
}

/** Prévia por tipo (alerta_previa da 0115: parâmetros NOMEADOS — a assinatura antiga não existe mais). */
export async function previaRegra(
  p: PreviaValida,
): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_previa', {
    p_tipo: p.tipo,
    p_postos: p.postos,
    p_janela_tipo: p.janelaTipo,
    p_janela_valor: p.janelaValor,
    p_minimo: p.minimoBipes,
    p_pausa_max_min: p.pausaMaxMin,
    p_limite_ocorrencias: p.limiteOcorrencias,
    p_pmos: p.pmos,
  })
  if (error) return { ok: false, erro: mensagemErroAlerta(error.message) }
  const linhas = (data ?? []) as {
    posto: string
    defeito: string | null
    aprovados: number
    reprovados: number
    taxa: number | string | null
    media_seg: number | string | null
    intervalos: number
    pecas: number
    ocorrencias: number
    avaliavel: boolean
    pmo: string | null
    op: string | null
  }[]
  return {
    ok: true,
    postos: linhas.map((l) => ({
      posto: l.posto,
      defeito: l.defeito,
      aprovados: l.aprovados,
      reprovados: l.reprovados,
      taxa: numeroOuNulo(l.taxa),
      mediaSeg: numeroOuNulo(l.media_seg),
      intervalos: l.intervalos,
      pecas: l.pecas,
      ocorrencias: l.ocorrencias,
      avaliavel: l.avaliavel,
      pmo: l.pmo,
      op: l.op,
    })),
  }
}

/** PMOs que o formulário oferece (alerta_pmos: um text[] só, sem o teto de 1000 linhas). */
export async function listarPmosAlerta(): Promise<string[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_pmos')
  if (error) throw error
  const lista = Array.isArray(data) ? (data as unknown[]) : []
  return [...new Set(lista.map((p) => String(p ?? '').trim()).filter((p) => p !== ''))]
}

export async function listarDestinatarios(): Promise<DestinatarioDisponivel[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_destinatarios')
  if (error) throw error
  return ((data ?? []) as {
    usuario_id: string
    nome: string
    email: string
    telegram: boolean
    discord: boolean
  }[]).map((l) => ({
    usuarioId: l.usuario_id,
    nome: l.nome,
    email: l.email,
    telegram: l.telegram,
    discord: l.discord,
  }))
}

export async function listarOcorrencias(f: FiltroOcorrencias): Promise<OcorrenciaLinha[]> {
  const periodo = periodoOcorrencias(f.de, f.ate)
  if (!periodo) return []
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_listar_ocorrencias', {
    p_de: periodo.de,
    p_ate: periodo.ate,
    p_estado: f.estado,
  })
  if (error) throw error
  return ((data ?? []) as {
    id: string
    regra_id: string
    regra_nome: string
    posto: string
    pmo: string | null
    op: string | null
    estado: string
    taxa_abertura: number | string | null
    taxa_ultima: number | string | null
    aprovados: number
    reprovados: number
    aberta_em: string
    resolvida_por_nome: string | null
    resolvida_em: string | null
    normalizada_em: string | null
    envios_ok: number
    envios_falha: number
    regra_tipo: string | null
    defeito: string | null
    valor_abertura: number | string | null
    valor_ultimo: number | string | null
    amostras: number | null
  }[]).map((l) => ({
    id: l.id,
    regraId: l.regra_id,
    regraNome: l.regra_nome,
    regraTipo: ehTipoRegra(l.regra_tipo) ? l.regra_tipo : 'aprovacao',
    posto: l.posto,
    defeito: l.defeito,
    pmo: l.pmo,
    op: l.op,
    estado: (l.estado === 'resolvida' || l.estado === 'normalizada' ? l.estado : 'aberta') as EstadoOcorrencia,
    taxaAbertura: numeroOuNulo(l.taxa_abertura),
    taxaUltima: numeroOuNulo(l.taxa_ultima),
    valorAbertura: numeroOuNulo(l.valor_abertura),
    valorUltimo: numeroOuNulo(l.valor_ultimo),
    amostras: l.amostras,
    aprovados: l.aprovados,
    reprovados: l.reprovados,
    abertaEm: l.aberta_em,
    resolvidaPorNome: l.resolvida_por_nome ?? '',
    resolvidaEm: l.resolvida_em,
    normalizadaEm: l.normalizada_em,
    enviosOk: l.envios_ok,
    enviosFalha: l.envios_falha,
  }))
}

/** Resolver pela TELA (gestor). Quem resolve pelo botão da mensagem passa por alerta_resolver. */
export async function resolverOcorrenciaComoAdmin(id: string): Promise<ResultadoResolver> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_resolver_admin', { p_ocorrencia_id: id })
  if (error) {
    return { ok: false, codigo: codigoErroAlerta(error.message), erro: mensagemErroAlerta(error.message) }
  }
  return { ok: true, resolucao: lerResolucao(data) }
}
```

- [ ] **Step 4: `alertas-actions.ts` — imports, log e prévia**

Em `src/modules/alertas/application/alertas-actions.ts`, troque:

```ts
import { validarPrevia, validarRegra, type EntradaRegra } from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { resumoJanela } from '../domain/janela'
```

por:

```ts
import {
  resumoLimite,
  resumoPmos,
  validarPrevia,
  validarRegra,
  type EntradaPrevia,
  type EntradaRegra,
} from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { resumoJanela } from '../domain/janela'
import { NOME_TIPO_REGRA } from '../domain/tipos'
```

Troque o log da criação:

```ts
      descricao: `Regra de alerta "${v.valor.nome}" criada (${v.valor.postos.join(', ')}, ${resumoJanela({ tipo: v.valor.janelaTipo, valor: v.valor.janelaValor })})`,
```

por:

```ts
      descricao:
        `Regra de alerta "${v.valor.nome}" criada (${NOME_TIPO_REGRA[v.valor.tipo]}; ${v.valor.postos.join(', ')}; ` +
        `${resumoJanela({ tipo: v.valor.janelaTipo, valor: v.valor.janelaValor })}; limite ${resumoLimite(v.valor)}; ` +
        `PMOs: ${resumoPmos(v.valor.pmos)})`,
```

E troque a assinatura da prévia:

```ts
export async function previaRegraAction(entrada: {
  postos: string[]
  janelaTipo: string
  janelaValor: string | number | null
  minimoBipes: string | number
}): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
```

por:

```ts
export async function previaRegraAction(
  entrada: EntradaPrevia,
): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
```

(O corpo da `previaRegraAction` não muda: `validarPrevia(entrada)` já devolve a `PreviaValida` que o `previaRegra` novo recebe.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/modules/alertas`
Expected: PASS em todos os arquivos de `src/modules/alertas`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/alertas/infra/regras-repository.ts src/modules/alertas/application/alertas-actions.ts \
  src/modules/alertas/infra/__tests__/regras-repository-tipos.test.ts \
  src/modules/alertas/infra/__tests__/regras-repository.test.ts \
  src/modules/alertas/application/__tests__/alertas-actions.test.ts
git commit -m "feat(alertas): repositório e actions por tipo — tipo só no insert, prévia nova, ocorrências com defeito/valor, PMOs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Telas — escolha do tipo, formulário por tipo, PMOs, lista e ocorrências

**Files:**
- Create: `src/app/(app)/configuracoes/sf-alertas/tipo-escolha.tsx`
- Create: `src/app/(app)/configuracoes/sf-alertas/pmos-selecao.tsx`
- Modify (reescrever inteiro): `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx`
- Modify (reescrever inteiro): `src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx`
- Modify (reescrever inteiro): `src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx`
- Modify (reescrever inteiro): `src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx`
- Modify: `src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx`
- Modify (reescrever inteiro): `src/app/(app)/configuracoes/sf-alertas/page.tsx`
- Test (reescrever inteiro): `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx`
- Test (criar): `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-dialog.test.tsx`, `regras-lista.test.tsx`, `ocorrencias-lista.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`TipoRegra`, `TIPOS_REGRA`, `NOME_TIPO_REGRA`, `DESCRICAO_TIPO_REGRA`, `PADROES_REGRA`, `PADROES_TIPO`, `validarRegra`, `destinatariosSemCanal`, `resumoLimite`, `resumoPmos`, `formatarMmSs`, `textoPreviaPosto`, `formatarValorOcorrencia`, `rotuloDefeito`); Task 5 (`salvarRegraAction`, `previaRegraAction(EntradaPrevia)`, `listarPmosAlerta`, `listarRegras`, `listarOcorrencias`); `Explica` (já existe).
- Produces:
  - `TipoEscolha({ onEscolher }: { onEscolher: (tipo: TipoRegra) => void })`.
  - `PmosSelecao({ disponiveis, selecionadas, onChange }: { disponiveis: string[]; selecionadas: string[]; onChange: (pmos: string[]) => void })`.
  - `RegraForm` com as props novas `tipo: TipoRegra`, `pmosDisponiveis: string[]`, `onVoltar?: () => void`; `separarDestinatarios` e `ERRO_REGRA_EXCLUIDA` continuam exportados.
  - `RegraConteudo(props)` (escolha → formulário) e `RegraDialog(props & { aberto: boolean })`, ambos com `pmos: string[]`.
  - `RegrasLista` e `AlertasTela` com a prop nova `pmos: string[]`.

- [ ] **Step 1: Escrever os testes que falham**

Reescreva `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import type { TipoRegra } from '@/modules/alertas/domain/tipos'
import { RegraForm, separarDestinatarios } from '../regra-form'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) },
}))

const POSTOS = ['Teste', 'Embalagem']
const PMOS = ['PMOA', 'PMOB', 'PMOG13']
const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true },
  { usuarioId: 'u3', nome: 'Carla Operadora', email: 'carla@x', telegram: false, discord: false },
]
const CONFIGURADOS = { telegram: true, discord: true }
const TOAST = { position: 'bottom-center' }

const LINHA = {
  posto: 'Teste',
  defeito: null,
  aprovados: 0,
  reprovados: 0,
  taxa: null,
  mediaSeg: null,
  intervalos: 0,
  pecas: 0,
  ocorrencias: 0,
  avaliavel: false,
  pmo: null,
  op: null,
}

function regraSalva(extra: Partial<RegraAlerta>): RegraAlerta {
  return {
    id: 'r1',
    atualizadoEm: '2026-09-17T12:00:00Z',
    tipo: 'aprovacao',
    nome: 'Teste 90',
    postos: ['Teste'],
    taxaMinima: 90,
    janelaTipo: 'tempo',
    janelaValor: 60,
    minimoBipes: 20,
    limiteTempoSeg: null,
    limiteOcorrencias: null,
    pausaMaxMin: null,
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['u1'],
    pmos: [],
    ativa: true,
    ...extra,
  }
}

function montar(o: { tipo?: TipoRegra; regra?: RegraAlerta | null; onSalvo?: () => void } = {}) {
  const onSalvo = o.onSalvo ?? vi.fn()
  render(
    <RegraForm
      tipo={o.tipo ?? 'aprovacao'}
      regra={o.regra ?? null}
      postos={POSTOS}
      pmosDisponiveis={PMOS}
      destinatarios={DESTINATARIOS}
      configurados={CONFIGURADOS}
      onSalvo={onSalvo}
      onCancelar={vi.fn()}
    />,
  )
  return { onSalvo }
}

function preencherObrigatorios(nome: string) {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: nome } })
  fireEvent.click(screen.getByLabelText('Teste'))
  fireEvent.click(screen.getByLabelText('Telegram'))
  fireEvent.click(screen.getByLabelText('Ana Gestora'))
}

beforeEach(() => {
  vi.clearAllMocks()
  salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
  previaRegraAction.mockResolvedValue({
    ok: true,
    postos: [{ ...LINHA, aprovados: 15, reprovados: 5, taxa: 75, avaliavel: true }],
  })
})

describe('RegraForm — taxa de aprovação', () => {
  it('começa com os padrões da spec', () => {
    montar()
    expect(screen.getByLabelText('Taxa mínima de aprovação (%)')).toHaveValue('90')
    expect(screen.getByLabelText('Últimos minutos')).toHaveValue('60')
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('20')
    expect(screen.getByLabelText('Janela por bipes')).toBeInTheDocument()
  })

  it('salvar sem posto avisa e não chama a action', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Teste 90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Escolha pelo menos 1 posto.', TOAST))
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('avisa quem não recebe pelo canal escolhido', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Carla Operadora'))
    expect(screen.getByText('Carla Operadora sem Telegram')).toBeInTheDocument()
  })

  it('salva a regra com os valores digitados', async () => {
    const { onSalvo } = montar()
    preencherObrigatorios('Teste 90')
    fireEvent.change(screen.getByLabelText('Taxa mínima de aprovação (%)'), { target: { value: '92,5' } })
    fireEvent.change(screen.getByLabelText('Lembrar a cada (min)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction).toHaveBeenCalledWith(null, {
      tipo: 'aprovacao',
      nome: 'Teste 90',
      postos: ['Teste'],
      taxaMinima: '92,5',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '20',
      limiteTempo: '',
      pausaMaxMin: '',
      limiteOcorrencias: '',
      lembreteMin: '10',
      canais: ['telegram'],
      destinatarios: ['u1'],
      pmos: [],
      ativa: true,
    })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('janela por OP não manda valor de janela', async () => {
    montar()
    preencherObrigatorios('OP')
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ janelaTipo: 'op', janelaValor: null })
  })

  it('prévia mostra a taxa de agora de cada posto', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    await waitFor(() => expect(previaRegraAction).toHaveBeenCalled())
    expect(await screen.findByText('Teste: 75,0% (15 aprovados, 5 reprovados)')).toBeInTheDocument()
    expect(screen.getByText('Taxa de agora')).toBeInTheDocument()
  })

  it('destinatário salvo que ficou inativo ou sem permissão sai da regra, com aviso', async () => {
    const onSalvo = vi.fn()
    montar({ regra: regraSalva({ destinatarios: ['u1', 'u-inativo', 'u-sem-permissao'] }), onSalvo })
    expect(
      screen.getByText(
        '2 destinatário(s) inativo(s) ou sem permissão de administrar o ShopFloor removido(s) da regra — salve para confirmar.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Ana Gestora')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction.mock.calls[0]![0]).toBe('r1')
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ tipo: 'aprovacao', destinatarios: ['u1'] })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('regra sem destinatário removido não mostra o aviso', () => {
    montar()
    expect(screen.queryByText(/removido\(s\) da regra/)).not.toBeInTheDocument()
  })
})

describe('RegraForm — tempo médio por peça', () => {
  it('mostra só os campos do tipo, com os padrões', () => {
    montar({ tipo: 'tempo' })
    expect(screen.getByLabelText('Tempo máximo por peça (mm:ss)')).toHaveValue('2:00')
    expect(screen.getByLabelText('Mínimo de intervalos')).toHaveValue('10')
    expect(screen.getByLabelText('Ignorar pausas acima de (min)')).toHaveValue('30')
    expect(screen.getByLabelText('OP em andamento')).toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Janela por bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Repetições para alertar')).not.toBeInTheDocument()
  })

  it('salva o limite em mm:ss e a pausa', async () => {
    montar({ tipo: 'tempo' })
    preencherObrigatorios('Teste lento')
    fireEvent.change(screen.getByLabelText('Tempo máximo por peça (mm:ss)'), { target: { value: '2:30' } })
    fireEvent.change(screen.getByLabelText('Ignorar pausas acima de (min)'), { target: { value: '45' } })
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({
      tipo: 'tempo',
      limiteTempo: '2:30',
      pausaMaxMin: '45',
      minimoBipes: '10',
      janelaTipo: 'op',
      janelaValor: null,
      taxaMinima: '',
      limiteOcorrencias: '',
    })
  })

  it('mm:ss inválido avisa e não salva', async () => {
    montar({ tipo: 'tempo' })
    preencherObrigatorios('Teste lento')
    fireEvent.change(screen.getByLabelText('Tempo máximo por peça (mm:ss)'), { target: { value: '2:75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(toastErro).toHaveBeenCalledWith('Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00).', TOAST),
    )
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('editar mostra o limite salvo em mm:ss e a janela da regra', () => {
    montar({
      tipo: 'tempo',
      regra: regraSalva({
        tipo: 'tempo',
        taxaMinima: null,
        janelaTipo: 'op',
        janelaValor: null,
        minimoBipes: 8,
        limiteTempoSeg: 150,
        pausaMaxMin: 45,
      }),
    })
    expect(screen.getByLabelText('Tempo máximo por peça (mm:ss)')).toHaveValue('2:30')
    expect(screen.getByLabelText('Ignorar pausas acima de (min)')).toHaveValue('45')
    expect(screen.getByLabelText('Mínimo de intervalos')).toHaveValue('8')
    expect(screen.getByLabelText('OP em andamento')).toBeChecked()
  })

  it('prévia mostra o tempo médio de cada posto', async () => {
    previaRegraAction.mockResolvedValueOnce({
      ok: true,
      postos: [{ ...LINHA, mediaSeg: 68.33, intervalos: 29, pecas: 30, avaliavel: true }],
    })
    montar({ tipo: 'tempo' })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    expect(await screen.findByText('Teste: 1:08 por peça (29 intervalos, 30 peças)')).toBeInTheDocument()
    expect(previaRegraAction.mock.calls[0]![0]).toMatchObject({ tipo: 'tempo', pausaMaxMin: '30', minimoBipes: '10' })
  })
})

describe('RegraForm — defeito repetido', () => {
  it('mostra só as repetições e a janela por minutos', () => {
    montar({ tipo: 'defeito' })
    expect(screen.getByLabelText('Repetições para alertar')).toHaveValue('5')
    expect(screen.getByLabelText('Últimos minutos')).toHaveValue('60')
    expect(screen.queryByLabelText('Mínimo de bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Janela por tempo')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('OP em andamento')).not.toBeInTheDocument()
  })

  it('salva com janela por minutos e sem mínimo de bipes', async () => {
    montar({ tipo: 'defeito' })
    preencherObrigatorios('Defeito 3x')
    fireEvent.change(screen.getByLabelText('Repetições para alertar'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({
      tipo: 'defeito',
      janelaTipo: 'tempo',
      janelaValor: '60',
      limiteOcorrencias: '3',
      minimoBipes: '',
      taxaMinima: '',
    })
  })

  it('prévia lista os defeitos que chegam ao limite, por posto', async () => {
    previaRegraAction.mockResolvedValueOnce({
      ok: true,
      postos: [
        { ...LINHA, defeito: '2040 COMPONENTE FALTANDO', ocorrencias: 6, avaliavel: true },
        { ...LINHA, posto: 'Embalagem', avaliavel: true },
      ],
    })
    montar({ tipo: 'defeito' })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    expect(await screen.findByText('Teste: 2040 (Componente Faltando) — 6 vezes')).toBeInTheDocument()
    expect(screen.getByText('Embalagem: nenhum defeito repetido 5 vezes ou mais')).toBeInTheDocument()
    expect(screen.getByText('Defeitos repetidos agora')).toBeInTheDocument()
    expect(previaRegraAction.mock.calls[0]![0]).toMatchObject({
      tipo: 'defeito',
      janelaTipo: 'tempo',
      janelaValor: '60',
      limiteOcorrencias: '5',
    })
  })
})

describe('RegraForm — PMOs', () => {
  it('nenhuma marcada = todas; a busca filtra e a marcada vai no salvar', async () => {
    montar()
    expect(screen.getByText('Nenhuma marcada = todas as PMOs.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar PMO'), { target: { value: 'g1' } })
    expect(screen.queryByLabelText('PMO PMOA')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('PMO PMOG13'))
    preencherObrigatorios('Só a G13')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ pmos: ['PMOG13'] })
  })

  it('PMO salva que sumiu da lista continua aparecendo marcada', () => {
    montar({ regra: regraSalva({ pmos: ['PMOZ'] }) })
    expect(screen.getByLabelText('PMO PMOZ')).toBeChecked()
    expect(screen.getByLabelText('PMO PMOA')).not.toBeChecked()
  })
})

describe('separarDestinatarios', () => {
  it('descarta quem não está entre os disponíveis', () => {
    expect(separarDestinatarios(['u1', 'x', 'u3'], DESTINATARIOS)).toEqual({ validos: ['u1', 'u3'], descartados: 1 })
  })

  it('lista de disponíveis vazia (nada carregou) não descarta ninguém', () => {
    expect(separarDestinatarios(['u1', 'x'], [])).toEqual({ validos: ['u1', 'x'], descartados: 0 })
  })
})
```

Crie `src/app/(app)/configuracoes/sf-alertas/__tests__/regra-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraConteudo } from '../regra-dialog'

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PROPS = {
  postos: ['Teste'],
  pmos: ['PMOA'],
  destinatarios: [],
  configurados: { telegram: true, discord: true },
  onFechar: vi.fn(),
}

describe('RegraConteudo', () => {
  it('regra nova: 3 cartões; escolher abre o formulário do tipo; "Trocar tipo" volta', () => {
    render(<RegraConteudo regra={null} {...PROPS} />)
    expect(screen.getByRole('button', { name: /Taxa de aprovação/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Defeito repetido/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Tempo médio por peça/ }))
    expect(screen.getByLabelText('Tempo máximo por peça (mm:ss)')).toBeInTheDocument()
    expect(screen.getByText('Tempo médio por peça')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }))
    expect(screen.getByRole('button', { name: /Defeito repetido/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Tempo máximo por peça (mm:ss)')).not.toBeInTheDocument()
  })

  it('editar abre direto o formulário do tipo da regra, sem cartões nem "Trocar tipo"', () => {
    const regra: RegraAlerta = {
      id: 'r1',
      atualizadoEm: '2026-09-18T12:00:00Z',
      tipo: 'defeito',
      nome: 'Defeito 3x',
      postos: ['Teste'],
      taxaMinima: null,
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: null,
      limiteTempoSeg: null,
      limiteOcorrencias: 3,
      pausaMaxMin: null,
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1'],
      pmos: [],
      ativa: true,
    }
    render(<RegraConteudo regra={regra} {...PROPS} />)
    expect(screen.getByLabelText('Repetições para alertar')).toHaveValue('3')
    expect(screen.queryByRole('button', { name: /Taxa de aprovação/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trocar tipo' })).not.toBeInTheDocument()
  })
})
```

Crie `src/app/(app)/configuracoes/sf-alertas/__tests__/regras-lista.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegrasLista } from '../regras-lista'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  alternarRegraAtivaAction: vi.fn(),
  excluirRegraAction: vi.fn(),
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE: RegraAlerta = {
  id: 'r1',
  atualizadoEm: '2026-09-18T12:00:00Z',
  tipo: 'tempo',
  nome: 'Teste lento',
  postos: ['Teste'],
  taxaMinima: null,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 10,
  limiteTempoSeg: 120,
  limiteOcorrencias: null,
  pausaMaxMin: 30,
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  pmos: ['PMOX', 'PMOY'],
  ativa: true,
}

describe('RegrasLista', () => {
  it('mostra o tipo, o limite formatado por tipo e as PMOs', () => {
    render(
      <RegrasLista
        regras={[
          BASE,
          {
            ...BASE,
            id: 'r2',
            tipo: 'defeito',
            nome: 'Defeito 5x',
            minimoBipes: null,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            limiteOcorrencias: 5,
            pmos: [],
          },
        ]}
        postos={['Teste']}
        pmos={['PMOX']}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false }]}
        configurados={{ telegram: true, discord: true }}
      />,
    )
    expect(screen.getAllByText('Tipo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tempo médio por peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Defeito repetido').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≤ 2:00/peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≥ 5 vezes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PMOX, PMOY').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Todas').length).toBeGreaterThan(0)
  })
})
```

Crie `src/app/(app)/configuracoes/sf-alertas/__tests__/ocorrencias-lista.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { OcorrenciasLista } from '../ocorrencias-lista'

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  listarOcorrenciasAction: vi.fn(),
  resolverOcorrenciaAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE: OcorrenciaLinha = {
  id: 'o1',
  regraId: 'g1',
  regraNome: 'Defeito 3x',
  regraTipo: 'defeito',
  posto: 'Teste',
  defeito: '2040 COMPONENTE FALTANDO',
  pmo: null,
  op: null,
  estado: 'aberta',
  taxaAbertura: null,
  taxaUltima: null,
  valorAbertura: 3,
  valorUltimo: 4,
  amostras: 4,
  aprovados: 0,
  reprovados: 0,
  abertaEm: '2026-09-18T12:00:00Z',
  resolvidaPorNome: '',
  resolvidaEm: null,
  normalizadaEm: null,
  enviosOk: 2,
  enviosFalha: 0,
}

describe('OcorrenciasLista', () => {
  it('mostra o defeito (código + descrição) e o valor medido na régua de cada tipo', () => {
    render(
      <OcorrenciasLista
        ocorrenciasIniciais={[
          BASE,
          { ...BASE, id: 'o2', regraNome: 'Lento', regraTipo: 'tempo', defeito: null, valorAbertura: 180, valorUltimo: 200 },
          {
            ...BASE,
            id: 'o3',
            regraNome: 'Taxa 90',
            regraTipo: 'aprovacao',
            defeito: null,
            taxaAbertura: 75,
            taxaUltima: 88.88,
            valorAbertura: 75,
            valorUltimo: 88.88,
          },
        ]}
        filtroInicial={{ de: '2026-09-12', ate: '2026-09-18', estado: '' }}
      />,
    )
    expect(screen.getByText('Defeito')).toBeInTheDocument()
    expect(screen.getByText('2040 (Componente Faltando)')).toBeInTheDocument()
    expect(screen.getByText('3 vezes')).toBeInTheDocument()
    expect(screen.getByText('4 vezes')).toBeInTheDocument()
    expect(screen.getByText('3:00/peça')).toBeInTheDocument()
    expect(screen.getByText('3:20/peça')).toBeInTheDocument()
    expect(screen.getByText('75,0%')).toBeInTheDocument()
    expect(screen.getByText('88,8%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(app)/configuracoes/sf-alertas"`
Expected: FAIL — `Tempo máximo por peça (mm:ss)`/`Repetições para alertar`/`Buscar PMO` não encontrados, `RegraConteudo` não exportado, colunas `Tipo`/`Defeito` inexistentes, e o `toHaveBeenCalledWith` do salvar sem `tipo`/`pmos`.

- [ ] **Step 3: Criar `src/app/(app)/configuracoes/sf-alertas/tipo-escolha.tsx`**

```tsx
'use client'

import { Button } from '@/components/ui/button'
import { DESCRICAO_TIPO_REGRA, NOME_TIPO_REGRA, TIPOS_REGRA, type TipoRegra } from '@/modules/alertas/domain/tipos'

/** Regra nova começa aqui: um cartão por tipo (título + uma frase). O tipo não muda depois. */
export function TipoEscolha({ onEscolher }: { onEscolher: (tipo: TipoRegra) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {TIPOS_REGRA.map((t) => (
        <Button
          key={t}
          type="button"
          variant="outline"
          onClick={() => onEscolher(t)}
          className="h-auto flex-col items-start justify-start gap-1 whitespace-normal p-4 text-left"
        >
          <span className="text-sm font-semibold">{NOME_TIPO_REGRA[t]}</span>
          <span className="text-xs font-normal text-muted-foreground">{DESCRICAO_TIPO_REGRA[t]}</span>
        </Button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Criar `src/app/(app)/configuracoes/sf-alertas/pmos-selecao.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Explica } from './explica'

/**
 * PMOs da regra: lista de marcar com busca. Nenhuma marcada = todas as PMOs. Uma PMO salva que não
 * está mais na lista (OP apagada, por exemplo) continua aparecendo — marcada — para não sumir calada.
 */
export function PmosSelecao({
  disponiveis,
  selecionadas,
  onChange,
}: {
  disponiveis: string[]
  selecionadas: string[]
  onChange: (pmos: string[]) => void
}) {
  const [busca, setBusca] = useState('')
  const todas = [...new Set([...selecionadas, ...disponiveis])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const filtro = busca.trim().toUpperCase()
  const visiveis = filtro ? todas.filter((p) => p.toUpperCase().includes(filtro)) : todas

  function alternar(pmo: string) {
    onChange(selecionadas.includes(pmo) ? selecionadas.filter((p) => p !== pmo) : [...selecionadas, pmo])
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex items-center gap-1.5 text-sm font-medium">
        PMOs
        <Explica titulo="PMOs">
          <p>Limita a conta aos bipes dessas PMOs. <strong>Nenhuma marcada = todas as PMOs.</strong></p>
          <p>Na janela <strong>OP em andamento</strong>, vale a OP do último bipe do posto entre as PMOs marcadas.</p>
        </Explica>
      </legend>
      <Input aria-label="Buscar PMO" placeholder="Buscar PMO" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <div className="flex max-h-40 flex-wrap gap-3 overflow-y-auto rounded-md border border-border p-3">
        {visiveis.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma PMO encontrada.</span>}
        {visiveis.map((p) => (
          <label key={p} className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={`PMO ${p}`} checked={selecionadas.includes(p)} onChange={() => alternar(p)} />
            {p}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Nenhuma marcada = todas as PMOs.</p>
      {selecionadas.length > 0 && (
        <p className="text-xs text-muted-foreground">Marcadas: {selecionadas.join(', ')}</p>
      )}
    </fieldset>
  )
}
```

- [ ] **Step 5: Reescrever `src/app/(app)/configuracoes/sf-alertas/regra-form.tsx` inteiro**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CANAIS, NOME_CANAL, type Canal, type JanelaTipo, type TipoRegra } from '@/modules/alertas/domain/tipos'
import {
  PADROES_REGRA,
  PADROES_TIPO,
  destinatariosSemCanal,
  validarRegra,
  type DestinatarioDisponivel,
  type EntradaRegra,
  type RegraAlerta,
} from '@/modules/alertas/domain/regra'
import { formatarMmSs } from '@/modules/alertas/domain/tempo'
import { textoPreviaPosto, type PreviaPosto } from '@/modules/alertas/domain/ocorrencia'
import { previaRegraAction, salvarRegraAction } from '@/modules/alertas/application/alertas-actions'
import { Explica } from './explica'
import { PmosSelecao } from './pmos-selecao'

const TOAST = { position: 'bottom-center' } as const
/** Mensagem do repositório quando a regra já foi excluída (exclusão lógica) por outro gestor. */
export const ERRO_REGRA_EXCLUIDA = 'Essa regra foi excluída.'

/** As janelas que cada tipo aceita (spec 2026-09-18, §2). */
const JANELAS: Record<TipoRegra, JanelaTipo[]> = {
  aprovacao: ['tempo', 'bipes', 'op'],
  tempo: ['tempo', 'op'],
  defeito: ['tempo'],
}

const TITULO_PREVIA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de agora',
  tempo: 'Tempo médio de agora',
  defeito: 'Defeitos repetidos agora',
}

const EXPLICA_POSTOS: Record<TipoRegra, string> = {
  aprovacao:
    'A taxa é calculada separada para cada posto marcado. Cada posto que ficar abaixo da meta abre o seu próprio alerta.',
  tempo:
    'O tempo médio é calculado separado para cada posto marcado. Cada posto que passar do limite abre o seu próprio alerta.',
  defeito:
    'Os defeitos são contados separados para cada posto marcado. Cada defeito que se repetir num posto abre o seu próprio alerta.',
}

/**
 * Destinatários salvos que não estão mais entre os disponíveis (usuário desativado, removido ou que
 * perdeu shopfloor.administrar — `alerta_destinatarios` só devolve ativos que administram o
 * ShopFloor). Saem da seleção ao abrir o formulário; o aviso pede para salvar e confirmar. Lista de
 * disponíveis vazia = nada carregou: não descarta ninguém.
 */
export function separarDestinatarios(
  salvos: string[],
  disponiveis: DestinatarioDisponivel[],
): { validos: string[]; descartados: number } {
  if (disponiveis.length === 0) return { validos: salvos, descartados: 0 }
  const ids = new Set(disponiveis.map((d) => d.usuarioId))
  const validos = salvos.filter((id) => ids.has(id))
  return { validos, descartados: salvos.length - validos.length }
}

function alterna<T>(lista: T[], item: T): T[] {
  return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item]
}

function janelaInicial(tipo: TipoRegra, regra: RegraAlerta | null): JanelaTipo {
  const salva = regra?.janelaTipo ?? 'tempo'
  return JANELAS[tipo].includes(salva) ? salva : 'tempo'
}

function minutosIniciais(tipo: TipoRegra, regra: RegraAlerta | null): string {
  if (regra && regra.janelaTipo === 'tempo' && regra.janelaValor !== null) return String(regra.janelaValor)
  return String(tipo === 'aprovacao' ? PADROES_REGRA.janelaTempo : PADROES_TIPO[tipo].janelaTempo)
}

function minimoInicial(tipo: TipoRegra, regra: RegraAlerta | null): string {
  if (regra && regra.minimoBipes !== null) return String(regra.minimoBipes)
  return String(tipo === 'tempo' ? PADROES_TIPO.tempo.minimoIntervalos : PADROES_REGRA.minimoBipes)
}

export function RegraForm({
  tipo,
  regra,
  postos,
  pmosDisponiveis,
  destinatarios,
  configurados,
  onSalvo,
  onCancelar,
  onVoltar,
  onRegraExcluida,
}: {
  tipo: TipoRegra
  regra: RegraAlerta | null
  postos: string[]
  pmosDisponiveis: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  onSalvo: () => void
  onCancelar: () => void
  /** Só na regra nova: volta para a escolha do tipo. */
  onVoltar?: () => void
  /** A regra foi excluída por outro gestor enquanto o diálogo estava aberto. */
  onRegraExcluida?: () => void
}) {
  const [nome, setNome] = useState(regra?.nome ?? '')
  const [postosSel, setPostosSel] = useState<string[]>(regra?.postos ?? [])
  const [taxa, setTaxa] = useState(String(regra?.taxaMinima ?? PADROES_REGRA.taxaMinima).replace('.', ','))
  const [limiteTempo, setLimiteTempo] = useState(
    regra && regra.limiteTempoSeg !== null ? formatarMmSs(regra.limiteTempoSeg) : PADROES_TIPO.tempo.limiteTempo,
  )
  const [pausa, setPausa] = useState(String(regra?.pausaMaxMin ?? PADROES_TIPO.tempo.pausaMaxMin))
  const [repeticoes, setRepeticoes] = useState(
    String(regra?.limiteOcorrencias ?? PADROES_TIPO.defeito.limiteOcorrencias),
  )
  const [janelaTipo, setJanelaTipo] = useState<JanelaTipo>(janelaInicial(tipo, regra))
  const [minutos, setMinutos] = useState(minutosIniciais(tipo, regra))
  const [bipes, setBipes] = useState(
    String(
      regra?.janelaTipo === 'bipes' ? (regra.janelaValor ?? PADROES_REGRA.janelaBipes) : PADROES_REGRA.janelaBipes,
    ),
  )
  const [minimo, setMinimo] = useState(minimoInicial(tipo, regra))
  const [lembrete, setLembrete] = useState(regra?.lembreteMin === null || regra === null ? '' : String(regra.lembreteMin))
  const [canaisSel, setCanaisSel] = useState<Canal[]>(regra?.canais ?? [])
  const [inicioDest] = useState(() => separarDestinatarios(regra?.destinatarios ?? [], destinatarios))
  const [destSel, setDestSel] = useState<string[]>(inicioDest.validos)
  const [pmosSel, setPmosSel] = useState<string[]>(regra?.pmos ?? [])
  const [previa, setPrevia] = useState<{ linhas: PreviaPosto[]; limite: number | null } | null>(null)
  const [pendente, startTransition] = useTransition()

  const avisos = destinatariosSemCanal(destinatarios, destSel, canaisSel)
  const janelaValor = janelaTipo === 'tempo' ? minutos : janelaTipo === 'bipes' ? bipes : null

  function entrada(): EntradaRegra {
    return {
      tipo,
      nome,
      postos: postosSel,
      taxaMinima: tipo === 'aprovacao' ? taxa : '',
      janelaTipo,
      janelaValor,
      minimoBipes: tipo === 'defeito' ? '' : minimo,
      limiteTempo: tipo === 'tempo' ? limiteTempo : '',
      pausaMaxMin: tipo === 'tempo' ? pausa : '',
      limiteOcorrencias: tipo === 'defeito' ? repeticoes : '',
      lembreteMin: lembrete,
      canais: canaisSel,
      destinatarios: destSel,
      pmos: pmosSel,
      ativa: regra?.ativa ?? true,
    }
  }

  function salvar() {
    // Mesma validação do servidor, antes de ir ao banco: o gestor vê o erro na hora.
    const dados = entrada()
    const v = validarRegra(dados)
    if (!v.ok) {
      toast.error(v.erro, TOAST)
      return
    }
    startTransition(async () => {
      const r = await salvarRegraAction(regra?.id ?? null, dados)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        if (r.erro === ERRO_REGRA_EXCLUIDA) onRegraExcluida?.()
        return
      }
      toast.success(regra ? 'Regra alterada' : 'Regra criada', TOAST)
      onSalvo()
    })
  }

  function verPrevia() {
    startTransition(async () => {
      const r = await previaRegraAction({
        tipo,
        postos: postosSel,
        janelaTipo,
        janelaValor,
        minimoBipes: tipo === 'defeito' ? '' : minimo,
        pausaMaxMin: tipo === 'tempo' ? pausa : '',
        limiteOcorrencias: tipo === 'defeito' ? repeticoes : '',
        pmos: pmosSel,
      })
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      const limite = Number.parseInt(repeticoes, 10)
      setPrevia({ linhas: r.postos, limite: tipo === 'defeito' && Number.isFinite(limite) ? limite : null })
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="nome">Nome</Label>
        <Input
          id="nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={tipo === 'tempo' ? 'Teste lento' : tipo === 'defeito' ? 'Defeito repetido no Teste' : 'Teste abaixo de 90'}
          autoComplete="off"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Postos
          <Explica titulo="Postos">
            <p>Os postos que esta regra acompanha.</p>
            <p>{EXPLICA_POSTOS[tipo]}</p>
          </Explica>
        </legend>
        <div className="flex flex-wrap gap-3">
          {postos.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id={`posto-${p}`}
                aria-label={p}
                checked={postosSel.includes(p)}
                onChange={() => setPostosSel((atual) => alterna(atual, p))}
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      {tipo === 'aprovacao' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="taxa">Taxa mínima de aprovação (%)</Label>
              <Explica titulo="Taxa mínima de aprovação (%)">
                <p>A meta de aprovação do posto. Se a taxa ficar <strong>abaixo</strong> dela, o alerta é enviado.</p>
                <p>Taxa = aprovados ÷ (aprovados + reprovados) × 100, contando só os bipes com resultado <strong>Aprovado</strong> ou <strong>Reprovado</strong> dentro da janela. Bipes só com Registrado ficam de fora.</p>
                <p>Ex.: 45 aprovados e 5 reprovados = 90%. Com meta 95, alerta; com meta 90, não.</p>
                <p>A conta é refeita a cada 5 minutos.</p>
              </Explica>
            </div>
            <Input id="taxa" value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="minimo">Mínimo de bipes</Label>
              <Explica titulo="Mínimo de bipes">
                <p>Quantos bipes com resultado (aprovados + reprovados) a janela precisa ter para a regra avaliar.</p>
                <p>Evita alarme falso com poucas peças: com 1 reprova em 2 bipes a taxa seria 50%. Abaixo do mínimo, a regra não abre nem encerra alerta.</p>
              </Explica>
            </div>
            <Input id="minimo" value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      )}

      {tipo === 'tempo' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="limite-tempo">Tempo máximo por peça (mm:ss)</Label>
              <Explica titulo="Tempo máximo por peça (mm:ss)">
                <p>O tempo médio entre um bipe e o próximo no posto (a cadência). Se a média ficar <strong>acima</strong> deste tempo, o alerta é enviado.</p>
                <p>Conta todos os bipes do posto, com qualquer resultado. Um bipe com várias linhas de defeito conta como uma peça só.</p>
                <p>Ex.: 2:00 = até 2 minutos por peça. De 0:01 a 60:00.</p>
              </Explica>
            </div>
            <Input
              id="limite-tempo"
              value={limiteTempo}
              onChange={(e) => setLimiteTempo(e.target.value)}
              placeholder="2:00"
              inputMode="numeric"
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="minimo">Mínimo de intervalos</Label>
              <Explica titulo="Mínimo de intervalos">
                <p>Quantos intervalos válidos (entre dois bipes seguidos) a janela precisa ter para a regra avaliar. 11 bipes seguidos = 10 intervalos.</p>
                <p>Abaixo do mínimo, a regra não abre nem encerra alerta.</p>
              </Explica>
            </div>
            <Input id="minimo" value={minimo} onChange={(e) => setMinimo(e.target.value)} inputMode="numeric" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="pausa">Ignorar pausas acima de (min)</Label>
              <Explica titulo="Ignorar pausas acima de (min)">
                <p>Intervalos maiores que isto (almoço, troca de turno, máquina parada) ficam <strong>fora</strong> da média e não contam como intervalo válido.</p>
                <p>Padrão 30 minutos; de 1 a 240.</p>
              </Explica>
            </div>
            <Input id="pausa" value={pausa} onChange={(e) => setPausa(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      )}

      {tipo === 'defeito' && (
        <div className="flex flex-col gap-2 sm:max-w-xs">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="repeticoes">Repetições para alertar</Label>
            <Explica titulo="Repetições para alertar">
              <p>Quantas vezes o <strong>mesmo</strong> código de defeito precisa aparecer em bipes <strong>reprovados</strong> do posto, dentro da janela, para alertar.</p>
              <p>Cada defeito que chegar a esse número abre o seu próprio alerta, e normaliza sozinho quando volta a ficar abaixo. Mínimo 2.</p>
            </Explica>
          </div>
          <Input id="repeticoes" value={repeticoes} onChange={(e) => setRepeticoes(e.target.value)} inputMode="numeric" />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Janela
          <Explica titulo="Janela">
            {tipo === 'defeito' ? (
              <p>Os bipes <strong>reprovados</strong> do posto nos últimos X minutos, de todas as OPs (até 7 dias).</p>
            ) : (
              <>
                <p>{tipo === 'tempo' ? 'Quais bipes entram na média:' : 'Quais bipes entram na conta da taxa:'}</p>
                <p><strong>Últimos X minutos</strong>: os bipes do posto nesse período, de todas as OPs (até 7 dias).</p>
                {tipo === 'aprovacao' && (
                  <p><strong>Últimos N bipes</strong>: os N bipes com resultado mais recentes do posto, de todas as OPs, olhando no máximo 30 dias. Precisa ser maior ou igual ao mínimo de bipes.</p>
                )}
                <p><strong>OP em andamento</strong>: todos os bipes do posto na OP do último bipe dele. Se o posto está parado há mais de 2 horas, não avalia.</p>
              </>
            )}
          </Explica>
        </legend>
        {tipo === 'defeito' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Últimos</span>
            <Input
              aria-label="Últimos minutos"
              className="w-20"
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              inputMode="numeric"
            />
            <span>minutos</span>
          </div>
        ) : (
          <>
            {/* Rádio e campo ficam FORA de um <label> comum de propósito: um label envolvendo dois
                controles deixa "Últimos minutos" ambíguo (para o leitor de tela e para o teste). */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="radio"
                name="janela"
                aria-label="Janela por tempo"
                checked={janelaTipo === 'tempo'}
                onChange={() => setJanelaTipo('tempo')}
              />
              <span>Últimos</span>
              <Input
                aria-label="Últimos minutos"
                className="w-20"
                value={minutos}
                onChange={(e) => setMinutos(e.target.value)}
                inputMode="numeric"
                disabled={janelaTipo !== 'tempo'}
              />
              <span>minutos</span>
            </div>
            {JANELAS[tipo].includes('bipes') && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="janela"
                  aria-label="Janela por bipes"
                  checked={janelaTipo === 'bipes'}
                  onChange={() => setJanelaTipo('bipes')}
                />
                <span>Últimos</span>
                <Input
                  aria-label="Quantidade de bipes"
                  className="w-20"
                  value={bipes}
                  onChange={(e) => setBipes(e.target.value)}
                  inputMode="numeric"
                  disabled={janelaTipo !== 'bipes'}
                />
                <span>bipes</span>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="janela"
                aria-label="OP em andamento"
                checked={janelaTipo === 'op'}
                onChange={() => setJanelaTipo('op')}
              />
              OP em andamento
            </label>
          </>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <Label htmlFor="lembrete">Lembrar a cada (min)</Label>
          <Explica titulo="Lembrar a cada (min)">
            <p>Enquanto o problema continuar e ninguém apertar <strong>Resolvido</strong>, o alerta é reenviado a cada X minutos.</p>
            <p>Vazio = só um alerta quando começa e um aviso quando normaliza.</p>
          </Explica>
        </div>
        <Input
          id="lembrete"
          value={lembrete}
          onChange={(e) => setLembrete(e.target.value)}
          inputMode="numeric"
          placeholder="vazio = sem lembrete"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Canais</legend>
        <div className="flex gap-4">
          {CANAIS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={NOME_CANAL[c]}
                checked={canaisSel.includes(c)}
                onChange={() => setCanaisSel((atual) => alterna(atual, c))}
              />
              {NOME_CANAL[c]}
              {!configurados[c] && <span className="text-xs text-muted-foreground">(não configurado)</span>}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Destinatários
          <Explica titulo="Destinatários">
            <p>Só aparecem usuários ativos que podem <strong>administrar o ShopFloor</strong>. Quem perder essa permissão para de receber, mesmo continuando na regra.</p>
          </Explica>
        </legend>
        <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3">
          {destinatarios.map((d) => (
            <label key={d.usuarioId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={d.nome}
                checked={destSel.includes(d.usuarioId)}
                onChange={() => setDestSel((atual) => alterna(atual, d.usuarioId))}
              />
              {d.nome}
              <span className="text-xs text-muted-foreground">
                Telegram {d.telegram ? '✓' : '—'} · Discord {d.discord ? '✓' : '—'}
              </span>
            </label>
          ))}
        </div>
        {inicioDest.descartados > 0 && (
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {inicioDest.descartados} destinatário(s) inativo(s) ou sem permissão de administrar o ShopFloor removido(s)
            da regra — salve para confirmar.
          </p>
        )}
        {avisos.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-amber-700 dark:text-amber-400">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </fieldset>

      <PmosSelecao disponiveis={pmosDisponiveis} selecionadas={pmosSel} onChange={setPmosSel} />

      {previa && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-3 text-sm">
          <span className="font-medium">{TITULO_PREVIA[tipo]}</span>
          {previa.linhas.map((p) => (
            <span key={`${p.posto}|${p.defeito ?? ''}`} className="text-muted-foreground">
              {textoPreviaPosto(tipo, p, previa.limite)}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onVoltar && (
          <Button variant="ghost" onClick={onVoltar} disabled={pendente} className="mr-auto">
            Trocar tipo
          </Button>
        )}
        <Button variant="ghost" onClick={onCancelar} disabled={pendente}>
          Cancelar
        </Button>
        <Button variant="outline" onClick={verPrevia} disabled={pendente}>
          Ver prévia
        </Button>
        <Button onClick={salvar} disabled={pendente} className="bg-enterplak hover:bg-enterplak-700">
          {pendente ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </div>
  )
}
```

Nota: o aviso de destinatário descartado fica numa linha só no DOM (o JSX quebra a linha só no código-fonte; o React junta o texto com um espaço) — o teste procura a frase inteira.

- [ ] **Step 6: Reescrever `src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx` inteiro**

```tsx
'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NOME_TIPO_REGRA, type Canal, type TipoRegra } from '@/modules/alertas/domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraForm } from './regra-form'
import { TipoEscolha } from './tipo-escolha'

interface PropsRegra {
  regra: RegraAlerta | null
  postos: string[]
  pmos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
  onFechar: () => void
  onRegraExcluida?: () => void
}

/**
 * Regra nova: primeiro os 3 cartões de tipo, depois o formulário do tipo escolhido ("Trocar tipo"
 * volta). Editar: direto no formulário do tipo da regra — o tipo não muda depois de criado.
 */
export function RegraConteudo({ regra, postos, pmos, destinatarios, configurados, onFechar, onRegraExcluida }: PropsRegra) {
  const [escolhido, setEscolhido] = useState<TipoRegra | null>(null)
  const tipo = regra?.tipo ?? escolhido

  if (!tipo) return <TipoEscolha onEscolher={setEscolhido} />

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Tipo: <strong className="text-foreground">{NOME_TIPO_REGRA[tipo]}</strong>
      </p>
      <RegraForm
        tipo={tipo}
        regra={regra}
        postos={postos}
        pmosDisponiveis={pmos}
        destinatarios={destinatarios}
        configurados={configurados}
        onSalvo={onFechar}
        onCancelar={onFechar}
        onVoltar={regra ? undefined : () => setEscolhido(null)}
        onRegraExcluida={onRegraExcluida}
      />
    </div>
  )
}

export function RegraDialog({ aberto, ...props }: PropsRegra & { aberto: boolean }) {
  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && props.onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.regra ? 'Editar regra' : 'Nova regra'}</DialogTitle>
          {!props.regra && (
            <DialogDescription>Escolha o que a regra acompanha. O tipo não muda depois de criado.</DialogDescription>
          )}
        </DialogHeader>
        {/* Monta de novo a cada abertura: a escolha do tipo não sobra de uma regra para a outra. */}
        {aberto && <RegraConteudo key={props.regra?.id ?? 'nova'} {...props} />}
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 7: Reescrever `src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx` inteiro**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { resumoJanela } from '@/modules/alertas/domain/janela'
import { NOME_CANAL, NOME_TIPO_REGRA, type Canal } from '@/modules/alertas/domain/tipos'
import {
  resumoLimite,
  resumoPmos,
  type DestinatarioDisponivel,
  type RegraAlerta,
} from '@/modules/alertas/domain/regra'
import { alternarRegraAtivaAction, excluirRegraAction } from '@/modules/alertas/application/alertas-actions'
import { RegraDialog } from './regra-dialog'
import { ERRO_REGRA_EXCLUIDA } from './regra-form'

const TOAST = { position: 'bottom-center' } as const

export function RegrasLista({
  regras,
  postos,
  pmos,
  destinatarios,
  configurados,
}: {
  regras: RegraAlerta[]
  postos: string[]
  pmos: string[]
  destinatarios: DestinatarioDisponivel[]
  configurados: Record<Canal, boolean>
}) {
  const [dialogo, setDialogo] = useState<{ aberto: boolean; regra: RegraAlerta | null }>({ aberto: false, regra: null })
  const [pendente, startTransition] = useTransition()
  const { confirmar, dialog } = useConfirmacao()
  const router = useRouter()

  // Erro da action: toast embaixo; se outro gestor já excluiu a regra, recarrega a lista (ela some).
  function falhou(erro: string) {
    toast.error(erro, TOAST)
    if (erro === ERRO_REGRA_EXCLUIDA) router.refresh()
  }

  const nomes = new Map(destinatarios.map((d) => [d.usuarioId, d.nome]))

  function alternar(regra: RegraAlerta, ativa: boolean) {
    startTransition(async () => {
      const r = await alternarRegraAtivaAction(regra.id, ativa)
      if (!r.ok) falhou(r.erro)
      else toast.success(ativa ? 'Regra ativada' : 'Regra desativada', TOAST)
    })
  }

  async function excluir(regra: RegraAlerta) {
    const ok = await confirmar({
      titulo: `Excluir "${regra.nome}"?`,
      descricao: 'A regra sai da lista e para de alertar; o histórico de ocorrências continua disponível.',
    })
    if (!ok) return
    startTransition(async () => {
      const r = await excluirRegraAction(regra.id)
      if (!r.ok) falhou(r.erro)
      else toast.success('Regra excluída', TOAST)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          className="bg-enterplak hover:bg-enterplak-700"
          onClick={() => setDialogo({ aberto: true, regra: null })}
        >
          <PlusIcon /> Nova regra
        </Button>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Postos</TableHead>
              <TableHead>Limite</TableHead>
              <TableHead>Janela</TableHead>
              <TableHead>PMOs</TableHead>
              <TableHead>Destinatários</TableHead>
              <TableHead>Canais</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regras.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  Nenhuma regra de alerta cadastrada.
                </TableCell>
              </TableRow>
            )}
            {regras.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell>{NOME_TIPO_REGRA[r.tipo]}</TableCell>
                <TableCell>{r.postos.join(', ')}</TableCell>
                <TableCell>{resumoLimite(r)}</TableCell>
                <TableCell>{resumoJanela({ tipo: r.janelaTipo, valor: r.janelaValor })}</TableCell>
                <TableCell>{resumoPmos(r.pmos)}</TableCell>
                <TableCell>{r.destinatarios.map((id) => nomes.get(id) ?? '—').join(', ')}</TableCell>
                <TableCell>{r.canais.map((c) => NOME_CANAL[c]).join(', ')}</TableCell>
                <TableCell>
                  <Switch checked={r.ativa} disabled={pendente} onCheckedChange={(valor) => alternar(r, valor)} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Editar regra"
                      onClick={() => setDialogo({ aberto: true, regra: r })}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Excluir regra"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={pendente}
                      onClick={() => excluir(r)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 lg:hidden">
        {regras.length === 0 && (
          <p className="rounded-lg border border-border bg-card py-8 text-center text-sm text-muted-foreground">
            Nenhuma regra de alerta cadastrada.
          </p>
        )}
        {regras.map((r) => (
          <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.nome}</span>
              <Switch checked={r.ativa} disabled={pendente} onCheckedChange={(valor) => alternar(r, valor)} />
            </div>
            <span className="text-sm text-muted-foreground">
              {NOME_TIPO_REGRA[r.tipo]} · {resumoLimite(r)} · {r.postos.join(', ')} ·{' '}
              {resumoJanela({ tipo: r.janelaTipo, valor: r.janelaValor })} · PMOs: {resumoPmos(r.pmos)}
            </span>
            <span className="text-xs text-muted-foreground">
              {r.canais.map((c) => NOME_CANAL[c]).join(', ')} ·{' '}
              {r.destinatarios.map((id) => nomes.get(id) ?? '—').join(', ')}
            </span>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Editar regra" onClick={() => setDialogo({ aberto: true, regra: r })}>
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Excluir regra"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={pendente}
                onClick={() => excluir(r)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <RegraDialog
        aberto={dialogo.aberto}
        regra={dialogo.regra}
        postos={postos}
        pmos={pmos}
        destinatarios={destinatarios}
        configurados={configurados}
        onFechar={() => setDialogo({ aberto: false, regra: null })}
        onRegraExcluida={() => {
          setDialogo({ aberto: false, regra: null })
          router.refresh()
        }}
      />
      {dialog}
    </div>
  )
}
```

- [ ] **Step 8: Reescrever `src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx` inteiro**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatarDataHoraCurta, rotuloDefeito } from '@/modules/alertas/domain/mensagens'
import { NOME_TIPO_REGRA, type EstadoOcorrencia } from '@/modules/alertas/domain/tipos'
import {
  formatarValorOcorrencia,
  type FiltroOcorrencias,
  type OcorrenciaLinha,
} from '@/modules/alertas/domain/ocorrencia'
import { listarOcorrenciasAction, resolverOcorrenciaAction } from '@/modules/alertas/application/alertas-actions'

const TOAST = { position: 'bottom-center' } as const

function quando(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatarDataHoraCurta(d)
}

function Estado({ estado }: { estado: EstadoOcorrencia }) {
  if (estado === 'aberta') return <Badge variant="destructive">Aberta</Badge>
  if (estado === 'resolvida') return <Badge variant="secondary">Resolvida</Badge>
  return <Badge variant="outline">Normalizada</Badge>
}

export function OcorrenciasLista({
  ocorrenciasIniciais,
  filtroInicial,
}: {
  ocorrenciasIniciais: OcorrenciaLinha[]
  filtroInicial: FiltroOcorrencias
}) {
  const [filtro, setFiltro] = useState<FiltroOcorrencias>(filtroInicial)
  const [lista, setLista] = useState<OcorrenciaLinha[]>(ocorrenciasIniciais)
  const [pendente, startTransition] = useTransition()

  function buscar(novo: FiltroOcorrencias) {
    setFiltro(novo)
    startTransition(async () => {
      const r = await listarOcorrenciasAction(novo)
      if (!r.ok) toast.error(r.erro, TOAST)
      else setLista(r.ocorrencias)
    })
  }

  function resolver(o: OcorrenciaLinha) {
    startTransition(async () => {
      const r = await resolverOcorrenciaAction(o.id)
      if (!r.ok) {
        toast.error(r.erro, TOAST)
        return
      }
      toast.success(`${o.posto}: marcada como resolvida`, TOAST)
      const atualizada = await listarOcorrenciasAction(filtro)
      if (atualizada.ok) setLista(atualizada.ocorrencias)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="de">De</Label>
          <Input id="de" type="date" value={filtro.de} onChange={(e) => buscar({ ...filtro, de: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ate">Até</Label>
          <Input id="ate" type="date" value={filtro.ate} onChange={(e) => buscar({ ...filtro, ate: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="estado">Estado</Label>
          <select
            id="estado"
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={filtro.estado}
            onChange={(e) => buscar({ ...filtro, estado: e.target.value as FiltroOcorrencias['estado'] })}
          >
            <option value="">Todos</option>
            <option value="aberta">Aberta</option>
            <option value="resolvida">Resolvida</option>
            <option value="normalizada">Normalizada</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Regra</TableHead>
              <TableHead>Posto (OP)</TableHead>
              <TableHead>Defeito</TableHead>
              <TableHead>Ao abrir</TableHead>
              <TableHead>Última</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Aberta em</TableHead>
              <TableHead>Resolvida</TableHead>
              <TableHead>Normalizada</TableHead>
              <TableHead>Envios</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                  Nenhuma ocorrência no período.
                </TableCell>
              </TableRow>
            )}
            {lista.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">
                  {o.regraNome}
                  <span className="block text-xs font-normal text-muted-foreground">{NOME_TIPO_REGRA[o.regraTipo]}</span>
                </TableCell>
                <TableCell>
                  {o.posto}
                  {o.pmo && o.op ? ` (${o.pmo}/${o.op})` : ''}
                </TableCell>
                <TableCell>{o.defeito ? rotuloDefeito(o.defeito) : '—'}</TableCell>
                <TableCell>{formatarValorOcorrencia(o.regraTipo, o.valorAbertura)}</TableCell>
                <TableCell>{formatarValorOcorrencia(o.regraTipo, o.valorUltimo)}</TableCell>
                <TableCell>
                  <Estado estado={o.estado} />
                </TableCell>
                <TableCell>{quando(o.abertaEm)}</TableCell>
                <TableCell>{o.resolvidaEm ? `${o.resolvidaPorNome} · ${quando(o.resolvidaEm)}` : '—'}</TableCell>
                <TableCell>{quando(o.normalizadaEm)}</TableCell>
                <TableCell>
                  {o.enviosOk} ok{o.enviosFalha > 0 ? ` · ${o.enviosFalha} falha` : ''}
                </TableCell>
                <TableCell className="text-right">
                  {o.estado === 'aberta' && (
                    <Button variant="outline" size="sm" disabled={pendente} onClick={() => resolver(o)}>
                      Marcar resolvida
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

- [ ] **Step 9: `alertas-tela.tsx` — repassar as PMOs**

Em `src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx`, troque:

```tsx
export function AlertasTela({
  regras,
  postos,
  destinatarios,
```

por:

```tsx
export function AlertasTela({
  regras,
  postos,
  pmos,
  destinatarios,
```

troque:

```tsx
  regras: RegraAlerta[]
  postos: string[]
  destinatarios: DestinatarioDisponivel[]
```

por:

```tsx
  regras: RegraAlerta[]
  postos: string[]
  pmos: string[]
  destinatarios: DestinatarioDisponivel[]
```

e troque:

```tsx
        <RegrasLista regras={regras} postos={postos} destinatarios={destinatarios} configurados={configurados} />
```

por:

```tsx
        <RegrasLista
          regras={regras}
          postos={postos}
          pmos={pmos}
          destinatarios={destinatarios}
          configurados={configurados}
        />
```

- [ ] **Step 10: Reescrever `src/app/(app)/configuracoes/sf-alertas/page.tsx` inteiro**

```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/postos-repository'
import { alertasLiberados } from '@/modules/alertas/application/liberacao'
import { filtroOcorrenciasPadrao } from '@/modules/alertas/domain/ocorrencia'
import { canaisConfigurados } from '@/modules/alertas/infra/canais'
import {
  listarDestinatarios,
  listarOcorrencias,
  listarPmosAlerta,
  listarRegras,
} from '@/modules/alertas/infra/regras-repository'
import { AlertasTela } from './alertas-tela'

export default async function AlertasPage() {
  const sessao = await getSessao()
  if (
    !sessao ||
    !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar') ||
    !alertasLiberados(sessao.email)
  ) {
    return <SemPermissao descricao="Você não tem permissão para configurar alertas." />
  }

  const filtro = filtroOcorrenciasPadrao(new Date())
  const [regras, postos, pmos, destinatarios, ocorrencias] = await Promise.all([
    listarRegras(),
    listarPostos(),
    listarPmosAlerta(),
    listarDestinatarios(),
    listarOcorrencias(filtro),
  ])

  return (
    <AlertasTela
      regras={regras}
      postos={postos}
      pmos={pmos}
      destinatarios={destinatarios}
      configurados={canaisConfigurados()}
      ocorrenciasIniciais={ocorrencias}
      filtroInicial={filtro}
    />
  )
}
```

- [ ] **Step 11: Rodar os testes e o tsc**

Run: `npx vitest run "src/app/(app)/configuracoes/sf-alertas" src/modules/alertas && npx tsc --noEmit`
Expected: PASS em todos os testes; `tsc` sem erros (a partir daqui o projeto inteiro volta a compilar).

- [ ] **Step 12: Commit**

```bash
git add "src/app/(app)/configuracoes/sf-alertas/tipo-escolha.tsx" "src/app/(app)/configuracoes/sf-alertas/pmos-selecao.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/regra-form.tsx" "src/app/(app)/configuracoes/sf-alertas/regra-dialog.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/regras-lista.tsx" "src/app/(app)/configuracoes/sf-alertas/ocorrencias-lista.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/alertas-tela.tsx" "src/app/(app)/configuracoes/sf-alertas/page.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/__tests__/regra-form.test.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/__tests__/regra-dialog.test.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/__tests__/regras-lista.test.tsx" \
  "src/app/(app)/configuracoes/sf-alertas/__tests__/ocorrencias-lista.test.tsx"
git commit -m "feat(alertas): telas por tipo — escolha em 3 cartões, formulário por tipo com ⓘ, PMOs, lista com Tipo/Limite/PMOs, ocorrências com defeito

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Verificação final, README e roteiro de smoke

**Files:**
- Modify: `tools/alertas/README.md` (seção nova antes de `## 7. Conferir`)
- Create: `docs/superpowers/plans/2026-09-18-alertas-tipos-smoke.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–6.
- Produces: branch verde (tsc, lint, vitest, SQL, build) e os passos de aplicação da 0115 no Dev, na demo e no RDS.

- [ ] **Step 1: Rodar a verificação completa**

Run (cada linha precisa passar antes da próxima):

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-alertas-tipos"
npx tsc --noEmit
npm run lint
npx vitest run
bash supabase/tests/rodar-alertas-test.sh
NEXT_PUBLIC_SUPABASE_URL=https://exemplo.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-de-build SUPABASE_SERVICE_ROLE_KEY=service-de-build npm run build
```

Expected: `tsc` sem saída; `lint` sem erros; `vitest` todos os arquivos PASS; o runner SQL termina com `0115 (tipos de regra): ok` e `ALERTAS SQL OK`; o build termina com a tabela de rotas (inclui `/configuracoes/sf-alertas`). Se algo falhar, corrija na task de origem (mesmo arquivo), rode de novo e só então siga.

- [ ] **Step 2: README — inserir em `tools/alertas/README.md` imediatamente ANTES da linha `## 7. Conferir`**

````markdown
## 6b. Migração 0115 — tipos de regra, destinatários do ShopFloor e filtro de PMO

A `0115_alertas_tipos.sql` vai **por cima** da 0113/0114 (a 0113 não muda). Ela:

- dá um **tipo** a cada regra (`aprovacao`, `tempo`, `defeito`) — as regras que já existem viram
  `aprovacao`, sem mudar nada no comportamento delas;
- cria o **filtro de PMO** (`pmos`, vazio = todas);
- passa a mandar alerta **só para usuário ativo com `shopfloor.administrar`** no perfil dele (na
  lista da tela, na fila, na entrega e no botão Resolvido).

É idempotente: rodar duas vezes não quebra.

### Antes de aplicar (Prod): quem vai parar de receber?

Destinatários de regras ativas que **não** administram o ShopFloor deixam de receber assim que a 0115
entra. Confira antes e, se for o caso, ajuste o perfil da pessoa:

```sql
select r.nome as regra, coalesce(nullif(btrim(u.nome), ''), u.email) as destinatario
  from alerta_regras r
  cross join unnest(r.destinatarios) as d(id)
  join usuarios u on u.id = d.id
 where r.excluida_em is null and u.ativo
   and not exists (select 1 from perfil_permissao pp
                    where pp.perfil_id = u.perfil_id
                      and pp.modulo = 'shopfloor' and pp.permissao = 'administrar');
```

### Ordem: banco primeiro, app logo depois

O app novo chama a `alerta_previa` nova (8 parâmetros) e lê as colunas novas. O app velho, com a 0115
aplicada, continua funcionando — **só a prévia do formulário** falha até o deploy do app novo. Então:
aplique a 0115 e suba o app em seguida.

### Dev e demo (SQL Editor do Supabase)

Cole `supabase/migrations/0115_alertas_tipos.sql` inteiro e rode (não tem `concurrently`; roda
dentro da transação do editor sem ajuste nenhum).

### Prod (RDS, via `psql` na instância Lightsail)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W \
  "host=shopfloor-prod-db... user=postgres sslmode=require" \
  -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql

cd ~/supabase/docker && docker compose restart rest   # recarrega o schema do PostgREST
```

### Depois da 0115 (Dev, demo e Prod): conferir

```sql
-- 1) todas as regras antigas viraram 'aprovacao'
select tipo, count(*) from alerta_regras group by tipo;

-- 2) índice novo no lugar do antigo: tem que listar alerta_ocorrencias_viva_defeito e NÃO alerta_ocorrencias_viva
select indexname from pg_indexes where tablename = 'alerta_ocorrencias' order by indexname;

-- 3) uma assinatura só de cada função que mudou (tem que dar 1, 1, 1)
select proname, count(*) from pg_proc
 where proname in ('alerta_previa', 'alerta_taxas', 'alerta_listar_ocorrencias')
 group by proname;

-- 4) quem a tela oferece como destinatário (rode logado como gestor, ou troque por usuario_tem_permissao)
select u.nome from usuarios u
 where u.ativo and usuario_tem_permissao(u.id, 'shopfloor', 'administrar')
 order by 1;
```

Depois: `pm2 restart shopfloor --update-env` (Prod) ou redeploy do Preview/`next dev`, e abra
**Configurações › Ajustes ShopFloor › Alertas** → **Nova regra** tem que mostrar os 3 cartões.
````

- [ ] **Step 3: Criar `docs/superpowers/plans/2026-09-18-alertas-tipos-smoke.md`**

````markdown
# Smoke — Alertas: tipos de regra, destinatários do ShopFloor e filtro de PMO

Spec: `docs/superpowers/specs/2026-09-18-alertas-tipos-de-regra-design.md`.
Plano: `docs/superpowers/plans/2026-09-18-alertas-tipos-de-regra.md`.
Base (bots, vínculo, cron): `docs/superpowers/plans/2026-09-17-alertas-smoke.md`.

Pré-requisito: os bots e o vínculo do roteiro de 17/09 já funcionam no ambiente; você está em
`ALERTAS_LIBERADO_PARA` (ou `*`).

## 1. Aplicar a 0115

- [ ] **Dev** (SQL Editor): cole `supabase/migrations/0115_alertas_tipos.sql` inteiro e rode.
- [ ] **Demo** (SQL Editor): o mesmo.
- [ ] **RDS** (só na promoção): rode antes a consulta "quem vai parar de receber?" do README
      (`tools/alertas/README.md` §6b) e depois:
      ```bash
      PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=... user=postgres sslmode=require" \
        -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql
      cd ~/supabase/docker && docker compose restart rest
      ```
- [ ] Conferências do README §6b: regras antigas = `aprovacao`; índice `alerta_ocorrencias_viva_defeito`;
      1 assinatura de `alerta_previa`/`alerta_taxas`/`alerta_listar_ocorrencias`.
- [ ] Suba o app (Preview da branch ou `pm2 restart shopfloor --update-env`).

## 2. Regras antigas continuam iguais

- [ ] A lista de regras mostra as antigas com **Tipo = Taxa de aprovação**, **Limite = ≥ NN%** e
      **PMOs = Todas**.
- [ ] Editar uma antiga abre direto o formulário de taxa (sem os cartões), com os valores de antes.
- [ ] **Avaliar agora** não manda nada novo para regras que estavam estáveis.

## 3. Escolha do tipo

- [ ] **Nova regra** mostra 3 cartões: Taxa de aprovação, Tempo médio por peça, Defeito repetido.
- [ ] Escolher um abre o formulário daquele tipo; **Trocar tipo** volta aos cartões.
- [ ] Cada campo de cálculo tem o **ⓘ** com a explicação (passe o mouse / toque).

## 4. Tempo médio por peça

- [ ] Nova regra de tempo num posto com movimento: limite **0:30** (baixo, para disparar), janela
      últimos 60 min, mínimo de intervalos 5, pausas acima de 30 min.
- [ ] **Ver prévia** mostra `Posto: m:ss por peça (N intervalos, M peças)`.
- [ ] Salve → a lista mostra **≤ 0:30/peça**.
- [ ] **Avaliar agora** → chega `🔴 {posto} lento: m:ss por peça na última hora (limite 0:30) · N peças`
      + `Regra: ...`, com o botão **Resolvido**.
- [ ] Edite a regra para limite **60:00** → **Avaliar agora** → chega `🟢 {posto} normalizou: m:ss por peça`.
- [ ] Digitar `2:75` no limite → toast embaixo "Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00)."

## 5. Defeito repetido

- [ ] Nova regra de defeito num posto com reprovas recentes: repetições **2**, últimos 60 min.
- [ ] **Ver prévia** lista `Posto: 2040 (Componente Faltando) — N vezes` para cada defeito com 2 ou
      mais (ou "nenhum defeito repetido 2 vezes ou mais").
- [ ] **Avaliar agora** → uma mensagem **por defeito**:
      `🔴 Defeito 2040 (Componente Faltando) repetido no {posto}: N vezes na última hora (limite 2)`.
- [ ] Aba **Ocorrências**: coluna **Defeito** com `2040 (Componente Faltando)`; "Ao abrir"/"Última" em
      `N vezes`.
- [ ] Suba o limite para um número alto (ex.: 99) → **Avaliar agora** → cada defeito manda
      `🟢 Defeito ... normalizou no {posto}`.

## 6. Filtro de PMO

- [ ] Numa regra (qualquer tipo), marque uma PMO na lista (use a busca) → a lista de regras mostra a
      PMO na coluna **PMOs**; nenhuma marcada mostra **Todas**.
- [ ] **Ver prévia** com e sem a PMO marcada num posto que roda mais de uma PMO: os números mudam.

## 7. Destinatários só do ShopFloor

- [ ] A lista de destinatários do formulário só mostra quem tem **administrar** no ShopFloor.
- [ ] Tire o `shopfloor.administrar` do perfil de alguém que é destinatário de uma regra e reabra a
      regra: aparece "N destinatário(s) inativo(s) ou sem permissão de administrar o ShopFloor
      removido(s) da regra — salve para confirmar."
- [ ] Com uma ocorrência aberta, tire a permissão da pessoa **antes** do próximo cron: ela não recebe o
      lembrete/normalizou; apertar **Resolvido** numa mensagem antiga responde "Você não é
      destinatário desta regra." Devolva a permissão no fim.

## 8. Lançamento escondido

- [ ] Com `ALERTAS_LIBERADO_PARA` sem o seu e-mail, a tela continua escondida (igual a 17/09).
````

- [ ] **Step 3b: Rodar a verificação de novo (só os testes, os docs não afetam o build)**

Run: `npx vitest run && bash supabase/tests/rodar-alertas-test.sh`
Expected: PASS e `ALERTAS SQL OK`.

- [ ] **Step 4: Commit e push**

```bash
git add tools/alertas/README.md docs/superpowers/plans/2026-09-18-alertas-tipos-smoke.md
git commit -m "docs(alertas): README da 0115 (Dev, demo, RDS) e roteiro de smoke dos tipos de regra

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
```

---

## Auto-revisão

### Cobertura da spec

| Spec | Requisito | Task |
|---|---|---|
| §1.1 | Três tipos: aprovação, tempo médio, defeito repetido | 1 (`TipoRegra`), 2 (coluna + check), 3 (cálculo), 6 (tela) |
| §1.2 | Tipo escolhido antes do formulário (3 cartões); não muda depois | 6 (`TipoEscolha`, `RegraConteudo`), 2 (trigger `TIPO_FIXO`), 5 (update sem `tipo`) |
| §1.3 | Tempo = intervalo médio entre bipes consecutivos; alerta acima do limite | 3 (`alerta_tempos`, `v_abaixo` = média > limite) |
| §1.4 | Defeito: mesmo código ≥ N reprovas na janela; uma ocorrência e um aviso por defeito; sem mínimo | 3 (`alerta_defeitos`, ocorrência por `defeito`), 2 (índice com `coalesce(defeito,'')`) |
| §1.5 | Destinatários só ativos com `shopfloor.administrar` | 2 (`usuario_tem_permissao`), 4 (lista, fila, reserva, botão) |
| §1.6 | Várias PMOs; nenhuma = todas; vale nos 3 tipos | 2 (`pmos`), 3 (`alerta_taxas`/`alerta_tempos`/`alerta_defeitos`/`alerta_ultima_op`), 6 (`PmosSelecao`) |
| §2 | Campos por tipo, janelas permitidas, mínimo de intervalos, pausa 30 (1–240) | 1 (`validarRegra`), 2 (`alerta_regras_campos_por_tipo`), 6 (formulário) |
| §2 | Limites de janela iguais; `op` com filtro de PMO considera só as PMOs da regra | 1, 2 (checks da 0113 mantidos), 3 (`alerta_ultima_op`) |
| §3 | Taxa igual + PMO | 3 (`alerta_taxas` com `p_pmos`; teste "Taxa PMOX") |
| §3 | Tempo: qualquer status, ordenado, descarta pausa, média, mínimo de intervalos, normaliza ≤ limite | 3 (`alerta_tempos`; testes T-Lento/T-Pausa/T-Poucos/normalizou) |
| §3 | Defeito: reprovado + código; normaliza por código; descrição do catálogo | 3 (testes D-Posto), 1 (`rotuloDefeito`, D5) |
| §4 | Colunas novas em `alerta_regras`, nulos + check por tipo, antigas viram `aprovacao` | 2 (A1; teste T1/T2/T3) |
| §4 | `alerta_ocorrencias.defeito` + valores genéricos; índice único com defeito | 2 (A2; teste T4) |
| §4 | `alerta_envios.dados` com o que cada tipo precisa | 3 (`v_dados`), 1 (`textoDoEnvio`) |
| §4 | `alerta_destinatarios`/`alerta_avaliar`/`alerta_resolver_interno`/`alerta_reservar_envios` exigem a permissão do usuário listado | 4 (C1–C3 + trecho do B5; testes D1–D4) |
| §4 | `alerta_previa` aceita tipo e parâmetros novos | 3 (B6; drop da assinatura antiga) |
| §5 | Nova regra = 3 cartões; editar vai direto | 6 |
| §5 | Só os campos do tipo; ⓘ em cada campo de cálculo | 6 (`regra-form.tsx`) |
| §5 | Tempo em mm:ss, guardado em segundos | 1 (`tempo.ts`), 6 |
| §5 | PMOs no fim, com busca e "Nenhuma marcada = todas as PMOs" | 6 (`pmos-selecao.tsx`) |
| §5 | Prévia por tipo | 1 (`textoPreviaPosto`), 3 (`alerta_previa`), 5, 6 |
| §5 | Lista: coluna Tipo, Limite por tipo, PMOs | 1 (`resumoLimite`/`resumoPmos`), 6 (`regras-lista.tsx`) |
| §5 | Ocorrências: defeito (código + descrição) e valor por tipo | 1 (`formatarValorOcorrencia`), 3 (B7), 5, 6 |
| §6 | Textos de tempo e defeito; lembrete e resolvido no padrão | 1 (`mensagens.ts`, `envio.ts`) |
| §7 | Fora de escopo respeitado (sem defeitos específicos, sem janela por bipes em tempo/defeito, sem resumo por turno) | 1 e 2 recusam janela por bipes nos tipos novos |
| §8 | SQL: tempo (pausa, mínimo, PMO), defeito (2 códigos, normalização por código, índice), PMO nos 3 tipos, destinatários (inclusive perda de permissão antes da entrega), migração para `aprovacao`, checks por tipo | 2, 3, 4 |
| §8 | Vitest: validação por tipo, textos por tipo, mm:ss, formulário por tipo, tela de escolha | 1, 5, 6 |
| — | Fila no banco, `skip locked`, exclusão lógica e `ALERTAS_LIBERADO_PARA` mantidos | 3/4 (mesma estrutura de fila e reserva; nada muda em exclusão/lançamento escondido) |
| — | README e smoke com a 0115 no Dev, na demo e no RDS | 7 |

### Placeholders
Nenhum "TBD"/"implementar depois"; todo passo que muda código traz o código completo ou o trecho exato de troca (`troque ... por ...`).

### Consistência de nomes
- SQL ↔ TS: `media_seg`, `limite_tempo_seg`, `pecas`, `defeito`, `ocorrencias`, `limite_ocorrencias`, `regra_tipo` (B5 ↔ `envio.ts`); colunas da prévia (B6 ↔ `previaRegra`); colunas da listagem (B7 ↔ `listarOcorrencias`); `alerta_pmos(): text[]` ↔ `listarPmosAlerta`.
- `RegraValida` (Task 1) = o que `paraLinha`/`paraRegra` (Task 5) e o formulário (Task 6) usam: `tipo`, `taxaMinima`, `minimoBipes`, `limiteTempoSeg`, `limiteOcorrencias`, `pausaMaxMin`, `pmos`.
- `EntradaRegra` (Task 1) = o que `RegraForm.entrada()` monta: `limiteTempo` (texto mm:ss), `limiteOcorrencias`, `pausaMaxMin`, `pmos`.
- Helpers de teste SQL criados na Task 2 (`teste_regra`, `teste_regra_recusada`) e Task 3 (`teste_ritmo`, `teste_defeitos`, `teste_fila`, `teste_contas_ana_bruno`) usados nas tasks seguintes com a mesma assinatura; `teste_bipes` vem do `alertas_test.sql` da 0113 (mesma base).

### Validação do próprio plano (feita ao escrevê-lo)
- SQL: a 0115 montada das partes A+B+C (com a troca do Step 3 da Task 4) rodou num Postgres 15 descartável por cima de stubs → 0113 → 0114 → `alertas_test.sql`, **duas vezes** com `psql -1`, e o `alertas_tipos_test.sql` inteiro passou. Os estados intermediários também batem com os "Expected" de cada task: só a parte A passa os testes da Task 2 e falha os da Task 3 em `alerta_previa nova (8 parâmetros)`; A+B passa as Tasks 2–3 e falha a Task 4 em `destinatários disponíveis {…0001,…0002,…0003}`.
- TS: todos os blocos das Tasks 1, 5 e 6 aplicados numa cópia da main: os testes de cada task falham antes da implementação e passam depois; ao fim, `tsc --noEmit` limpo, `eslint` limpo nas pastas tocadas, `vitest run` 97 arquivos / 815 testes verdes e `npm run build` (variáveis fictícias) com `/configuracoes/sf-alertas` na tabela de rotas.
