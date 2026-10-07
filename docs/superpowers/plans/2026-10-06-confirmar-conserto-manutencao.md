# Confirmar os consertos da Manutenção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao aprovar uma peça no posto da rota de reteste, mostrar os consertos que a Manutenção acabou de registrar e pedir confirmação antes de gravar.

**Architecture:** Espelha o modal de conserto que já existe (`verificarConserto`), trocando a pergunta: em vez de "o último registro NESTE posto foi reprova?", pergunta "o último registro DA PEÇA foi um reparo?". A decisão de chamar o servidor é tomada **no cliente**, com dado que a tela já carrega — nos postos que não são destino de rota, nada muda e nenhuma chamada a mais acontece.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, Supabase/PostgREST, Vitest, Postgres.

**Spec:** `docs/superpowers/specs/2026-10-05-confirmar-conserto-manutencao-design.md`

## Global Constraints

- ⚠️ `--maxWorkers=2` é **obrigatório** em todo `vitest` nesta máquina (4 núcleos; sem ele o processo morre com exit 137 por falta de memória).
- ⚠️ `next build` **não roda nesta worktree** (o Turbopack recusa o `node_modules`, que é symlink para fora da raiz). Não tente consertar.
- Migrações: `$func$` como delimitador de corpo, **nunca `$$`** (o SQL Editor do Supabase recusa), inclusive dentro de comentário. `grep -c '\$\$'` no arquivo tem de dar **0**.
- `tem_permissao` dentro de função nova: forma de **DOIS** argumentos (módulo, ação). A de um argumento checa a permissão global e anula o RBAC por módulo.
- Última linha de toda migração: `notify pgrst, 'reload schema';`
- Migrações idempotentes: rodar de novo não pode quebrar.
- `git add` com caminhos explícitos — **nunca** `git add -A` nem `git add .`.
- Toda mensagem de commit termina com: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- ⚠️ **`lancar-action.ts` é `'use server'` — um módulo assim só pode exportar FUNÇÕES ASYNC.** Um tipo exportado dali derruba o `next build`, e **nem o `tsc` nem o eslint avisam**. É por isso que `ConsertoConfirmavel` nasce no DOMÍNIO, e não na infra nem na ação.
- **Fora de escopo por decisão do usuário:** as políticas RLS da `sf_conserto_confirmado` usam `tem_permissao` de UM argumento. É defeito pré-existente (69 ocorrências em 56 arquivos), marcado pela revisão de segurança de 21/09. **Não corrigir nesta branch.**

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/0138_conserto_confirmado_origem.sql` | **criar** — as 2 colunas |
| `supabase/tests/conserto_origem_test.sql` + `rodar-conserto-test.sh` | **criar** — prova a migração |
| `src/modules/shopfloor/domain/rota-reteste.ts` | **criar** — `postoEhDestinoDeRota`, função pura |
| `src/modules/shopfloor/infra/postos-repository.ts` | **modificar** — `mapaPostoRotaDestino()` |
| `src/modules/shopfloor/infra/lancamento-repository.ts` | **modificar** — `buscarUltimoReparo()` + `inserirConservoConfirmado` com origem |
| `src/modules/shopfloor/application/lancar-action.ts` | **modificar** — `verificarConsertoManutencao()` + campo na entrada |
| `src/app/(app)/shopfloor/operar/lancamento/page.tsx` | **modificar** — carrega o mapa novo |
| `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` | **modificar** — prop nova + o modal nos **DOIS** caminhos |

---

### Task 1: Migração 0138 — as duas colunas

**Files:**
- Create: `supabase/migrations/0138_conserto_confirmado_origem.sql`
- Create: `supabase/tests/conserto_origem_test.sql`
- Create: `supabase/tests/rodar-conserto-test.sh`

**Interfaces:**
- Produces: `sf_conserto_confirmado.origem` (`text not null default 'posto'`, check in `('posto','manutencao')`) e `sf_conserto_confirmado.conserto` (`text not null default ''`).

- [ ] **Step 1: Escreva a migração**

Crie `supabase/migrations/0138_conserto_confirmado_origem.sql`:

```sql
-- =============================================================
-- Confirmação de conserto: de ONDE veio a confirmação, e O QUE foi confirmado.
--
-- A tabela (0072) guardava uma linha por DEFEITO confirmado, no posto que conserta no próprio
-- lugar. Passa a guardar também uma linha por CONSERTO confirmado, quando a peça volta da
-- Manutenção e alguém confere o reparo no posto da rota de reteste (0102/0103).
--
-- Sem a coluna `origem` as duas confirmações se misturariam e quem consultasse depois não saberia
-- distinguir "quem atestou o defeito?" de "quem conferiu o reparo?" — as colunas de defeito ficam
-- vazias na confirmação de reparo, e isso sozinho não é sinal confiável (defeito pode ter código
-- vazio e só posição).
--
-- `origem` nasce 'posto' em tudo o que já existe: o histórico continua válido e NENHUMA consulta
-- de hoje muda de resultado.
--
--   Dev e demo (SQL Editor do Supabase): cola o arquivo inteiro e roda.
--   RDS:  PGPASSFILE=/dev/null PGCLIENTENCODING=UTF8 psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0138_conserto_confirmado_origem.sql
--
-- Aditiva: não recria função nenhuma, não toca política nenhuma. Idempotente.
-- =============================================================

alter table public.sf_conserto_confirmado
  add column if not exists origem   text not null default 'posto',
  add column if not exists conserto text not null default '';

comment on column public.sf_conserto_confirmado.origem is
  'De onde veio a confirmação: ''posto'' = o operador confirmou o DEFEITO no posto que conserta no '
  'próprio lugar (comportamento da 0072); ''manutencao'' = alguém conferiu o CONSERTO registrado '
  'pela Manutenção, no posto da rota de reteste. Default ''posto'': é o valor de todo o histórico '
  'anterior a esta migração.';

comment on column public.sf_conserto_confirmado.conserto is
  'A descrição do conserto confirmado (o `reparo_conserto` da linha da Manutenção). Vazia quando '
  'origem = ''posto'' — lá o que se confirma é o defeito, e ele mora em codigo_defeito/posicao/tipo.';

-- O check entra DEPOIS do backfill implícito do default: toda linha existente já é 'posto'.
-- `not valid` + `validate` seria necessário só numa tabela grande; esta tem poucas centenas.
do $func$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sf_conserto_confirmado'::regclass
       and conname = 'sf_conserto_confirmado_origem_check'
  ) then
    alter table public.sf_conserto_confirmado
      add constraint sf_conserto_confirmado_origem_check
      check (origem in ('posto', 'manutencao'));
  end if;
end
$func$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Escreva o teste SQL**

Crie `supabase/tests/conserto_origem_test.sql`:

```sql
-- Prova a 0138. Roda depois dela, num banco que já tem a 0072.
\set ON_ERROR_STOP on

do $func$
declare
  v_origem_default text;
  v_conserto_default text;
  v_tem_check boolean;
  v_erro text;
begin
  -- 1. as colunas existem, com o default certo
  select column_default into v_origem_default
    from information_schema.columns
   where table_schema='public' and table_name='sf_conserto_confirmado' and column_name='origem';
  if v_origem_default is null or v_origem_default not like '%posto%' then
    raise exception 'FALHOU: origem sem default ''posto'' (achei %)', coalesce(v_origem_default, '<ausente>');
  end if;

  select column_default into v_conserto_default
    from information_schema.columns
   where table_schema='public' and table_name='sf_conserto_confirmado' and column_name='conserto';
  if v_conserto_default is null then
    raise exception 'FALHOU: coluna conserto ausente';
  end if;

  -- 2. o check existe
  select exists (
    select 1 from pg_constraint
     where conrelid='public.sf_conserto_confirmado'::regclass
       and conname='sf_conserto_confirmado_origem_check'
  ) into v_tem_check;
  if not v_tem_check then raise exception 'FALHOU: check de origem ausente'; end if;

  -- 3. inserir SEM origem nasce 'posto' (é o que garante que o histórico não muda)
  insert into public.sf_conserto_confirmado (pmo, op, posto, codigo_defeito)
  values ('ZZTESTE', '0001', 'Posto Teste', 'D01');
  if (select origem from public.sf_conserto_confirmado where pmo='ZZTESTE' limit 1) <> 'posto' then
    raise exception 'FALHOU: insert sem origem não nasceu ''posto''';
  end if;

  -- 4. inserir com origem inválida é RECUSADO
  begin
    insert into public.sf_conserto_confirmado (pmo, op, posto, origem)
    values ('ZZTESTE2', '0001', 'Posto Teste', 'qualquer');
    raise exception 'FALHOU: origem inválida foi aceita';
  exception when check_violation then
    null; -- esperado
  end;

  -- 5. inserir com origem 'manutencao' e conserto preenchido funciona
  insert into public.sf_conserto_confirmado (pmo, op, posto, origem, conserto, posicao)
  values ('ZZTESTE3', '0001', 'Inspeção PTH', 'manutencao', 'Ressolda', 'R12');
  if (select conserto from public.sf_conserto_confirmado where pmo='ZZTESTE3') <> 'Ressolda' then
    raise exception 'FALHOU: conserto não gravou';
  end if;

  delete from public.sf_conserto_confirmado where pmo in ('ZZTESTE','ZZTESTE2','ZZTESTE3');
end
$func$;

select 'conserto origem: ok' as resultado;
```

- [ ] **Step 3: Escreva o runner**

Crie `supabase/tests/rodar-conserto-test.sh` (siga o molde de `rodar-etiquetas-legado-test.sh` — leia-o primeiro e copie a estrutura: sobe um Postgres descartável no Docker, aplica as migrações necessárias, roda o teste, derruba o container). O runner tem de aplicar **0072 e depois 0138**, e aplicar a **0138 duas vezes** para provar a idempotência.

```bash
chmod +x supabase/tests/rodar-conserto-test.sh
```

- [ ] **Step 4: Rode e veja passar**

Run: `bash supabase/tests/rodar-conserto-test.sh`
Expected: termina com `conserto origem: ok` e exit 0. A segunda aplicação da 0138 imprime só os NOTICE de idempotência (`column ... already exists, skipping`).

- [ ] **Step 5: Prove o dente**

Numa cópia no scratchpad, remova o bloco `do $func$ ... $func$;` do check e rode o teste de novo.
Expected: FALHA com `FALHOU: check de origem ausente`. Restaure.

- [ ] **Step 6: Confira as convenções**

```bash
grep -c '\$\$' supabase/migrations/0138_conserto_confirmado_origem.sql
tail -1 supabase/migrations/0138_conserto_confirmado_origem.sql
```
Expected: `0` e `notify pgrst, 'reload schema';`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0138_conserto_confirmado_origem.sql supabase/tests/conserto_origem_test.sql supabase/tests/rodar-conserto-test.sh
git commit -m "shopfloor(0138): a trilha de confirmação passa a dizer de onde veio

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: O domínio — este posto é destino de rota?

**Files:**
- Create: `src/modules/shopfloor/domain/rota-reteste.ts`
- Create: `src/modules/shopfloor/domain/__tests__/rota-reteste.test.ts`

**Interfaces:**
- Produces:
  - `postoEhDestinoDeRota(posto: string, destinos: ReadonlySet<string>): boolean`
  - `interface ConsertoConfirmavel { conserto: string; posicao: string }`

**Contexto que você precisa:**

O campo *"Depois da Manutenção, passar por"* mora em `sf_postos.retorno_pos_manutencao` (migração 0102). Um posto A aponta para um posto B: a peça reprovada em A, depois de reparada, repassa por B antes de voltar.

A pergunta desta função é a **inversa**: dado o posto onde o operador está bipando, **alguém aponta para ele?** Se sim, é um posto de reteste e o modal pode aparecer ali.

O conjunto de destinos é montado fora (Task 3). Aqui mora só a decisão, para poder ser testada sem banco.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/modules/shopfloor/domain/__tests__/rota-reteste.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { postoEhDestinoDeRota } from '../rota-reteste'

describe('postoEhDestinoDeRota', () => {
  it('é destino quando alguém aponta para ele', () => {
    expect(postoEhDestinoDeRota('Inspeção PTH', new Set(['Inspeção PTH']))).toBe(true)
  })

  it('não é destino quando ninguém aponta', () => {
    expect(postoEhDestinoDeRota('Teste', new Set(['Inspeção PTH']))).toBe(false)
  })

  it('sem nenhuma rota configurada, nenhum posto é destino', () => {
    expect(postoEhDestinoDeRota('Inspeção PTH', new Set())).toBe(false)
  })

  it('posto vazio nunca é destino', () => {
    // O formulário começa sem posto escolhido; perguntar ali não faz sentido.
    expect(postoEhDestinoDeRota('', new Set(['']))).toBe(false)
  })

  it('compara o nome exato, sem aparar nem mudar caixa', () => {
    // A chave do posto vem do banco nos dois lados (sf_postos.chave e
    // sf_postos.retorno_pos_manutencao), então já são o mesmo texto. Normalizar aqui esconderia
    // uma configuração errada em vez de deixá-la aparecer.
    expect(postoEhDestinoDeRota('inspeção pth', new Set(['Inspeção PTH']))).toBe(false)
    expect(postoEhDestinoDeRota(' Inspeção PTH ', new Set(['Inspeção PTH']))).toBe(false)
  })
})
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/rota-reteste.test.ts --maxWorkers=2`
Expected: FALHA — `Failed to resolve import "../rota-reteste"`.

- [ ] **Step 3: Escreva a implementação**

Crie `src/modules/shopfloor/domain/rota-reteste.ts`:

```ts
/**
 * Rota de reteste: o posto que alguém escolheu em "Depois da Manutenção, passar por" (0102).
 *
 * A peça reprovada no posto A vai pra Manutenção, é reparada, e repassa por B antes de voltar.
 * Aqui a pergunta é a INVERSA — dado o posto onde o operador está bipando, alguém aponta pra ele?
 * Se sim, é ali que a confirmação dos consertos da Manutenção faz sentido.
 *
 * Função pura de propósito: quem monta o conjunto é o repositório, e essa separação é o que permite
 * decidir no CLIENTE se vale chamar o servidor — nos postos que não são destino, nenhuma chamada
 * a mais acontece.
 */
export function postoEhDestinoDeRota(posto: string, destinos: ReadonlySet<string>): boolean {
  if (posto === '') return false
  return destinos.has(posto)
}

/**
 * Um conserto registrado pela Manutenção, do jeito que o operador precisa ver pra confirmar.
 *
 * Mora no DOMÍNIO, e não na infra nem na ação, por um motivo prático: a tela precisa do tipo, e
 * `lancar-action.ts` é `'use server'` — um módulo assim só pode exportar funções async, e um tipo
 * exportado de lá derruba o `next build` sem que o tsc ou o eslint avisem. O domínio é puro e
 * seguro de importar de qualquer camada.
 */
export interface ConsertoConfirmavel {
  conserto: string
  posicao: string
}
```

- [ ] **Step 4: Rode e veja passar**

Run: `npx vitest run src/modules/shopfloor/domain/__tests__/rota-reteste.test.ts --maxWorkers=2`
Expected: PASSA, 5 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shopfloor/domain/rota-reteste.ts src/modules/shopfloor/domain/__tests__/rota-reteste.test.ts
git commit -m "shopfloor: a regra de qual posto é destino da rota de reteste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: O banco — quais postos são destino, e qual foi o último reparo

**Files:**
- Modify: `src/modules/shopfloor/infra/postos-repository.ts` (acrescenta `mapaPostoRotaDestino`)
- Modify: `src/modules/shopfloor/infra/lancamento-repository.ts:315-343` (acrescenta `buscarUltimoReparo`, estende `inserirConservoConfirmado`)
- Test: `src/modules/shopfloor/infra/__tests__/ultimo-reparo.test.ts` (criar)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Consumes: `ConsertoConfirmavel` da Task 2 (`../domain/rota-reteste`).
- Produces:
  - `mapaPostoRotaDestino(): Promise<Set<string>>`
  - `buscarUltimoReparo(pmo: string, op: string, snNorm: string, perfilDoPosto: (p: string) => PerfilPosto): Promise<ConsertoConfirmavel[] | null>`
  - `inserirConservoConfirmado` ganha, em cada linha, `origem: 'posto' | 'manutencao'` e `conserto: string`

**Contexto que você precisa:**

A Manutenção grava em `sf_registros` com `posto = 'Manutenção'` **texto literal** (`sf_manutencao_registrar`, migração 0033) e **uma linha por conserto**, todas no mesmo `data_hora`. Cada linha traz `reparo_conserto` (a descrição) e `reparo_posicao`.

⚠️ **Não compare com o texto `'Manutenção'`.** Resolva o perfil do posto e pergunte se `recurso === 'manutencao'`. Comparar texto funcionaria hoje e quebraria no dia em que alguém renomeasse o posto — **sem erro, apenas parando de perguntar**, que é a pior forma de falhar. É por isso que a função recebe `perfilDoPosto` em vez de descobrir sozinha.

Leia `buscarUltimaReprovaDoPosto` (`lancamento-repository.ts:322`) antes de escrever: a função nova é a irmã dela e deve seguir a mesma forma (ordenação, limite, agrupamento por `data_hora`).

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/modules/shopfloor/infra/__tests__/ultimo-reparo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'

const linhas = vi.fn()
vi.mock('@/modules/auth/infra/supabase-server', () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({ limit: () => linhas() }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

const { buscarUltimoReparo } = await import('../lancamento-repository')

const MANUTENCAO: PerfilPosto = { ...PERFIL_PADRAO, chave: 'manutencao', recurso: 'manutencao' }
const perfilDe = (p: string) => (p === 'Manutenção' ? MANUTENCAO : PERFIL_PADRAO)

beforeEach(() => linhas.mockReset())

describe('buscarUltimoReparo', () => {
  it('último registro é reparo → devolve os consertos daquele evento', async () => {
    linhas.mockResolvedValue({
      data: [
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' },
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Troca', reparo_posicao: 'C5' },
        { posto: 'Teste', data_hora: '2026-10-06T09:00:00Z', reparo_conserto: '', reparo_posicao: '' },
      ],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
      { conserto: 'Troca', posicao: 'C5' },
    ])
  })

  it('último registro NÃO é reparo → nulo', async () => {
    linhas.mockResolvedValue({
      data: [
        { posto: 'Teste', data_hora: '2026-10-06T11:00:00Z', reparo_conserto: '', reparo_posicao: '' },
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' },
      ],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toBeNull()
  })

  it('não entram consertos de um evento ANTERIOR da Manutenção', async () => {
    // A peça já tinha ido pra Manutenção antes. Só o reparo mais recente é o que se confirma.
    linhas.mockResolvedValue({
      data: [
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' },
        { posto: 'Manutenção', data_hora: '2026-10-01T08:00:00Z', reparo_conserto: 'Antigo', reparo_posicao: 'X1' },
      ],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
    ])
  })

  it('reparo sem conserto preenchido → nulo (não há o que confirmar)', async () => {
    linhas.mockResolvedValue({
      data: [{ posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: '  ', reparo_posicao: '' }],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toBeNull()
  })

  it('peça sem registro nenhum → nulo', async () => {
    linhas.mockResolvedValue({ data: [], error: null })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toBeNull()
  })

  it('reconhece a Manutenção pelo PERFIL, não pelo nome do posto', async () => {
    // O posto foi renomeado; o perfil continua sendo o de Manutenção. Tem que continuar achando.
    const perfilRenomeado = (p: string) => (p === 'Reparo Central' ? MANUTENCAO : PERFIL_PADRAO)
    linhas.mockResolvedValue({
      data: [{ posto: 'Reparo Central', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' }],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilRenomeado)).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
    ])
  })

  it('erro do banco sobe (quem trata é a camada de aplicação)', async () => {
    linhas.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).rejects.toBeTruthy()
  })
})
```

⚠️ Confira o caminho real do `createServerSupabase` antes de escrever o mock — leia o topo de `lancamento-repository.ts` e use o mesmo caminho de importação que ele usa.

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run src/modules/shopfloor/infra/__tests__/ultimo-reparo.test.ts --maxWorkers=2`
Expected: FALHA — `buscarUltimoReparo is not a function`.

- [ ] **Step 3: Escreva `buscarUltimoReparo`**

Em `src/modules/shopfloor/infra/lancamento-repository.ts`, logo depois de `buscarUltimaReprovaDoPosto` (linha ~343):

```ts
/**
 * O último registro da peça (em QUALQUER posto) é um reparo da Manutenção? Então devolve os
 * consertos daquele evento. Senão, null.
 *
 * Irmã da `buscarUltimaReprovaDoPosto` acima, com duas diferenças que importam:
 *
 *  - NÃO filtra por posto. A peça está chegando na Inspeção vinda da Manutenção, possivelmente pela
 *    primeira vez — perguntar "o que aconteceu NESTE posto" não encontraria nada.
 *
 *  - Reconhece a Manutenção pelo PERFIL (`recurso === 'manutencao'`), não pelo texto 'Manutenção'
 *    que a `sf_manutencao_registrar` (0033) grava. Comparar texto funcionaria hoje e quebraria no
 *    dia em que alguém renomeasse o posto — sem erro, apenas parando de perguntar.
 *
 * O "evento" são todas as linhas com o mesmo `data_hora` do topo, porque a Manutenção grava UMA
 * LINHA POR CONSERTO, todas no mesmo instante.
 */
export async function buscarUltimoReparo(
  pmo: string, op: string, snNorm: string,
  perfilDoPosto: (posto: string) => PerfilPosto,
): Promise<ConsertoConfirmavel[] | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('posto,data_hora,reparo_conserto,reparo_posicao')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', snNorm)
    .order('data_hora', { ascending: false })
    .order('id', { ascending: false })
    .limit(50)
  if (error) throw error
  const linhas = (data ?? []) as { posto: string; data_hora: string; reparo_conserto: string; reparo_posicao: string }[]
  const topo = linhas[0]
  if (!topo) return null
  if (perfilDoPosto(topo.posto).recurso !== 'manutencao') return null
  const consertos = linhas
    .filter((l) => l.data_hora === topo.data_hora && (l.reparo_conserto ?? '').trim() !== '')
    .map((l) => ({ conserto: (l.reparo_conserto ?? '').trim(), posicao: (l.reparo_posicao ?? '').trim() }))
  return consertos.length > 0 ? consertos : null
}
```

Acrescente ao topo do arquivo, junto dos outros imports de domínio:

```ts
import type { PerfilPosto } from '../domain/perfil-posto'
import type { ConsertoConfirmavel } from '../domain/rota-reteste'
```

- [ ] **Step 4: Estenda `inserirConservoConfirmado`**

Em `src/modules/shopfloor/infra/lancamento-repository.ts:346`, troque a assinatura e o insert:

```ts
/** Grava a auditoria de conserto confirmado (uma linha por item). Respeita RLS (insert = 'lancar'). */
export async function inserirConservoConfirmado(
  linhas: {
    colaborador: string; pmo: string; op: string; numeroSerie: string; numeroSerieNorm: string;
    posto: string; codigo: string; posicao: string; tipo: string;
    origem: 'posto' | 'manutencao'; conserto: string
  }[],
): Promise<void> {
  if (linhas.length === 0) return
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('sf_conserto_confirmado').insert(
    linhas.map((l) => ({
      colaborador: l.colaborador, pmo: l.pmo, op: l.op,
      numero_serie: l.numeroSerie, numero_serie_norm: l.numeroSerieNorm, posto: l.posto,
      codigo_defeito: l.codigo, posicao: l.posicao, tipo_defeito: l.tipo,
      origem: l.origem, conserto: l.conserto,
    })),
  )
  if (error) throw error
}
```

⚠️ `origem` e `conserto` são **obrigatórios** no tipo de propósito: quem chamar sem eles não compila, e é assim que o compilador obriga a Task 4 a decidir a origem em vez de deixar cair no default.

- [ ] **Step 5: Escreva `mapaPostoRotaDestino`**

Em `src/modules/shopfloor/infra/postos-repository.ts`, logo depois de `mapaPostoColetivo` (linha ~54):

```ts
/**
 * Os postos que ALGUÉM escolheu em "Depois da Manutenção, passar por" (0102).
 *
 * É a lista de destinos, não de origens: a chave aqui é o posto pelo qual a peça reparada precisa
 * repassar. A tela usa isso pra decidir, SEM ir ao servidor, se vale perguntar pelos consertos.
 */
export async function mapaPostoRotaDestino(): Promise<Set<string>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('sf_postos').select('retorno_pos_manutencao')
  if (error) throw error
  const destinos = new Set<string>()
  for (const row of (data as { retorno_pos_manutencao: string | null }[]) ?? []) {
    const d = (row.retorno_pos_manutencao ?? '').trim()
    if (d !== '') destinos.add(d)
  }
  return destinos
}
```

- [ ] **Step 6: Conserte os chamadores de `inserirConservoConfirmado`**

O único chamador hoje é `lancar-action.ts:244`. Ele passa defeitos; acrescente `origem: 'posto'` e `conserto: ''`:

```ts
          posto: entrada.posto, codigo: d.codigo, posicao: d.posicao, tipo: d.tipo,
          origem: 'posto' as const, conserto: '',
```

- [ ] **Step 7: Rode e veja passar**

Run: `npx vitest run src/modules/shopfloor --maxWorkers=2 && npx tsc --noEmit`
Expected: todos passam (os 7 novos inclusive) e `tsc` sai limpo.

- [ ] **Step 8: Prove o dente**

Troque `perfilDoPosto(topo.posto).recurso !== 'manutencao'` por `topo.posto !== 'Manutenção'` e rode.
Expected: FALHA no teste `reconhece a Manutenção pelo PERFIL, não pelo nome do posto`. Restaure.

- [ ] **Step 9: Commit**

```bash
git add src/modules/shopfloor/infra/lancamento-repository.ts src/modules/shopfloor/infra/postos-repository.ts src/modules/shopfloor/infra/__tests__/ultimo-reparo.test.ts src/modules/shopfloor/application/lancar-action.ts
git commit -m "shopfloor: achar o último reparo da peça e marcar a origem da confirmação

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: A aplicação — a ação que a tela chama

**Files:**
- Modify: `src/modules/shopfloor/application/lancar-action.ts` (acrescenta `verificarConsertoManutencao` depois de `verificarConserto`, linha ~277; acrescenta o campo na entrada)
- Test: `src/modules/shopfloor/application/__tests__/verificar-conserto-manutencao.test.ts` (criar)

**Interfaces:**
- Consumes: `buscarUltimoReparo` e `mapaPostoRotaDestino` da Task 3; `postoEhDestinoDeRota` e `ConsertoConfirmavel` da Task 2 (`../domain/rota-reteste`).
- Produces:
  - `verificarConsertoManutencao(pmo: string, op: string, numeroSerie: string, posto: string): Promise<ConsertoConfirmavel[] | null>`
  - `EntradaLancamento` ganha `consertoManutencaoConfirmado?: ConsertoConfirmavel[]`

**Contexto que você precisa:**

Leia `verificarConserto` (`lancar-action.ts:264`) antes de escrever. A nova é a irmã dela e segue o mesmo contrato: devolve a lista ou `null`, e **nunca lança**.

O **fail-open é deliberado** e já é a regra da irmã: erro no lookup devolve `null` e o bipe passa sem perguntar. O operador está de pé na bancada com a peça na mão — o custo de perder uma confirmação é menor que o de parar a linha.

- [ ] **Step 1: Escreva o teste que falha**

Crie `src/modules/shopfloor/application/__tests__/verificar-conserto-manutencao.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessao = vi.fn()
const mapaPostoPerfil = vi.fn()
const mapaPostoRotaDestino = vi.fn()
const buscarUltimoReparo = vi.fn()

vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil, mapaPostoRotaDestino }))
vi.mock('@/modules/shopfloor/infra/lancamento-repository', () => ({ buscarUltimoReparo }))

const { verificarConsertoManutencao } = await import('../lancar-action')

const SESSAO_OK = { perfil: { modulos: { shopfloor: { lancar: true } } } }

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(SESSAO_OK)
  mapaPostoPerfil.mockResolvedValue({})
  mapaPostoRotaDestino.mockResolvedValue(new Set(['Inspeção PTH']))
  buscarUltimoReparo.mockResolvedValue([{ conserto: 'Ressolda', posicao: 'R12' }])
})

describe('verificarConsertoManutencao', () => {
  it('posto é destino de rota e a peça veio da Manutenção → devolve os consertos', async () => {
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
    ])
  })

  it('posto NÃO é destino de rota → nulo, e NEM consulta o banco', async () => {
    // É isto que garante custo zero nos outros postos: a decisão é tomada antes da consulta.
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Teste')).toBeNull()
    expect(buscarUltimoReparo).not.toHaveBeenCalled()
  })

  it('sem sessão → nulo', async () => {
    getSessao.mockResolvedValue(null)
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })

  it('sem permissão de lançar → nulo', async () => {
    getSessao.mockResolvedValue({ perfil: { modulos: { shopfloor: { lancar: false } } } })
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })

  it('erro no banco → nulo, não lança (fail-open: não travar o operador)', async () => {
    buscarUltimoReparo.mockRejectedValue(new Error('boom'))
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })

  it('erro ao carregar os mapas → nulo, não lança', async () => {
    mapaPostoRotaDestino.mockRejectedValue(new Error('boom'))
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })
})
```

⚠️ A forma de `SESSAO_OK` tem de bater com o que `podeNoModulo` espera. **Leia `src/modules/auth/domain/perfil.ts` e copie a forma real** — e confira como os testes que já existem de `lancar-action` montam a sessão.

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run src/modules/shopfloor/application/__tests__/verificar-conserto-manutencao.test.ts --maxWorkers=2`
Expected: FALHA — `verificarConsertoManutencao is not a function`.

- [ ] **Step 3: Escreva a implementação**

Em `src/modules/shopfloor/application/lancar-action.ts`, logo depois de `verificarConserto` (linha ~277):

```ts
/**
 * Ao aprovar no posto da ROTA DE RETESTE: se a peça acabou de sair da Manutenção, devolve os
 * consertos que foram registrados lá, para o operador confirmar. Senão, null.
 *
 * Irmã da `verificarConserto` acima. A diferença é a pergunta: lá é "o último registro NESTE posto
 * foi reprova?"; aqui é "o último registro DA PEÇA foi um reparo?" — porque a peça pode estar
 * passando por este posto pela primeira vez.
 *
 * A checagem de destino de rota vem ANTES da consulta: nos postos que não são destino (a maioria),
 * nenhuma ida ao banco acontece.
 *
 * Fail-open, igual à irmã: erro no lookup devolve null e o bipe passa sem perguntar.
 */
export async function verificarConsertoManutencao(
  pmo: string, op: string, numeroSerie: string, posto: string,
): Promise<ConsertoConfirmavel[] | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return null
  try {
    const [destinos, mapa] = await Promise.all([mapaPostoRotaDestino(), mapaPostoPerfil()])
    if (!postoEhDestinoDeRota(posto, destinos)) return null
    return await buscarUltimoReparo(pmo, op, normalizarSerie(numeroSerie), (p) => mapa[p] ?? PERFIL_PADRAO)
  } catch {
    return null
  }
}
```

Acrescente aos imports do arquivo:

```ts
import { postoEhDestinoDeRota, type ConsertoConfirmavel } from '../domain/rota-reteste'
import { mapaPostoRotaDestino } from '../infra/postos-repository'
```

e, no bloco de import de `../infra/lancamento-repository`, acrescente `buscarUltimoReparo`.

⚠️ **NÃO reexporte `ConsertoConfirmavel` daqui.** Este arquivo é `'use server'`: exportar um tipo derruba o `next build`, e nem o `tsc` nem o eslint avisam. A tela importa direto do domínio.

- [ ] **Step 4: Acrescente o campo na entrada e grave a trilha**

Em `EntradaLancamento` (linha ~43), ao lado de `conservoConfirmado`:

```ts
  consertoManutencaoConfirmado?: ConsertoConfirmavel[]
```

E, logo depois do bloco de auditoria que já existe (linha ~254):

```ts
  // Auditoria da confirmação dos consertos da Manutenção, no posto da rota de reteste.
  // Secundária, igual à de cima: se falhar, o lançamento já ocorreu — não bloqueia o chão de fábrica.
  if (entrada.consertoManutencaoConfirmado?.length) {
    try {
      await inserirConservoConfirmado(
        entrada.consertoManutencaoConfirmado.map((c) => ({
          colaborador: entrada.colaborador.trim(), pmo: entrada.pmo, op: entrada.op,
          numeroSerie: limparSerie(entrada.numeroSerie), numeroSerieNorm: normalizarSerie(entrada.numeroSerie),
          posto: entrada.posto, codigo: '', posicao: c.posicao, tipo: '',
          origem: 'manutencao' as const, conserto: c.conserto,
        })),
      )
    } catch {
      // ignora: auditoria é secundária
    }
  }
```

- [ ] **Step 5: Rode e veja passar**

Run: `npx vitest run src/modules/shopfloor --maxWorkers=2 && npx tsc --noEmit`
Expected: tudo passa, `tsc` limpo.

- [ ] **Step 6: Prove o dente**

Mova a linha `if (!postoEhDestinoDeRota(posto, destinos)) return null` para **depois** do `buscarUltimoReparo`.
Expected: FALHA no teste `posto NÃO é destino de rota → nulo, e NEM consulta o banco`. Restaure.

- [ ] **Step 7: Commit**

```bash
git add src/modules/shopfloor/application/lancar-action.ts src/modules/shopfloor/application/__tests__/verificar-conserto-manutencao.test.ts
git commit -m "shopfloor: a ação que pergunta pelos consertos da Manutenção

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: A tela — o modal nos DOIS caminhos

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/page.tsx`
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` (props; **linha ~505** caminho do formulário; **linha ~664** caminho do leitor)
- Test: `src/app/(app)/shopfloor/operar/lancamento/__tests__/conserto-manutencao.test.tsx` (criar)

**Interfaces:**
- Consumes: `verificarConsertoManutencao` da Task 4; `mapaPostoRotaDestino` da Task 3; `postoEhDestinoDeRota` e `ConsertoConfirmavel` da Task 2.
- ⚠️ O tipo vem de `@/modules/shopfloor/domain/rota-reteste`, **nunca** de `lancar-action` (`'use server'`) nem da infra.

**⚠️ O RISCO DESTA TASK, LEIA ANTES DE COMEÇAR**

Este é o arquivo mais crítico do sistema — é a tela que a fábrica inteira usa a cada bipe. E o modal de hoje é chamado em **DOIS lugares**, com código parecido mas não igual:

- **linha ~505**, o caminho do formulário (`ehBurnin`, `comStatus`, `status === 'Aprovado'` já checados)
- **linha ~664**, o caminho do leitor/scanner (mais enxuto, com `setProcessando(false)` no cancelamento)

**Mexer num e esquecer o outro é o erro mais provável de toda esta feature.** A funcionalidade passaria a existir digitando e não bipando (ou o contrário) e ninguém notaria até o chão de fábrica. Há um teste abaixo para cada caminho, e eles existem por esse motivo.

⚠️ **Não mexa em nada além do que está descrito.** As guardas, a ordem delas, o `limparPeca()`, o `setProcessando(false)` e o foco são de outras correções e têm testes próprios.

- [ ] **Step 1: Escreva os testes que falham**

Crie `src/app/(app)/shopfloor/operar/lancamento/__tests__/conserto-manutencao.test.tsx`. Leia primeiro os testes que já existem nessa pasta e **siga o molde deles** (como montam as props, como simulam o bipe, como mockam `confirmar`). Os casos:

```tsx
it('caminho do FORMULÁRIO: aprovar no posto da rota abre o modal com os consertos', async () => {
  // posto 'Inspeção PTH' em postosRotaDestino; verificarConsertoManutencao devolve
  // [{ conserto: 'Ressolda', posicao: 'R12' }]
  expect(await screen.findByText(/Ressolda/)).toBeInTheDocument()
  expect(await screen.findByText(/R12/)).toBeInTheDocument()
})

it('caminho do LEITOR: aprovar no posto da rota abre o modal com os consertos', async () => {
  // o mesmo, pelo caminho do scanner
  expect(await screen.findByText(/Ressolda/)).toBeInTheDocument()
})

it('confirmar grava a trilha com os consertos', async () => {
  // lancarMock recebe consertoManutencaoConfirmado = [{ conserto: 'Ressolda', posicao: 'R12' }]
  expect(lancarMock).toHaveBeenCalledWith(
    expect.objectContaining({ consertoManutencaoConfirmado: [{ conserto: 'Ressolda', posicao: 'R12' }] }),
  )
})

it('cancelar NÃO grava e limpa a peça', async () => {
  expect(lancarMock).not.toHaveBeenCalled()
  expect(campoSn()).toHaveValue('')
})

it('posto que não é destino de rota NÃO chama a ação', async () => {
  // é o que garante que nada muda nos outros postos
  expect(verificarConsertoManutencaoMock).not.toHaveBeenCalled()
})

it('REPROVAR no posto da rota não abre o modal', async () => {
  expect(verificarConsertoManutencaoMock).not.toHaveBeenCalled()
})

it('a peça não veio da Manutenção (ação devolve null) → aprova direto, sem modal', async () => {
  expect(lancarMock).toHaveBeenCalled()
})
```

- [ ] **Step 2: Rode e veja falhar**

Run: `npx vitest run "src/app/(app)/shopfloor/operar/lancamento" --exclude "**/.claude/**" --maxWorkers=2`
Expected: FALHA — a prop `postosRotaDestino` não existe.

- [ ] **Step 3: Carregue o mapa na página**

Em `src/app/(app)/shopfloor/operar/lancamento/page.tsx`:

```tsx
import { mapaPostoPerfil, mapaPostoColetivo, mapaPostoRotaDestino } from '@/modules/shopfloor/infra/postos-repository'
// ...
  const [ordens, defeitos, postosPerfil, postosColetivo, postosRotaDestino] = await Promise.all([
    listarOrdensParaLancamento(),
    listarDefeitos(),
    mapaPostoPerfil(),
    mapaPostoColetivo(),
    mapaPostoRotaDestino(),
  ])

  return (
    <div className="flex flex-col gap-4">
      <LancamentoForm
        ordens={ordens}
        defeitos={defeitos}
        postosPerfil={postosPerfil}
        postosColetivo={postosColetivo}
        postosRotaDestino={[...postosRotaDestino]}
      />
    </div>
  )
```

⚠️ Passa como **array**, não `Set`: props de componente de servidor para cliente precisam ser serializáveis, e `Set` não é.

- [ ] **Step 4: Receba a prop no formulário**

Em `lancamento-form.tsx`, nas props (linha ~59-66):

```tsx
  postosRotaDestino,
```
```tsx
  postosRotaDestino: string[]
```

E, junto dos outros derivados (perto da linha 110):

```tsx
  const destinosRota = useMemo(() => new Set(postosRotaDestino), [postosRotaDestino])
```

- [ ] **Step 5: O modal no caminho do FORMULÁRIO**

Em `lancamento-form.tsx`, **logo depois** do bloco `if (!ehBurnin && comStatus && status === 'Aprovado' && perfilPedeConfirmacaoConserto(...))` que termina na linha ~521:

```tsx
    // Confirmação dos consertos da Manutenção: no posto da rota de reteste, ao APROVAR, se a peça
    // acabou de sair da Manutenção, confirmar o que foi reparado lá.
    let consertoManutencaoConfirmado: ConsertoConfirmavel[] | undefined
    if (!ehBurnin && comStatus && status === 'Aprovado' && postoEhDestinoDeRota(posto, destinosRota)) {
      const consertos = await verificarConsertoManutencao(pmo, op, numeroSerie, posto)
      if (consertos && consertos.length > 0) {
        const lista = consertos.map(descreverConserto).join(' · ')
        const ok = await confirmar({
          titulo: 'Confirmar os consertos da Manutenção?',
          descricao: `A Manutenção registrou: ${lista}. Confirma antes de aprovar?`,
          rotuloConfirmar: 'Sim, confirmo',
        })
        if (!ok) { limparPeca(); return }
        consertoManutencaoConfirmado = consertos
      }
    }
```

e acrescente `consertoManutencaoConfirmado` ao objeto `entrada` logo abaixo.

- [ ] **Step 6: O modal no caminho do LEITOR**

⚠️ **É este o passo que se esquece.** Em `lancamento-form.tsx`, **logo depois** do bloco `if (perfilPedeConfirmacaoConserto(perfilDo(posto)))` que termina na linha ~680:

```tsx
    let consertoManutencaoConfirmado: ConsertoConfirmavel[] | undefined
    if (postoEhDestinoDeRota(posto, destinosRota)) {
      const consertos = await verificarConsertoManutencao(pmo, op, sn, posto)
      if (consertos && consertos.length > 0) {
        const lista = consertos.map(descreverConserto).join(' · ')
        const ok = await confirmar({
          titulo: 'Confirmar os consertos da Manutenção?',
          descricao: `A Manutenção registrou: ${lista}. Confirma antes de aprovar?`,
          rotuloConfirmar: 'Sim, confirmo',
        })
        if (!ok) { setProcessando(false); limparPeca(); return }
        consertoManutencaoConfirmado = consertos
      }
    }
```

⚠️ Repare no `setProcessando(false)` — este caminho tem, o do formulário não. É assim que o bloco irmão faz logo acima; copie o comportamento do vizinho, não o do outro caminho.

E acrescente `consertoManutencaoConfirmado` ao `entrada` deste caminho.

- [ ] **Step 7: O texto de cada conserto**

Junto de `descreverDefeito` (linha ~47):

```tsx
/** Texto curto de um conserto da Manutenção para o diálogo de confirmação. */
function descreverConserto(c: { conserto: string; posicao: string }): string {
  const partes: string[] = []
  if (c.conserto.trim()) partes.push(c.conserto.trim())
  if (c.posicao.trim()) partes.push(`Posição ${c.posicao.trim()}`)
  return partes.join(' · ') || 'conserto registrado'
}
```

- [ ] **Step 8: Rode tudo**

```bash
npx vitest run "src/app/(app)/shopfloor" src/modules/shopfloor --exclude "**/.claude/**" --maxWorkers=2
npx tsc --noEmit
npx eslint "src/app/(app)/shopfloor/operar/lancamento" src/modules/shopfloor
```
Expected: os três limpos.

- [ ] **Step 9: Prove o dente dos dois caminhos**

Comente o bloco do passo 5 e rode.
Expected: FALHA só no teste do caminho do FORMULÁRIO. Restaure.

Comente o bloco do passo 6 e rode.
Expected: FALHA só no teste do caminho do LEITOR. Restaure.

**Se as duas mutações derrubarem os mesmos testes, os testes não estão separando os caminhos — conserte-os antes de seguir.**

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/shopfloor/operar/lancamento/page.tsx" "src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx" "src/app/(app)/shopfloor/operar/lancamento/__tests__/conserto-manutencao.test.tsx"
git commit -m "shopfloor: o posto da rota confirma o que a Manutenção consertou

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Depois das cinco tasks

1. **Revisão da branch inteira** com `superpowers:requesting-code-review`.
2. **Build de verdade** (o Turbopack não roda nesta worktree): `git worktree add --detach <dir> <sha>` + `cp -al node_modules <dir>/` + copiar `.env` e `.env.local`, e então `npx next build`.
3. **0138 no Dev** e smoke guiado:
   - bipe normal num posto QUALQUER (prova que nada mudou para a maioria)
   - peça reprovada no Teste → reparada na Manutenção → aprovar na Inspeção PTH: o modal abre com os consertos
   - confirmar → consultar `sf_conserto_confirmado` e ver as linhas com `origem = 'manutencao'`
   - cancelar → nada gravado, peça de lado
   - reprovar na Inspeção PTH → nenhum modal
   - o mesmo pelo caminho do leitor, bipando
4. **Merge** e, no deploy, **0138 antes do app**.
