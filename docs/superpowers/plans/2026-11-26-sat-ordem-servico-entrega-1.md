# SAT — Ordem de serviço, Entrega 1 (OS + etapas + fila + ficha + manutenção) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada relógio que entra no SAT ganha uma ordem de serviço `NNNN/AA` no ShopFloor, que anda pelas etapas recebido → nota pendente / disponível → em manutenção → qualidade, com fila por etapa, ficha da OS e a manutenção (defeitos, peças em 4 camadas, laudo, troca de NS) para relógio em garantia.

**Architecture:** Uma migração nova (`0198_sat_ordem_servico.sql`) cria as tabelas da OS, a numeração e as funções `security definer` que validam cada transição; a OS nasce por **gatilho** em `sat_entradas` (e por backfill para as entradas que já existem), e as mudanças de NF/ticket já existentes movem a OS por **gatilhos** em `sat_nfs`/`sat_entradas`/`sat_os` — nenhuma função da entrada (0187/0190) é reescrita. O app ganha domínio puro (`ordem.ts`, `estrutura.ts`, `defeitos-compels.ts`), leituras só-leitura do Compels pelo `ClienteCompels` com cache no banco (7 dias), as actions da OS e três telas (fila, ficha, manutenção dentro da ficha).

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, Supabase (PostgREST + RLS + funções plpgsql), Vitest + Testing Library, testes SQL em Postgres 15 descartável (Docker), rolldown para os scripts de `tools/compels`.

## Global Constraints

- Worktree: `/home/rwtech/Área de trabalho/ShopFloor-sat-os`, branch `feat/sat-ordem-servico`. Trabalhe SÓ nela. Todos os caminhos deste plano são relativos a essa pasta.
- Next.js 16 tem mudanças: antes de usar qualquer API do Next que não esteja copiada deste plano, leia o guia em `node_modules/next/dist/docs/` (ex.: `01-app/03-api-reference/04-functions/revalidatePath.md`). `params` e `searchParams` das páginas são `Promise`.
- Tudo em português do Brasil: código, comentários, textos de tela, mensagens de commit.
- **Nada grava no Compels.** Este módulo só LÊ do Compels: defeitos (`sat/defeito/findAll`), estrutura (`composicaoProduto/findByCodigoItem` → `composicaoProduto/findComposicaoByIdEntireTree`), pais de item (`composicaoProduto/findParentsByItemId/<itemId>`) e itens (`itemMovimento/findFilter`).
- Não copie `negociante.observacao` de lugar nenhum (pode ter senha de cliente).
- Migração: `supabase/migrations/0198_sat_ordem_servico.sql` (a main vai até 0197; 0198 está livre em todas as branches locais). Aditiva e idempotente (`if not exists`, `create or replace`, `drop ... if exists`), corpo das funções com `$func$` (o SQL Editor recusa `$$`), `revoke`/`grant` explícitos, `notify pgrst, 'reload schema';` na ÚLTIMA linha.
- RLS: só leitura, `using ((select tem_permissao('sat', 'visualizar')))` (InitPlan, padrão da 0096) — NUNCA `tem_permissao(...)` sem o `select`. Nenhuma policy de escrita: o usuário grava só pelas funções `security definer`, que conferem a permissão de novo no banco.
- Numeração da OS: `NNNN/AA` (4 dígitos com zero à esquerda, barra, 2 dígitos do ano de Brasília), continuando a do Compels: semente `2026 → 396` (última OS do Compels em 26/11/2026 = `0396/26`).
- Etapas desta entrega (valores no banco): `recebido`, `nota_pendente`, `disponivel`, `em_manutencao`, `qualidade`. A OS PARA em `qualidade` (a tela de qualidade é da Entrega 3). Fora da garantia também vai para `qualidade` (igual a em garantia; só a garantia a definir bloqueia); o orçamento corre em paralelo e é a Entrega 2. (Correção posterior: o código das tarefas abaixo foi atualizado na branch.)
- Permissão nova: `sat.manutencao` (não tem coluna `pode_*`). `sat.administrar` JÁ existe (corrige etapa com motivo). `sat.visualizar` é exigida em toda tela do SAT.
- Toda mudança da OS grava em `sat_ordem_historico` (quem, quando, de/para, dados).
- Cache das leituras do Compels no banco (`sat_compels_cache`) com validade de 7 dias.
- Testes de app: `npx vitest run <arquivo> --maxWorkers=2` (sem `--maxWorkers=2` o vitest morre com exit 137 nesta máquina). Testes SQL: `bash supabase/tests/rodar-sat-test.sh` (precisa de Docker; não encosta em Dev nem Prod).
- Não aplique migração em banco remoto, não faça push. Commits só com os arquivos da tarefa, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Não acrescente tela, botão ou campo que este plano não peça (preferência do usuário: oferecer em uma linha, não fazer).

## Mapa de arquivos

**Banco**
- Criar `supabase/migrations/0198_sat_ordem_servico.sql` — tabelas, numeração, gatilhos, funções (montado nas Tarefas 2–5).
- Criar `supabase/tests/sat_ordem_test.sql` — testes da 0198 (um bloco por tarefa).
- Modificar `supabase/tests/rodar-sat-test.sh` — roda a 0198 (2x, idempotência), confere as policies e aplica do zero.

**Domínio (puro)**
- Criar `src/modules/sat/domain/ordem.ts` — etapas, tipos, rótulos, agrupamento da fila, validações da manutenção, tempo na etapa.
- Criar `src/modules/sat/domain/estrutura.ts` — leitura da estrutura/pais/itens do Compels; camada 3 (peças trocáveis) e regra do kit.
- Criar `src/modules/sat/domain/defeitos-compels.ts` — defeitos do Compels → SQL de carga.
- Modificar `src/modules/sat/domain/erros.ts` — códigos novos.
- Modificar `src/modules/auth/domain/modulos.ts`, `src/modules/auth/domain/perfil.ts`, `src/modules/perfis/domain/regras-perfil.ts` — permissão `manutencao`.

**Integração com o Compels (só leitura)**
- Modificar `src/modules/compels/infra/cliente.ts` — `listarDefeitosSat`, `composicaoDoItem`, `arvoreDaComposicao`, `paisDoItem`, `buscarItens`.
- Criar `tools/compels/defeitos-sat.ts` (+ `.mjs` gerado) — gera o SQL de carga dos defeitos.
- Criar `tools/compels/sat-estrutura.ts` (+ `.mjs` gerado) — conferência só-leitura da estrutura, dos pais e da busca de itens.

**Infra / aplicação**
- Criar `src/modules/sat/infra/cache-compels.ts` — `lerComCache` + armazém no banco.
- Criar `src/modules/sat/infra/estrutura-compels.ts` — leituras do Compels com cache.
- Criar `src/modules/sat/infra/ordens-repository.ts` — leitura da fila/ficha e chamadas às funções da 0198.
- Criar `src/modules/sat/application/pecas-sugeridas.ts` — as 4 camadas.
- Criar `src/modules/sat/application/ordens-actions.ts` — server actions da OS.

**Telas**
- Criar `src/app/(app)/sat/etapa-ordem.tsx` — selos de etapa e de tipo.
- Criar `src/app/(app)/sat/ordens/page.tsx` — fila do SAT.
- Criar `src/app/(app)/sat/ordens/[id]/page.tsx` — ficha da OS.
- Criar `src/app/(app)/sat/ordens/[id]/manutencao.tsx`, `seletor-pecas.tsx`, `corrigir-etapa.tsx` — componentes de cliente.
- Modificar `src/app/(app)/sat/equipamentos/[id]/page.tsx` — link para a OS do relógio.
- Modificar `src/shared/ui/app-shell.tsx` — item "Ordens de serviço" no acordeão SAT.

## Decisões tomadas neste plano (onde a spec deixava aberto)

1. **A OS nasce por gatilho**, não reescrevendo `sat_registrar_nf`: `after insert on sat_entradas` chama `sat__criar_ordem`. Corrigir/trocar NF (`sat_corrigir_nf`/`sat_trocar_nf`, que já existem) movem a OS por `after update on sat_nfs`: NF passa a aprovada → as OS da nota em `nota_pendente` vão para `disponivel`; NF passa a reprovada → as OS em `disponivel` (ainda não abertas) voltam para `nota_pendente`. OS já em manutenção não se mexem.
2. **Tipo pela garantia da planilha**, recalculado enquanto a OS não passou da manutenção: `GARANTIA` → `em_garantia`; `SEM GARANTIA` / `FORA DA GARANTIA` / `NÃO` → `fora_garantia`; vazio ou outro texto → `null` ("Garantia a definir"). Recalcula quando o ticket do relógio muda (`sat_associar_os`) e quando a planilha muda a garantia (cron). Enviar para a qualidade exige `em_garantia`.
3. **Numeração**: tabela `sat_numeracao (ano, ultimo)` com semente `(2026, 396)`; próximo número por `insert ... on conflict do update` (trava a linha do ano, sem corrida). Ano = ano de Brasília do `criado_em` da entrada. Ano sem linha começa em 1. O backfill numera as entradas existentes na ordem em que chegaram.
4. **Defeitos: script que gera o SQL** (`tools/compels/defeitos-sat.mjs > arquivo.sql`, depois `psql -1 -f`). É uma carga única; o script roda onde o usuário já roda os outros de `tools/compels` (instância AWS, com as `COMPELS_*` do `.env.production`), não precisa de tela, permissão nem rota nova, e o mesmo arquivo serve para Dev e RDS.
5. **Kits candidatos (camada 2)**: (a) kits `PMOE*` já usados em qualquer OS (`sat_ordem_pecas`) + (b) os pais `PMOE*` das peças trocáveis do produto (`findParentsByItemId`, até 30 nós). Cada candidato tem a estrutura lida (até 20) e **serve** quando todos os componentes de 1º nível dele (sem `RWSV*` e embalagem) estão em algum nível da árvore do produto. Tudo em cache de 7 dias (`estrutura:<código>`, `pais:<itemId>`), então o custo (~50 leituras) é só na primeira abertura do produto na semana. Só o histórico (a) começaria vazio e nunca acharia o kit que ninguém usou; só os pais (b) depende de `item.id` vir na árvore — juntos, um cobre a falha do outro.
6. **Camada 3 (peças trocáveis)**: nós de 1º e 2º nível da árvore que **têm filhos** (subconjunto montado: placa, fonte, módulo, gabinete) **ou** têm código `PMO*`; fora: código `PRT*` ou `RWSV*` e descrição de embalagem (`EMBALAGEM`, `CAIXA DE PAPELAO`, `SACO`, `ETIQUETA`, `MANUAL`, `CALCO`, `PLASTICO BOLHA`, `FITA`). Nó `PRT*` não entra, mas os filhos dele ainda são olhados (até o 2º nível). Componente eletrônico de placa é folha sem `PMO*` → fica fora. Os prefixos ficam numa constante (`PREFIXOS_FORA_DA_LISTA`).
7. **Camada 4**: `itemMovimento/findFilter` — a única busca de item que o projeto já usa (`consultarSaldoItem`). Termo com cara de código (`PRT706`, `PMOE7`) vai em `codigo`; o resto em `descricao`. Se a conferência mostrar que a busca não é parcial, troca-se só `ClienteCompels.buscarItens` (ver Tarefa 7, passo final).
8. **"Recebido" na linha do tempo**: a OS nasce já na etapa da NF; o histórico grava duas linhas no mesmo instante (`→ recebido`, `recebido → nota_pendente|disponivel`). A fila só mostra a coluna "Recebido" se houver OS nela (só por correção do administrador).
9. **Peça removida na manutenção** é apagada da OS (o lançamento errado) e a remoção fica no histórico; a situação `devolvida` fica para o orçamento reprovado (Entrega 2).
10. **Colunas das entregas seguintes não entram agora**: valor da manutenção/frete, resposta do orçamento, pagamento, rastreio, data de saída, `fechada_em` e o id da OS no Compels são criados pela migração da entrega que os usa (YAGNI). Já entram `origem` (`shopfloor`/`compels`) e o `tipo` com os 4 valores da spec, porque as restrições da tabela dependem deles.
11. **Cadastro de defeitos (tela de administração)** não está nesta entrega: a lista vem da carga do Compels; a tela fica para quando a qualidade (Entrega 3) também usar a lista.

## Pontos que precisam de confirmação do usuário (não bloqueiam a implementação)

- **Semente da numeração**: confirmar no Compels o último número de 2026 no dia do deploy e trocar o `396` da migração ANTES de aplicá-la no RDS (o backfill numera na hora). Depois de aplicada, só dá para andar para frente: `update public.sat_numeracao set ultimo = <número> where ano = 2026;`.
- **Backfill numera as entradas desde 17/11**: essas OS já podem ter número no Compels (o SAT ainda abria OS lá). Esta entrega dá número novo a elas (continuando a sequência). Se o SAT preferir outro critério, decidir antes do deploy.
- **Regra da camada 3** (`PRT*` fora): conferir com a saída do `tools/compels/sat-estrutura.mjs PMOC31` (Tarefa 7) antes do deploy; se as placas montadas forem `PRT*`, tirar `PRT` de `PREFIXOS_FORA_DA_LISTA`.
- **Formato dos parâmetros** de `findByCodigoItem`/`findComposicaoByIdEntireTree` (formulário) e de `itemMovimento/findFilter` como busca parcial: confirmados pela conferência da Tarefa 7.

---

### Task 1: Preparar o worktree e criar a permissão `sat.manutencao`

**Files:**
- Modify: `src/modules/auth/domain/perfil.ts:14-18`
- Modify: `src/modules/auth/domain/modulos.ts:26-29`
- Modify: `src/modules/perfis/domain/regras-perfil.ts:3-17,58-66`
- Test: `src/modules/auth/domain/__tests__/modulos.test.ts`
- Test: `src/modules/perfis/domain/__tests__/regras-perfil.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Permissao` passa a aceitar `'manutencao'`; `PERMISSOES_POR_MODULO.sat` = `['visualizar', 'registrar_entrada', 'aprovar_nf', 'associar_os', 'manutencao', 'administrar']`; `PERMISSOES` ganha `{ chave: 'manutencao', rotulo: 'Manutenção' }` logo depois de `associar_os`. As Tarefas 11–14 usam `podeNoModulo(perfil, 'sat', 'manutencao')`.

- [ ] **Step 1: Dar `node_modules` ao worktree (hard link, não symlink)**

```bash
cd "/home/rwtech/Área de trabalho/ShopFloor-sat-os"
cp -al "/home/rwtech/Área de trabalho/ShopFloor/node_modules" ./node_modules
ls -ld node_modules
```
Expected: a linha começa com `d` (diretório real). Se começar com `l`, apague e repita com `cp -al` (symlink quebra o `next build`).

- [ ] **Step 2: Escrever os testes que falham**

Em `src/modules/auth/domain/__tests__/modulos.test.ts`, troque o teste do SAT por:

```ts
  it('sat tem visualizar, registrar_entrada, aprovar_nf, associar_os, manutencao e administrar', () => {
    expect(PERMISSOES_POR_MODULO.sat).toEqual(['visualizar', 'registrar_entrada', 'aprovar_nf', 'associar_os', 'manutencao', 'administrar'])
  })
```

Em `src/modules/perfis/domain/__tests__/regras-perfil.test.ts`, no teste `'o SAT NÃO liga nenhum pode_* ...'`, acrescente `{ modulo: 'sat', permissao: 'manutencao' },` depois da linha de `associar_os` e `expect(Object.keys(f)).not.toContain('pode_manutencao')` depois do `expect` de `pode_associar_os`. No `describe('PERMISSOES', ...)`, acrescente:

```ts
  it('manutencao vem depois de associar_os, com rótulo "Manutenção"', () => {
    const chaves = PERMISSOES.map((p) => p.chave)
    expect(chaves.indexOf('manutencao')).toBe(chaves.indexOf('associar_os') + 1)
    expect(PERMISSOES.find((p) => p.chave === 'manutencao')?.rotulo).toBe('Manutenção')
  })
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/modules/auth/domain/__tests__/modulos.test.ts src/modules/perfis/domain/__tests__/regras-perfil.test.ts --maxWorkers=2`
Expected: FAIL — `PERMISSOES_POR_MODULO.sat` sem `manutencao`; `indexOf('manutencao')` = -1 (e erro de tipo no `permissao: 'manutencao'`).

- [ ] **Step 4: Implementar**

`src/modules/auth/domain/perfil.ts` — troque o comentário e o tipo `Permissao` por:

```ts
/**
 * Só existem por módulo — não têm coluna `pode_*`: `baixar` (Faturamento: baixa de NF no Compels),
 * `registrar_entrada`, `aprovar_nf`, `associar_os` e `manutencao` (SAT: entrada de equipamento, aprovação da NF de
 * entrada, troca da OS do relógio e a manutenção da ordem de serviço).
 */
export type Permissao = PermissaoLegada | 'baixar' | 'registrar_entrada' | 'aprovar_nf' | 'associar_os' | 'manutencao'
```

`src/modules/auth/domain/modulos.ts` — troque o comentário e a linha do `sat` por:

```ts
  // `registrar_entrada` = dar entrada na nota e nos relógios; `aprovar_nf` = corrigir/trocar a NF depois da entrada;
  // `associar_os` = o técnico troca a OS do relógio na ficha; `manutencao` = abrir a manutenção da ordem de serviço,
  // lançar defeitos, peças, laudo, troca de NS e mandar para a qualidade; `administrar` = corrigir a etapa da OS
  // (com motivo) e os Alertas do SAT.
  sat: ['visualizar', 'registrar_entrada', 'aprovar_nf', 'associar_os', 'manutencao', 'administrar'],
```

`src/modules/perfis/domain/regras-perfil.ts` — em `PERMISSOES`, depois de `{ chave: 'associar_os', rotulo: 'Associar OS' },` acrescente:

```ts
  { chave: 'manutencao', rotulo: 'Manutenção' },
```

e no comentário de `flagsLegadas` troque a última linha por:

```ts
 * `baixar`, `registrar_entrada`, `aprovar_nf`, `associar_os` e `manutencao` não têm coluna — nunca viram flag.
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/modules/auth src/modules/perfis --maxWorkers=2`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/domain/perfil.ts src/modules/auth/domain/modulos.ts src/modules/perfis/domain/regras-perfil.ts src/modules/auth/domain/__tests__/modulos.test.ts src/modules/perfis/domain/__tests__/regras-perfil.test.ts
git commit -m "feat(sat): permissão sat.manutencao (sem flag pode_*)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Migração 0198, parte A — tabelas da OS, numeração, OS criada na entrada e backfill

**Files:**
- Create: `supabase/migrations/0198_sat_ordem_servico.sql`
- Create: `supabase/tests/sat_ordem_test.sql`
- Modify: `supabase/tests/rodar-sat-test.sh` (bloco novo depois do de policies; "do zero" aplica a 0198)

**Interfaces:**
- Consumes: `sat_entradas`, `sat_nfs`, `sat_os`, `usuarios`, `tem_permissao(text, text)`, `auth.uid()`, `sat__nome_usuario()` (0186/0187/0190).
- Produces (usadas nas Tarefas 3–5 e no app):
  - tabelas `sat_numeracao(ano, ultimo)`, `sat_defeitos`, `sat_ordens`, `sat_ordem_defeitos`, `sat_ordem_pecas`, `sat_ordem_ns`, `sat_ordem_historico` (colunas exatas no SQL abaixo; `sat_ordem_historico.seq` ordena a linha do tempo);
  - `sat__tipo_da_garantia(text) returns text` (`'em_garantia' | 'fora_garantia' | null`);
  - `sat__proximo_numero(int) returns text` (`'0397/26'`);
  - `sat__ordem_evento(uuid, text, jsonb) returns void` (grava evento sem mudar etapa);
  - `sat__criar_ordem(uuid) returns uuid` (id da OS da entrada; idempotente);
  - gatilho `sat_entradas_ordem` (after insert em `sat_entradas`).

- [ ] **Step 1: Escrever o teste SQL que falha**

Crie `supabase/tests/sat_ordem_test.sql`:

```sql
-- Testes da 0198 (SAT: ordem de serviço, entrega 1). Roda DEPOIS do sat_motivos_test.sql, na mesma base: as entradas
-- que os testes anteriores deixaram são as "entradas antigas" do backfill. Dados SINTÉTICOS.
-- Runner: supabase/tests/rodar-sat-test.sh

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
create temp table antes_os as select count(*) as entradas from sat_entradas;

\i /tmp/0198.sql
grant all on all tables in schema public to anon, authenticated;

-- 1. Backfill: uma OS por entrada antiga, numeradas na ordem de chegada a partir de 0397/AA (2026) ou 0001/AA
--    (outro ano: sem semente); etapa pela NF; duas linhas de histórico por OS.
do $t$
declare
  v_n        int := (select entradas from antes_os);
  v_ano      int := extract(year from now() at time zone 'America/Sao_Paulo')::int;
  v_primeiro int;
  v_nums     text[];
  i          int;
begin
  v_primeiro := case when v_ano = 2026 then 397 else 1 end;
  if v_n = 0 then raise exception 'FALHOU: os testes anteriores não deixaram entradas'; end if;
  if (select count(*) from sat_ordens) <> v_n then
    raise exception 'FALHOU: backfill criou % OS para % entradas', (select count(*) from sat_ordens), v_n;
  end if;
  select array_agg(o.numero order by e.criado_em, e.id) into v_nums
    from sat_ordens o join sat_entradas e on e.id = o.entrada_id;
  for i in 1 .. v_n loop
    if v_nums[i] <> lpad((v_primeiro + i - 1)::text, 4, '0') || '/' || lpad((v_ano % 100)::text, 2, '0') then
      raise exception 'FALHOU: numeração do backfill %', v_nums;
    end if;
  end loop;
  if (select ultimo from sat_numeracao where ano = v_ano) <> v_primeiro + v_n - 1 then
    raise exception 'FALHOU: sat_numeracao não andou';
  end if;
  if exists (select 1 from sat_ordens o join sat_entradas e on e.id = o.entrada_id join sat_nfs n on n.id = e.nf_id
              where o.etapa <> case when n.situacao = 'aprovada' then 'disponivel' else 'nota_pendente' end) then
    raise exception 'FALHOU: etapa do backfill não segue a NF';
  end if;
  if exists (select 1 from sat_ordens o where o.origem <> 'shopfloor' or o.ns_atual = '') then
    raise exception 'FALHOU: origem/NS do backfill';
  end if;
  if (select count(*) from sat_ordem_historico) <> 2 * v_n then raise exception 'FALHOU: histórico do backfill'; end if;
  if exists (select 1 from sat_ordem_historico h where h.evento <> 'etapa'
                or not ((h.etapa_de is null and h.etapa_para = 'recebido')
                        or (h.etapa_de = 'recebido' and h.etapa_para in ('disponivel', 'nota_pendente')))) then
    raise exception 'FALHOU: linhas do histórico do backfill';
  end if;
  raise notice 'backfill: ok';
end $t$;

-- 2. Garantia da planilha → tipo.
do $t$
begin
  if sat__tipo_da_garantia('GARANTIA') is distinct from 'em_garantia'
     or sat__tipo_da_garantia('Em garantia') is distinct from 'em_garantia'
     or sat__tipo_da_garantia('SEM GARANTIA') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('sem garantia') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('Fora da garantia') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('NÃO') is distinct from 'fora_garantia'
     or sat__tipo_da_garantia('') is not null
     or sat__tipo_da_garantia(null) is not null
     or sat__tipo_da_garantia('verificar') is not null then
    raise exception 'FALHOU: sat__tipo_da_garantia';
  end if;
  raise notice 'tipo pela garantia: ok';
end $t$;

-- 3. Entrada nova cria a OS pelo gatilho: ticket com garantia → tipo; NF reprovada → nota pendente.
set role service_role;
select sat_sincronizar_planilha($j$[
  {"chave": "T-OS-1", "numero": "900", "data": "2026-11-01", "solucao": "Envio ao SAT", "garantia": "GARANTIA",
   "itens": [{"chave": "o1", "ns": "610-1", "modelo": "610", "sequencia": "1"}]},
  {"chave": "T-OS-2", "numero": "901", "data": "2026-11-02", "solucao": "Envio ao SAT", "garantia": "SEM GARANTIA",
   "itens": [{"chave": "o2", "ns": "610-2", "modelo": "610", "sequencia": "2"}]}
]$j$);
reset role;

do $t$
declare r jsonb; v_antes int := (select count(*) from sat_ordens); v_o sat_ordens;
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.registrar_entrada', false);
  r := sat_registrar_nf(jsonb_build_object('numero', 'NF-OS-1', 'cnpj', '12345678000190', 'empresa', 'Cliente OS',
         'situacao', 'aprovada', 'relogios', jsonb_build_array(
           jsonb_build_object('ns', '610-1', 'modelo', '610', 'sequencia', '1', 'produto', 'PMOC31'),
           jsonb_build_object('ns', '610-2', 'modelo', '610', 'sequencia', '2', 'produto', 'PMOC31'),
           jsonb_build_object('ns', '610-3', 'modelo', '610', 'sequencia', '3', 'produto', 'PMOC31'))));
  reset role;
  if (select count(*) from sat_ordens) <> v_antes + 3 then raise exception 'FALHOU: gatilho não criou 3 OS'; end if;

  select * into v_o from sat_ordens where sequencia = '1' and modelo = '610';
  if v_o.etapa <> 'disponivel' or v_o.tipo is distinct from 'em_garantia' or v_o.garantia <> 'GARANTIA'
     or v_o.ticket_numero <> '900' or v_o.cliente <> 'Cliente OS' or v_o.cnpj <> '12.345.678/0001-90'
     or v_o.produto <> 'PMOC31' or v_o.ns_atual <> '610-1' then
    raise exception 'FALHOU: OS do 610-1 %', row_to_json(v_o);
  end if;
  if (select tipo from sat_ordens where sequencia = '2' and modelo = '610') is distinct from 'fora_garantia' then
    raise exception 'FALHOU: OS do 610-2 devia ser fora da garantia';
  end if;
  if (select tipo from sat_ordens where sequencia = '3' and modelo = '610') is not null then
    raise exception 'FALHOU: OS sem ticket devia ter garantia a definir';
  end if;
  -- números seguidos, na ordem dos relógios
  if (select array_agg(split_part(numero, '/', 1)::int order by split_part(numero, '/', 1)::int)
        from sat_ordens where modelo = '610') <>
     (select array_agg(x) from generate_series(
        (select min(split_part(numero, '/', 1)::int) from sat_ordens where modelo = '610'),
        (select min(split_part(numero, '/', 1)::int) from sat_ordens where modelo = '610') + 2) x) then
    raise exception 'FALHOU: números das 3 OS não são seguidos';
  end if;

  set local role authenticated;
  r := sat_registrar_nf(jsonb_build_object('numero', 'NF-OS-2', 'cnpj', '12345678000190', 'empresa', 'Cliente OS',
         'situacao', 'reprovada', 'motivos', jsonb_build_array((select id from sat_motivos_nf where texto = 'CFOP errado')),
         'relogios', jsonb_build_array(jsonb_build_object('ns', '611-1', 'modelo', '611', 'sequencia', '1'))));
  reset role;
  if (select etapa from sat_ordens where modelo = '611' and sequencia = '1') <> 'nota_pendente' then
    raise exception 'FALHOU: NF reprovada devia deixar a OS em nota pendente';
  end if;
  raise notice 'OS criada na entrada: ok';
end $t$;

-- 4. RLS: sem sat.visualizar não vê nada; ninguém grava direto nas tabelas.
do $t$
declare v int;
begin
  set local role authenticated;
  perform set_config('teste.perms', 'sat.registrar_entrada,sat.manutencao,sat.administrar', false);
  select count(*) into v from sat_ordens;
  if v <> 0 then raise exception 'FALHOU: sem visualizar viu % OS', v; end if;
  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao,sat.administrar', false);
  select count(*) into v from sat_ordens;
  if v = 0 then raise exception 'FALHOU: com visualizar não viu as OS'; end if;
  begin
    update sat_ordens set etapa = 'qualidade';
    if exists (select 1 from sat_ordens where etapa = 'qualidade') then raise exception 'FALHOU: update direto passou'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into sat_defeitos (descricao) values ('Direto');
    raise exception 'FALHOU: insert direto em sat_defeitos passou';
  exception when insufficient_privilege then null;
  end;
  begin
    perform sat__criar_ordem((select id from sat_entradas limit 1));
    raise exception 'FALHOU: authenticated chamou sat__criar_ordem';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'RLS: ok';
end $t$;
```

- [ ] **Step 2: Ligar o teste no runner**

Em `supabase/tests/rodar-sat-test.sh`, logo DEPOIS do bloco `# ---------- As 6 policies usam o InitPlan ...` (que termina no `fi` do `echo "6 policies de leitura em InitPlan, nenhuma de escrita: ok"`) e ANTES de `# ---------- Do zero, como TRANSAÇÃO ÚNICA`, acrescente:

```bash
# ---------- 0198 (ordem de serviço, entrega 1): backfill, gatilhos, manutenção ----------
docker cp supabase/migrations/0198_sat_ordem_servico.sql "$NOME":/tmp/0198.sql
docker cp supabase/tests/sat_ordem_test.sql "$NOME":/tmp/teste_ordem.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_ordem.sql
CONTAGEM_OS="select (select count(*) from sat_ordens) || '/' ||
  (select string_agg(numero || ':' || etapa || ':' || coalesce(tipo, '-'), ',' order by numero) from sat_ordens) || '/' ||
  (select count(*) from sat_ordem_historico) || '/' || (select string_agg(ano || ':' || ultimo, ',' order by ano) from sat_numeracao) || '/' ||
  (select md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc), ',' order by p.oid::regprocedure::text))
     from pg_proc p where p.proname like 'sat\_%');"
ANTES=$(sessao <<<"$CONTAGEM_OS")
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0198.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0198.sql
DEPOIS=$(sessao <<<"$CONTAGEM_OS")
if [ "$ANTES" = "$DEPOIS" ]; then
  echo "idempotência da 0198 (OS, numeração, histórico e funções intactos): ok"
else
  echo "idempotência da 0198 FALHOU (antes=$ANTES depois=$DEPOIS)"
  exit 1
fi

TABELAS_0198="'sat_defeitos','sat_ordens','sat_ordem_defeitos','sat_ordem_pecas','sat_ordem_ns','sat_ordem_historico'"
POLS_OS=$(sessao <<SQL
select count(*) from pg_policies
 where tablename in ($TABELAS_0198) and cmd = 'SELECT'
   and qual like '%SELECT tem_permissao(''sat''::text, ''visualizar''::text)%';
SQL
)
TOTAL_OS=$(sessao <<SQL
select count(*) from pg_policies where tablename in ($TABELAS_0198) or tablename = 'sat_numeracao';
SQL
)
if [ "$POLS_OS" = "6" ] && [ "$TOTAL_OS" = "6" ]; then
  echo "0198: 6 policies de leitura em InitPlan, nenhuma de escrita, sat_numeracao sem policy: ok"
else
  echo "0198: policies FALHARAM (InitPlan=$POLS_OS total=$TOTAL_OS)"
  exit 1
fi
```

E, no bloco "Do zero", depois da linha que aplica a `0190.sql` no banco `limpo`, acrescente:

```bash
docker cp supabase/migrations/0198_sat_ordem_servico.sql "$NOME":/tmp/0198.sql
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0198.sql
```

e troque a linha `echo "0186, 0187 e 0190 do zero, cada uma em transação única: ok"` por:

```bash
echo "0186, 0187, 0190 e 0198 do zero, cada uma em transação única: ok"
```

Atualize também o comentário da 1ª linha do runner para `# Testes SQL do SAT (migrações 0186, 0187, 0190 e 0198) num Postgres descartável (Docker).`

- [ ] **Step 3: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: FAIL no `docker cp supabase/migrations/0198_sat_ordem_servico.sql` (arquivo não existe) — as partes 0186/0187/0190 continuam passando antes disso.

- [ ] **Step 4: Escrever a migração (parte A)**

Crie `supabase/migrations/0198_sat_ordem_servico.sql`:

```sql
-- =============================================================
-- 0198 — SAT: ORDEM DE SERVIÇO (entrega 1: OS + etapas + manutenção, relógio em garantia)
-- (spec docs/superpowers/specs/2026-11-26-sat-ordem-servico-design.md;
--  plano docs/superpowers/plans/2026-11-26-sat-ordem-servico-entrega-1.md)
--
-- A OS deixa de existir no Compels e passa a existir SÓ aqui: uma por relógio (`sat_entradas`), criada pelo banco
-- na entrada (gatilho `sat_entradas_ordem`) e, nesta migração, para as entradas que já existem (backfill, na ordem
-- em que chegaram). Nenhuma função da entrada (0187/0190) é reescrita: a OS se move por gatilhos.
--
--   - `sat_numeracao`: o último número usado por ano. A OS é `NNNN/AA`, CONTINUANDO a sequência do Compels.
--       ⚠️ SEMENTE: 2026 → 396 (última OS do Compels em 26/11/2026 = 0396/26). Se o Compels abrir mais OS até o
--       deploy, TROQUE o 396 abaixo ANTES de aplicar no RDS (o backfill numera na hora). Depois de aplicada, só
--       para frente: `update public.sat_numeracao set ultimo = <número> where ano = 2026;`.
--       Ano sem linha começa em 1 (o Compels não abre mais OS).
--   - `sat_defeitos`: a lista de defeitos. A carga dos 88 do Compels NÃO está aqui (a migração não fala com o
--     Compels): `node tools/compels/defeitos-sat.mjs > defeitos.sql` gera o SQL, aplicado com `psql -1 -f`.
--   - `sat_ordens`, `sat_ordem_defeitos`, `sat_ordem_pecas`, `sat_ordem_ns`, `sat_ordem_historico` (`seq` ordena a
--     linha do tempo: duas linhas no mesmo instante têm o mesmo `em`).
--   - Etapas desta entrega: recebido → nota_pendente | disponivel → em_manutencao → qualidade (para aqui).
--   - Tipo pela garantia da planilha (`sat__tipo_da_garantia`); recalculado enquanto a OS não passou da manutenção.
--   - RLS: leitura com sat.visualizar (`(select tem_permissao(...))`, InitPlan — padrão da 0096); SEM policy de
--     escrita: só pelas funções security definer. `sat_numeracao` não tem policy (só as funções leem).
--   - `*_nome`: a tabela `usuarios` não é legível por quem só tem SAT, então o nome fica guardado na linha.
--
-- Aditiva e idempotente (if not exists, create or replace, drop ... if exists, on conflict do nothing).
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0198_sat_ordem_servico.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (as telas novas leem as tabelas). O app antigo não as usa.
-- =============================================================

-- ---------- numeração ----------
create table if not exists public.sat_numeracao (
  ano    int primary key check (ano between 2000 and 2999),
  ultimo int not null check (ultimo >= 0)
);
-- ⚠️ SEMENTE (ver o cabeçalho): última OS do Compels em 2026.
insert into public.sat_numeracao (ano, ultimo) values (2026, 396) on conflict (ano) do nothing;

-- ---------- defeitos ----------
create table if not exists public.sat_defeitos (
  id             uuid primary key default gen_random_uuid(),
  -- código do defeito no Compels (sat/defeito/findAll); null = criado no ShopFloor
  codigo_compels text unique,
  descricao      text not null check (btrim(descricao) <> '' and length(descricao) <= 300),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ---------- a ordem de serviço ----------
create table if not exists public.sat_ordens (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique check (numero ~ '^[0-9]{4,}/[0-9]{2}$'),
  entrada_id    uuid unique references public.sat_entradas(id) on delete restrict,
  -- 'compels' = importada do histórico do Compels (entrega 6), sem entrada
  origem        text not null default 'shopfloor' check (origem in ('shopfloor', 'compels')),
  tipo          text,
  etapa         text not null,
  etapa_desde   timestamptz not null default now(),
  garantia      text not null default '',
  cliente       text not null default '',
  cnpj          text not null default '',
  produto       text not null default '',
  ns_atual      text not null default '',
  modelo        text,
  sequencia     text,
  ticket_os_id  uuid references public.sat_os(id) on delete set null,
  ticket_numero text not null default '',
  laudo         text not null default '' check (length(laudo) <= 4000),
  tecnico       uuid references public.usuarios(id) on delete set null,
  tecnico_nome  text not null default '',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint sat_ordens_tipo_valido check (tipo is null or tipo in ('em_garantia', 'fora_garantia', 'remanufatura', 'retorno_peca')),
  -- as entregas seguintes trocam esta lista (drop constraint sat_ordens_etapa_valida + add)
  constraint sat_ordens_etapa_valida check (etapa in ('recebido', 'nota_pendente', 'disponivel', 'em_manutencao', 'qualidade')),
  constraint sat_ordens_entrada check ((origem = 'shopfloor') = (entrada_id is not null))
);
create index if not exists sat_ordens_etapa on public.sat_ordens (etapa, etapa_desde);
create index if not exists sat_ordens_ns on public.sat_ordens (sequencia, modelo);
create index if not exists sat_ordens_ticket on public.sat_ordens (ticket_os_id);
create index if not exists sat_ordens_criado_em on public.sat_ordens (criado_em desc);
create index if not exists sat_ordens_produto on public.sat_ordens (upper(btrim(produto)));

create table if not exists public.sat_ordem_defeitos (
  id                uuid primary key default gen_random_uuid(),
  ordem_id          uuid not null references public.sat_ordens(id) on delete cascade,
  defeito_id        uuid not null references public.sat_defeitos(id) on delete restrict,
  -- o texto do defeito no momento do lançamento (a lista pode mudar depois)
  defeito_descricao text not null,
  origem            text not null check (origem in ('manutencao', 'qualidade')),
  solucao           text not null default '' check (length(solucao) <= 2000),
  usuario           uuid references public.usuarios(id) on delete set null,
  usuario_nome      text not null default '',
  em                timestamptz not null default now()
);
create index if not exists sat_ordem_defeitos_ordem on public.sat_ordem_defeitos (ordem_id, em);

create table if not exists public.sat_ordem_pecas (
  id           uuid primary key default gen_random_uuid(),
  ordem_id     uuid not null references public.sat_ordens(id) on delete cascade,
  -- código e descrição do item do Compels (a baixa continua pelo pedido de venda no Compels)
  codigo       text not null check (codigo ~ '^[A-Z0-9][A-Z0-9_.-]{0,59}$'),
  descricao    text not null default '' check (length(descricao) <= 300),
  quantidade   numeric(12, 3) not null check (quantidade > 0 and quantidade <= 9999),
  situacao     text not null default 'trocada' check (situacao in ('trocada', 'devolvida')),
  usuario      uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null default '',
  em           timestamptz not null default now()
);
create index if not exists sat_ordem_pecas_ordem on public.sat_ordem_pecas (ordem_id, em);
create index if not exists sat_ordem_pecas_codigo on public.sat_ordem_pecas (codigo);

create table if not exists public.sat_ordem_ns (
  id               uuid primary key default gen_random_uuid(),
  ordem_id         uuid not null references public.sat_ordens(id) on delete cascade,
  ns_antigo        text not null,
  modelo_antigo    text,
  sequencia_antigo text,
  ns_novo          text not null check (btrim(ns_novo) <> '' and length(ns_novo) <= 200),
  modelo_novo      text,
  sequencia_novo   text,
  usuario          uuid references public.usuarios(id) on delete set null,
  usuario_nome     text not null default '',
  em               timestamptz not null default now()
);
create index if not exists sat_ordem_ns_ordem on public.sat_ordem_ns (ordem_id, em);
create index if not exists sat_ordem_ns_antigo on public.sat_ordem_ns (sequencia_antigo, modelo_antigo);
create index if not exists sat_ordem_ns_novo on public.sat_ordem_ns (sequencia_novo, modelo_novo);

create table if not exists public.sat_ordem_historico (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  ordem_id     uuid not null references public.sat_ordens(id) on delete cascade,
  evento       text not null,
  etapa_de     text,
  etapa_para   text,
  dados        jsonb not null default '{}'::jsonb,
  usuario      uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null default '',
  em           timestamptz not null default now(),
  constraint sat_ordem_historico_evento_valido
    check (evento in ('etapa', 'correcao_etapa', 'garantia', 'defeito', 'peca', 'laudo', 'ns'))
);
create index if not exists sat_ordem_historico_ordem on public.sat_ordem_historico (ordem_id, seq);

-- ---------- RLS: só leitura, com sat.visualizar ----------
alter table public.sat_numeracao enable row level security;
alter table public.sat_defeitos enable row level security;
alter table public.sat_ordens enable row level security;
alter table public.sat_ordem_defeitos enable row level security;
alter table public.sat_ordem_pecas enable row level security;
alter table public.sat_ordem_ns enable row level security;
alter table public.sat_ordem_historico enable row level security;

drop policy if exists sat_defeitos_select on public.sat_defeitos;
create policy sat_defeitos_select on public.sat_defeitos
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordens_select on public.sat_ordens;
create policy sat_ordens_select on public.sat_ordens
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_defeitos_select on public.sat_ordem_defeitos;
create policy sat_ordem_defeitos_select on public.sat_ordem_defeitos
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_pecas_select on public.sat_ordem_pecas;
create policy sat_ordem_pecas_select on public.sat_ordem_pecas
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_ns_select on public.sat_ordem_ns;
create policy sat_ordem_ns_select on public.sat_ordem_ns
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_historico_select on public.sat_ordem_historico;
create policy sat_ordem_historico_select on public.sat_ordem_historico
  for select using ((select tem_permissao('sat', 'visualizar')));

revoke all on public.sat_numeracao, public.sat_defeitos, public.sat_ordens, public.sat_ordem_defeitos,
  public.sat_ordem_pecas, public.sat_ordem_ns, public.sat_ordem_historico from public, anon, authenticated;
grant select on public.sat_defeitos, public.sat_ordens, public.sat_ordem_defeitos, public.sat_ordem_pecas,
  public.sat_ordem_ns, public.sat_ordem_historico to authenticated;
grant select, insert, update, delete on public.sat_numeracao, public.sat_defeitos, public.sat_ordens,
  public.sat_ordem_defeitos, public.sat_ordem_pecas, public.sat_ordem_ns, public.sat_ordem_historico to service_role;

-- ---------- auxiliares (uso interno) ----------
-- Garantia da planilha → tipo da OS: 'em_garantia' | 'fora_garantia' | null (a definir). "SEM GARANTIA" antes de
-- "GARANTIA" (a palavra está nas duas).
create or replace function public.sat__tipo_da_garantia(p_garantia text)
returns text
language sql
immutable
set search_path = public
as $func$
  select case
           when g ~ '(SEM GARANTIA|FORA D[AE] GARANTIA|^\s*NAO\M)' then 'fora_garantia'
           when g ~ 'GARANTIA' then 'em_garantia'
           else null
         end
    from (select upper(translate(coalesce(p_garantia, ''),
                                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as g) x
$func$;
revoke all on function public.sat__tipo_da_garantia(text) from public, anon, authenticated;

-- O próximo número do ano: 'NNNN/AA'. O upsert trava a linha do ano (duas entradas ao mesmo tempo não repetem).
create or replace function public.sat__proximo_numero(p_ano int)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v_n int;
begin
  insert into sat_numeracao as s (ano, ultimo) values (p_ano, 1)
  on conflict (ano) do update set ultimo = s.ultimo + 1
  returning s.ultimo into v_n;
  return lpad(v_n::text, 4, '0') || '/' || lpad((p_ano % 100)::text, 2, '0');
end
$func$;
revoke all on function public.sat__proximo_numero(int) from public, anon, authenticated;

-- Um evento no histórico que não muda a etapa (defeito, peça, laudo, NS, garantia).
create or replace function public.sat__ordem_evento(p_ordem uuid, p_evento text, p_dados jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  insert into sat_ordem_historico (ordem_id, evento, dados, usuario, usuario_nome)
  values (p_ordem, p_evento, coalesce(p_dados, '{}'::jsonb), auth.uid(), sat__nome_usuario());
end
$func$;
revoke all on function public.sat__ordem_evento(uuid, text, jsonb) from public, anon, authenticated;

-- ---------- a OS de uma entrada (idempotente: devolve a que já existe) ----------
-- Nasce já na etapa da NF; o histórico grava "→ recebido" e "recebido → etapa" com o responsável da entrada.
create or replace function public.sat__criar_ordem(p_entrada uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_e     sat_entradas;
  v_n     sat_nfs;
  v_g     text;
  v_id    uuid;
  v_etapa text;
  v_num   text;
begin
  select o.id into v_id from sat_ordens o where o.entrada_id = p_entrada;
  if v_id is not null then return v_id; end if;
  select * into v_e from sat_entradas e where e.id = p_entrada;
  if not found then raise exception 'ENTRADA_NAO_ENCONTRADA'; end if;
  select * into v_n from sat_nfs n where n.id = v_e.nf_id;
  select coalesce(s.garantia, '') into v_g from sat_os s where s.id = v_e.os_id;
  v_g := coalesce(v_g, '');
  v_etapa := case when v_n.situacao = 'aprovada' then 'disponivel' else 'nota_pendente' end;
  v_num := sat__proximo_numero(extract(year from (v_e.criado_em at time zone 'America/Sao_Paulo'))::int);

  insert into sat_ordens (numero, entrada_id, tipo, etapa, etapa_desde, garantia, cliente, cnpj, produto, ns_atual,
                          modelo, sequencia, ticket_os_id, ticket_numero, criado_em)
  values (v_num, v_e.id, sat__tipo_da_garantia(v_g), v_etapa, v_e.criado_em, v_g, coalesce(v_n.empresa, ''),
          coalesce(v_n.cnpj, ''), btrim(coalesce(v_e.produto, '')), v_e.ns_escrito, v_e.modelo, v_e.sequencia,
          v_e.os_id, coalesce(v_e.os_numero, ''), v_e.criado_em)
  returning id into v_id;

  insert into sat_ordem_historico (ordem_id, evento, etapa_de, etapa_para, dados, usuario, usuario_nome, em)
  values (v_id, 'etapa', null, 'recebido', jsonb_build_object('nf', v_n.numero),
          v_e.responsavel, v_e.responsavel_nome, v_e.criado_em),
         (v_id, 'etapa', 'recebido', v_etapa, jsonb_build_object('nf', v_n.numero, 'nf_situacao', v_n.situacao),
          v_e.responsavel, v_e.responsavel_nome, v_e.criado_em);
  return v_id;
end
$func$;
revoke all on function public.sat__criar_ordem(uuid) from public, anon, authenticated;

create or replace function public.sat__ordem_na_entrada()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  perform sat__criar_ordem(new.id);
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_entrada() from public, anon, authenticated;

drop trigger if exists sat_entradas_ordem on public.sat_entradas;
create trigger sat_entradas_ordem after insert on public.sat_entradas
  for each row execute function public.sat__ordem_na_entrada();

-- ---------- backfill: as entradas que já existem, na ordem em que chegaram ----------
-- A linha do tempo delas começa no estado ATUAL da NF (a correção antiga da nota não vira etapa).
do $backfill$
declare
  r record;
begin
  for r in select e.id from public.sat_entradas e
            where not exists (select 1 from public.sat_ordens o where o.entrada_id = e.id)
            order by e.criado_em, e.id loop
    perform public.sat__criar_ordem(r.id);
  end loop;
end
$backfill$;

notify pgrst, 'reload schema';
```

- [ ] **Step 5: Rodar e ver passar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: termina com `SAT OK`; no meio, `NOTICE:  backfill: ok`, `tipo pela garantia: ok`, `OS criada na entrada: ok`, `RLS: ok`, `idempotência da 0198 ... ok`, `0198: 6 policies ... ok`, `0186, 0187, 0190 e 0198 do zero ... ok`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0198_sat_ordem_servico.sql supabase/tests/sat_ordem_test.sql supabase/tests/rodar-sat-test.sh
git commit -m "feat(sat): ordem de serviço nasce na entrada (0198: tabelas, numeração NNNN/AA, backfill)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migração 0198, parte B — etapa pela NF e garantia pelo ticket

**Files:**
- Modify: `supabase/migrations/0198_sat_ordem_servico.sql` (acrescentar ANTES da última linha `notify pgrst, 'reload schema';`)
- Modify: `supabase/tests/sat_ordem_test.sql` (acrescentar no fim)

**Interfaces:**
- Consumes: Tarefa 2 (`sat_ordens`, `sat_ordem_historico`, `sat__tipo_da_garantia`, `sat__ordem_evento`); `sat_corrigir_nf(uuid, text, uuid[], text)`, `sat_trocar_nf(uuid, jsonb)`, `sat_associar_os(uuid, uuid)`, `sat_sincronizar_planilha(jsonb)` (0187/0190).
- Produces:
  - `sat__ordem_mudar_etapa(p_ordem uuid, p_para text, p_evento text, p_dados jsonb) returns void` — trava a OS, grava etapa + `etapa_desde` + histórico; `ORDEM_NAO_ENCONTRADA`, `NADA_A_MUDAR`. Usada nas Tarefas 4 e 5.
  - `sat__ordem_recalcular_garantia(uuid) returns void`.
  - gatilhos `sat_nfs_ordem`, `sat_entradas_ticket`, `sat_os_garantia`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao fim de `supabase/tests/sat_ordem_test.sql`:

```sql
-- 5. NF corrigida/trocada move a OS: reprovada → aprovada leva nota_pendente → disponivel; aprovada → reprovada
--    devolve só quem ainda está disponível (a OS em manutenção não se mexe). Cliente/CNPJ seguem a nota trocada.
do $t$
declare
  v_nf   uuid;
  v_os   uuid;
  v_cfop uuid := (select id from sat_motivos_nf where texto = 'CFOP errado');
begin
  select e.nf_id, o.id into v_nf, v_os from sat_ordens o join sat_entradas e on e.id = o.entrada_id
   where o.modelo = '611' and o.sequencia = '1';

  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.aprovar_nf', false);
  perform sat_corrigir_nf(v_nf, 'aprovada', '{}'::uuid[], '');
  reset role;
  if (select etapa from sat_ordens where id = v_os) <> 'disponivel' then raise exception 'FALHOU: corrigir não liberou a OS'; end if;
  if not exists (select 1 from sat_ordem_historico h where h.ordem_id = v_os and h.evento = 'etapa'
                    and h.etapa_de = 'nota_pendente' and h.etapa_para = 'disponivel'
                    and h.dados->>'nf_situacao' = 'aprovada' and h.usuario_nome = 'Sérgio SAT') then
    raise exception 'FALHOU: histórico da liberação pela NF';
  end if;

  set local role authenticated;
  perform sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop], '');
  reset role;
  if (select etapa from sat_ordens where id = v_os) <> 'nota_pendente' then raise exception 'FALHOU: reprovar não voltou a OS'; end if;

  set local role authenticated;
  perform sat_trocar_nf(v_nf, jsonb_build_object('numero', 'NF-OS-2B', 'cnpj', '98765432000110', 'empresa', 'Cliente Novo',
                                                 'situacao', 'aprovada'));
  reset role;
  if (select etapa || '|' || cliente || '|' || cnpj from sat_ordens where id = v_os) <> 'disponivel|Cliente Novo|98.765.432/0001-10' then
    raise exception 'FALHOU: trocar NF (etapa/cliente/cnpj) %', (select row_to_json(o) from sat_ordens o where id = v_os);
  end if;

  -- em manutenção não volta
  update sat_ordens set etapa = 'em_manutencao' where id = v_os;
  set local role authenticated;
  perform sat_corrigir_nf(v_nf, 'reprovada', array[v_cfop], '');
  reset role;
  if (select etapa from sat_ordens where id = v_os) <> 'em_manutencao' then raise exception 'FALHOU: OS em manutenção voltou'; end if;
  update sat_ordens set etapa = 'nota_pendente' where id = v_os;
  raise notice 'etapa pela NF: ok';
end $t$;

-- 6. Garantia: a planilha muda a garantia do ticket → o tipo acompanha (com histórico 'garantia');
--    o técnico troca o ticket → idem; OS na qualidade não muda mais.
do $t$
declare v_os uuid; v_os2 uuid; v_ent uuid;
begin
  select o.id, o.entrada_id into v_os, v_ent from sat_ordens o where o.modelo = '610' and o.sequencia = '3';
  select o.id into v_os2 from sat_ordens o where o.modelo = '610' and o.sequencia = '1';

  -- o cron da planilha não tem usuário: sem auth.uid() o histórico diz 'planilha'
  perform set_config('teste.uid', '', false);
  set role service_role;
  perform sat_sincronizar_planilha($j$[
    {"chave": "T-OS-1", "numero": "900", "garantia": "SEM GARANTIA"},
    {"chave": "T-OS-3", "numero": "902", "data": "2026-11-03", "solucao": "Envio ao SAT", "garantia": "GARANTIA",
     "itens": [{"chave": "o3", "ns": "610-3", "modelo": "610", "sequencia": "3"}]}
  ]$j$);
  reset role;
  if (select tipo from sat_ordens where id = v_os2) is distinct from 'fora_garantia' then
    raise exception 'FALHOU: garantia da planilha não mudou o tipo';
  end if;
  if not exists (select 1 from sat_ordem_historico h where h.ordem_id = v_os2 and h.evento = 'garantia'
                    and h.dados->>'tipo_de' = 'em_garantia' and h.dados->>'tipo_para' = 'fora_garantia'
                    and h.usuario_nome = 'planilha') then
    raise exception 'FALHOU: histórico da garantia pela planilha';
  end if;
  perform set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

  set local role authenticated;
  perform set_config('teste.perms', 'sat.visualizar,sat.associar_os', false);
  perform sat_associar_os(v_ent, (select id from sat_os where chave = 'T-OS-3'));
  reset role;
  if (select tipo || '|' || ticket_numero || '|' || garantia from sat_ordens where id = v_os) <> 'em_garantia|902|GARANTIA' then
    raise exception 'FALHOU: trocar o ticket não trouxe a garantia';
  end if;

  update sat_ordens set etapa = 'qualidade' where id = v_os;
  set role service_role;
  perform sat_sincronizar_planilha($j$[{"chave": "T-OS-3", "numero": "902", "garantia": "SEM GARANTIA"}]$j$);
  reset role;
  if (select tipo from sat_ordens where id = v_os) <> 'em_garantia' then raise exception 'FALHOU: OS na qualidade mudou de tipo'; end if;
  update sat_ordens set etapa = 'disponivel' where id = v_os;
  set role service_role;
  perform sat_sincronizar_planilha($j$[{"chave": "T-OS-3", "numero": "902", "garantia": "GARANTIA"}]$j$);
  reset role;
  raise notice 'garantia pelo ticket: ok';
end $t$;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: FAIL com `FALHOU: corrigir não liberou a OS`.

- [ ] **Step 3: Implementar**

Acrescente na `0198_sat_ordem_servico.sql`, ANTES da linha `notify pgrst, 'reload schema';`:

```sql
-- ---------- mudar a etapa (uso interno): trava a OS, grava etapa e histórico ----------
create or replace function public.sat__ordem_mudar_etapa(p_ordem uuid, p_para text, p_evento text, p_dados jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_de text;
begin
  select o.etapa into v_de from sat_ordens o where o.id = p_ordem for update;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  if v_de = p_para then raise exception 'NADA_A_MUDAR'; end if;
  update sat_ordens set etapa = p_para, etapa_desde = now(), atualizado_em = now() where id = p_ordem;
  insert into sat_ordem_historico (ordem_id, evento, etapa_de, etapa_para, dados, usuario, usuario_nome)
  values (p_ordem, p_evento, v_de, p_para, coalesce(p_dados, '{}'::jsonb), auth.uid(), sat__nome_usuario());
end
$func$;
revoke all on function public.sat__ordem_mudar_etapa(uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------- a NF muda (sat_corrigir_nf / sat_trocar_nf, que já existem) → a OS acompanha ----------
-- Aprovada: nota_pendente → disponivel. Reprovada: disponivel → nota_pendente. Quem já abriu a manutenção fica.
-- Empresa/CNPJ da nota trocada vão para a OS (em qualquer etapa).
create or replace function public.sat__ordem_na_mudanca_nf()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  r       record;
  v_de    text;
  v_para  text;
  v_dados jsonb;
begin
  update sat_ordens o set cliente = new.empresa, cnpj = new.cnpj, atualizado_em = now()
    from sat_entradas e
   where e.nf_id = new.id and o.entrada_id = e.id
     and (o.cliente, o.cnpj) is distinct from (new.empresa, new.cnpj);

  if new.situacao is not distinct from old.situacao then return null; end if;
  v_de   := case when new.situacao = 'aprovada' then 'nota_pendente' else 'disponivel' end;
  v_para := case when new.situacao = 'aprovada' then 'disponivel' else 'nota_pendente' end;
  v_dados := jsonb_build_object('nf', new.numero, 'nf_de', old.numero, 'nf_situacao', new.situacao,
                                'motivos', to_jsonb(new.motivos));
  for r in select o.id from sat_ordens o join sat_entradas e on e.id = o.entrada_id
            where e.nf_id = new.id and o.etapa = v_de
            order by o.criado_em, o.id loop
    perform sat__ordem_mudar_etapa(r.id, v_para, 'etapa', v_dados);
  end loop;
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_mudanca_nf() from public, anon, authenticated;

drop trigger if exists sat_nfs_ordem on public.sat_nfs;
create trigger sat_nfs_ordem after update of situacao, empresa, cnpj, numero on public.sat_nfs
  for each row execute function public.sat__ordem_na_mudanca_nf();

-- ---------- garantia/ticket: recalcula enquanto a OS não passou da manutenção ----------
-- Remanufatura e retorno de peça (escolhidos à mão, entrega 4) não voltam a ser garantia.
create or replace function public.sat__ordem_recalcular_garantia(p_ordem uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o        sat_ordens;
  v_ticket   uuid;
  v_num      text;
  v_garantia text;
  v_tipo     text;
begin
  select * into v_o from sat_ordens o where o.id = p_ordem for update;
  if not found or v_o.etapa not in ('recebido', 'nota_pendente', 'disponivel', 'em_manutencao') then return; end if;
  select e.os_id, coalesce(e.os_numero, ''), coalesce(s.garantia, '')
    into v_ticket, v_num, v_garantia
    from sat_entradas e left join sat_os s on s.id = e.os_id
   where e.id = v_o.entrada_id;
  v_garantia := coalesce(v_garantia, '');
  v_num := coalesce(v_num, '');
  v_tipo := case when v_o.tipo in ('remanufatura', 'retorno_peca') then v_o.tipo else sat__tipo_da_garantia(v_garantia) end;
  if (v_ticket, v_num, v_garantia, v_tipo) is not distinct from
     (v_o.ticket_os_id, v_o.ticket_numero, v_o.garantia, v_o.tipo) then
    return;
  end if;
  update sat_ordens set ticket_os_id = v_ticket, ticket_numero = v_num, garantia = v_garantia, tipo = v_tipo,
                        atualizado_em = now()
   where id = p_ordem;
  insert into sat_ordem_historico (ordem_id, evento, dados, usuario, usuario_nome)
  values (p_ordem, 'garantia',
          jsonb_build_object('ticket_de', v_o.ticket_numero, 'ticket_para', v_num,
                             'garantia_de', v_o.garantia, 'garantia_para', v_garantia,
                             'tipo_de', v_o.tipo, 'tipo_para', v_tipo),
          auth.uid(), coalesce(nullif(sat__nome_usuario(), ''), 'planilha'));
end
$func$;
revoke all on function public.sat__ordem_recalcular_garantia(uuid) from public, anon, authenticated;

create or replace function public.sat__ordem_na_troca_de_ticket()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_id uuid;
begin
  select o.id into v_id from sat_ordens o where o.entrada_id = new.id;
  if v_id is not null then perform sat__ordem_recalcular_garantia(v_id); end if;
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_troca_de_ticket() from public, anon, authenticated;

drop trigger if exists sat_entradas_ticket on public.sat_entradas;
create trigger sat_entradas_ticket after update of os_id on public.sat_entradas
  for each row when (old.os_id is distinct from new.os_id)
  execute function public.sat__ordem_na_troca_de_ticket();

create or replace function public.sat__ordem_na_garantia_da_planilha()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  r record;
begin
  for r in select o.id from sat_ordens o where o.ticket_os_id = new.id loop
    perform sat__ordem_recalcular_garantia(r.id);
  end loop;
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_garantia_da_planilha() from public, anon, authenticated;

drop trigger if exists sat_os_garantia on public.sat_os;
create trigger sat_os_garantia after update of garantia on public.sat_os
  for each row when (old.garantia is distinct from new.garantia)
  execute function public.sat__ordem_na_garantia_da_planilha();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: `NOTICE:  etapa pela NF: ok`, `NOTICE:  garantia pelo ticket: ok` e no fim `SAT OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0198_sat_ordem_servico.sql supabase/tests/sat_ordem_test.sql
git commit -m "feat(sat): a OS segue a NF (nota pendente/disponível) e a garantia do ticket (0198)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Migração 0198, parte C — funções da manutenção

**Files:**
- Modify: `supabase/migrations/0198_sat_ordem_servico.sql` (acrescentar ANTES da última linha `notify pgrst, 'reload schema';`)
- Modify: `supabase/tests/sat_ordem_test.sql` (acrescentar no fim)

**Interfaces:**
- Consumes: Tarefas 2 e 3 (`sat__ordem_mudar_etapa`, `sat__ordem_evento`, tabelas).
- Produces (chamadas pelo app via `supabase.rpc`, todas `security definer`, exigem `sat.manutencao`, devolvem os códigos de erro em `raise exception`):
  - `sat_ordem_iniciar_manutencao(p_ordem uuid) returns jsonb` — `disponivel → em_manutencao`; técnico = usuário logado.
  - `sat_ordem_defeito_adicionar(p_ordem uuid, p_defeito uuid, p_solucao text) returns uuid`
  - `sat_ordem_defeito_remover(p_item uuid) returns void`
  - `sat_ordem_peca_adicionar(p_ordem uuid, p_codigo text, p_descricao text, p_quantidade numeric) returns uuid`
  - `sat_ordem_peca_remover(p_item uuid) returns void`
  - `sat_ordem_laudo_salvar(p_ordem uuid, p_laudo text) returns void`
  - `sat_ordem_trocar_ns(p_ordem uuid, p jsonb) returns jsonb` — `p = {ns, modelo, sequencia}` (par já normalizado pelo app); devolve `{ns_antigo, ns_novo}`.
  - `sat_ordem_enviar_qualidade(p_ordem uuid) returns jsonb` — `em_manutencao → qualidade`, só `em_garantia`, com 1+ defeito e laudo.
  - Códigos novos: `ORDEM_NAO_ENCONTRADA`, `ETAPA_NAO_PERMITE`, `DEFEITO_INVALIDO`, `DEFEITO_REPETIDO`, `SOLUCAO_OBRIGATORIA`, `TEXTO_LONGO`, `CODIGO_INVALIDO`, `QUANTIDADE_INVALIDA`, `PECA_REPETIDA`, `ITEM_NAO_ENCONTRADO`, `SEM_DEFEITO`, `SEM_LAUDO`, `FORA_DA_GARANTIA`, `GARANTIA_INDEFINIDA` (e os que já existiam: `SEM_PERMISSAO`, `NS_OBRIGATORIO`, `NADA_A_MUDAR`).

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao fim de `supabase/tests/sat_ordem_test.sql`:

```sql
-- 7. Manutenção: permissão, etapa, defeitos, peças, laudo, troca de NS e envio para a qualidade.
insert into sat_defeitos (codigo_compels, descricao) values ('T1', 'Não liga'), ('T2', 'Display apagado');
insert into sat_defeitos (codigo_compels, descricao, ativo) values ('T3', 'Defeito antigo', false);

do $t$
declare
  v_os    uuid := (select id from sat_ordens where modelo = '610' and sequencia = '3');   -- em garantia, disponível
  v_fora  uuid := (select id from sat_ordens where modelo = '610' and sequencia = '1');   -- fora da garantia
  v_pend  uuid := (select id from sat_ordens where modelo = '611' and sequencia = '1');   -- nota pendente
  v_d1    uuid := (select id from sat_defeitos where codigo_compels = 'T1');
  v_d3    uuid := (select id from sat_defeitos where codigo_compels = 'T3');
  v_item  uuid;
  v_peca  uuid;
  r       jsonb;
begin
  set local role authenticated;

  -- sem sat.manutencao
  perform set_config('teste.perms', 'sat.visualizar,sat.administrar', false);
  begin perform sat_ordem_iniciar_manutencao(v_os); raise exception 'FALHOU: iniciar sem permissão';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao', false);
  -- nota pendente não abre manutenção; OS inexistente
  begin perform sat_ordem_iniciar_manutencao(v_pend); raise exception 'FALHOU: iniciou com nota pendente';
  exception when raise_exception then if sqlerrm <> 'ETAPA_NAO_PERMITE' then raise; end if; end;
  begin perform sat_ordem_iniciar_manutencao(gen_random_uuid()); raise exception 'FALHOU: iniciou OS inexistente';
  exception when raise_exception then if sqlerrm <> 'ORDEM_NAO_ENCONTRADA' then raise; end if; end;
  -- disponível ainda não aceita defeito
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, 'troca'); raise exception 'FALHOU: defeito antes de iniciar';
  exception when raise_exception then if sqlerrm <> 'ETAPA_NAO_PERMITE' then raise; end if; end;

  r := sat_ordem_iniciar_manutencao(v_os);
  if (select etapa || '|' || tecnico_nome from sat_ordens where id = v_os) <> 'em_manutencao|Sérgio SAT' then
    raise exception 'FALHOU: iniciar manutenção %', r;
  end if;

  -- defeitos
  begin perform sat_ordem_defeito_adicionar(v_os, v_d3, 'x'); raise exception 'FALHOU: defeito inativo';
  exception when raise_exception then if sqlerrm <> 'DEFEITO_INVALIDO' then raise; end if; end;
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, '   '); raise exception 'FALHOU: solução vazia';
  exception when raise_exception then if sqlerrm <> 'SOLUCAO_OBRIGATORIA' then raise; end if; end;
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, repeat('x', 2001)); raise exception 'FALHOU: solução longa';
  exception when raise_exception then if sqlerrm <> 'TEXTO_LONGO' then raise; end if; end;
  v_item := sat_ordem_defeito_adicionar(v_os, v_d1, '  Trocada a fonte  ');
  begin perform sat_ordem_defeito_adicionar(v_os, v_d1, 'de novo'); raise exception 'FALHOU: defeito repetido';
  exception when raise_exception then if sqlerrm <> 'DEFEITO_REPETIDO' then raise; end if; end;
  if (select defeito_descricao || '|' || solucao || '|' || origem from sat_ordem_defeitos where id = v_item)
     <> 'Não liga|Trocada a fonte|manutencao' then
    raise exception 'FALHOU: defeito gravado errado';
  end if;
  perform sat_ordem_defeito_remover(v_item);
  if exists (select 1 from sat_ordem_defeitos where id = v_item) then raise exception 'FALHOU: remover defeito'; end if;
  v_item := sat_ordem_defeito_adicionar(v_os, v_d1, 'Trocada a fonte');

  -- peças
  begin perform sat_ordem_peca_adicionar(v_os, 'prt 1', 'x', 1); raise exception 'FALHOU: código com espaço';
  exception when raise_exception then if sqlerrm <> 'CODIGO_INVALIDO' then raise; end if; end;
  begin perform sat_ordem_peca_adicionar(v_os, 'PMOE74', 'x', 0); raise exception 'FALHOU: quantidade zero';
  exception when raise_exception then if sqlerrm <> 'QUANTIDADE_INVALIDA' then raise; end if; end;
  v_peca := sat_ordem_peca_adicionar(v_os, ' pmoe74 ', ' Módulo Camabio com cabo ', 1);
  begin perform sat_ordem_peca_adicionar(v_os, 'PMOE74', '', 2); raise exception 'FALHOU: peça repetida';
  exception when raise_exception then if sqlerrm <> 'PECA_REPETIDA' then raise; end if; end;
  if (select codigo || '|' || descricao || '|' || quantidade::text || '|' || situacao from sat_ordem_pecas where id = v_peca)
     <> 'PMOE74|Módulo Camabio com cabo|1.000|trocada' then
    raise exception 'FALHOU: peça gravada errada';
  end if;
  perform sat_ordem_peca_adicionar(v_os, 'PRT706', 'Placa', 1);
  perform sat_ordem_peca_remover((select id from sat_ordem_pecas where ordem_id = v_os and codigo = 'PRT706'));
  if exists (select 1 from sat_ordem_pecas where ordem_id = v_os and codigo = 'PRT706') then raise exception 'FALHOU: remover peça'; end if;
  begin perform sat_ordem_peca_remover(gen_random_uuid()); raise exception 'FALHOU: remover peça inexistente';
  exception when raise_exception then if sqlerrm <> 'ITEM_NAO_ENCONTRADO' then raise; end if; end;

  -- sem laudo não vai para a qualidade
  begin perform sat_ordem_enviar_qualidade(v_os); raise exception 'FALHOU: enviou sem laudo';
  exception when raise_exception then if sqlerrm <> 'SEM_LAUDO' then raise; end if; end;
  begin perform sat_ordem_laudo_salvar(v_os, repeat('x', 4001)); raise exception 'FALHOU: laudo longo';
  exception when raise_exception then if sqlerrm <> 'TEXTO_LONGO' then raise; end if; end;
  perform sat_ordem_laudo_salvar(v_os, '  Fonte queimada; trocado o módulo.  ');
  perform sat_ordem_laudo_salvar(v_os, 'Fonte queimada; trocado o módulo.');   -- igual: não grava histórico de novo
  if (select laudo from sat_ordens where id = v_os) <> 'Fonte queimada; trocado o módulo.' then raise exception 'FALHOU: laudo'; end if;
  if (select count(*) from sat_ordem_historico where ordem_id = v_os and evento = 'laudo') <> 1 then
    raise exception 'FALHOU: laudo igual gravou histórico';
  end if;

  -- troca de NS
  begin perform sat_ordem_trocar_ns(v_os, '{"ns": "  "}'::jsonb); raise exception 'FALHOU: NS vazio';
  exception when raise_exception then if sqlerrm <> 'NS_OBRIGATORIO' then raise; end if; end;
  begin perform sat_ordem_trocar_ns(v_os, '{"ns": "610-3", "modelo": "610", "sequencia": "3"}'::jsonb);
    raise exception 'FALHOU: troca para o mesmo NS';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;
  r := sat_ordem_trocar_ns(v_os, '{"ns": "610-99", "modelo": "610", "sequencia": "99"}'::jsonb);
  if (select ns_atual || '|' || modelo || '|' || sequencia from sat_ordens where id = v_os) <> '610-99|610|99'
     or not exists (select 1 from sat_ordem_ns where ordem_id = v_os and ns_antigo = '610-3' and sequencia_antigo = '3'
                      and ns_novo = '610-99' and sequencia_novo = '99') then
    raise exception 'FALHOU: troca de NS %', r;
  end if;

  -- fora da garantia não vai para a qualidade nesta entrega
  reset role;
  update sat_ordens set etapa = 'em_manutencao' where id = v_fora;
  insert into sat_ordem_defeitos (ordem_id, defeito_id, defeito_descricao, origem, solucao)
  values (v_fora, v_d1, 'Não liga', 'manutencao', 'x');
  update sat_ordens set laudo = 'ok' where id = v_fora;
  set local role authenticated;
  begin perform sat_ordem_enviar_qualidade(v_fora); raise exception 'FALHOU: fora da garantia foi para a qualidade';
  exception when raise_exception then if sqlerrm <> 'FORA_DA_GARANTIA' then raise; end if; end;
  reset role;
  update sat_ordens set tipo = null where id = v_fora;
  set local role authenticated;
  begin perform sat_ordem_enviar_qualidade(v_fora); raise exception 'FALHOU: garantia indefinida foi para a qualidade';
  exception when raise_exception then if sqlerrm <> 'GARANTIA_INDEFINIDA' then raise; end if; end;
  reset role;
  update sat_ordens set tipo = 'em_garantia' where id = v_fora;
  delete from sat_ordem_defeitos where ordem_id = v_fora;
  set local role authenticated;
  begin perform sat_ordem_enviar_qualidade(v_fora); raise exception 'FALHOU: enviou sem defeito';
  exception when raise_exception then if sqlerrm <> 'SEM_DEFEITO' then raise; end if; end;

  -- em garantia, com defeito e laudo: vai
  r := sat_ordem_enviar_qualidade(v_os);
  if (select etapa from sat_ordens where id = v_os) <> 'qualidade' then raise exception 'FALHOU: não foi para a qualidade %', r; end if;
  begin perform sat_ordem_peca_adicionar(v_os, 'PMOE12', 'Kit sensor', 1); raise exception 'FALHOU: peça depois da qualidade';
  exception when raise_exception then if sqlerrm <> 'ETAPA_NAO_PERMITE' then raise; end if; end;
  reset role;

  -- histórico: iniciar, defeitos (+/-), peças (+/-), laudo, NS e o envio
  if (select string_agg(evento || coalesce(':' || etapa_para, ''), ',' order by seq)
        from sat_ordem_historico where ordem_id = v_os and seq >= (select min(seq) from sat_ordem_historico h2
                                                                     where h2.ordem_id = v_os and h2.etapa_para = 'em_manutencao'))
     <> 'etapa:em_manutencao,defeito,defeito,defeito,peca,peca,peca,laudo,ns,etapa:qualidade' then
    raise exception 'FALHOU: eventos da manutenção %', (select string_agg(evento, ',' order by seq) from sat_ordem_historico where ordem_id = v_os);
  end if;
  update sat_ordens set etapa = 'disponivel', tipo = 'fora_garantia', laudo = '' where id = v_fora;
  raise notice 'manutenção: ok';
end $t$;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: FAIL com `function sat_ordem_iniciar_manutencao(uuid) does not exist`.

- [ ] **Step 3: Implementar**

Acrescente na `0198_sat_ordem_servico.sql`, ANTES da linha `notify pgrst, 'reload schema';`:

```sql
-- ---------- manutenção (sat.manutencao) ----------
-- A OS travada e conferida para lançar na manutenção (uso interno): permissão, existe, está em manutenção.
create or replace function public.sat__ordem_para_manutencao(p_ordem uuid)
returns sat_ordens
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o sat_ordens;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_o from sat_ordens o where o.id = p_ordem for update;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  if v_o.etapa <> 'em_manutencao' then raise exception 'ETAPA_NAO_PERMITE'; end if;
  return v_o;
end
$func$;
revoke all on function public.sat__ordem_para_manutencao(uuid) from public, anon, authenticated;

-- Disponível → em manutenção; o técnico é quem abriu.
create or replace function public.sat_ordem_iniciar_manutencao(p_ordem uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o    sat_ordens;
  v_nome text;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_o from sat_ordens o where o.id = p_ordem for update;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  if v_o.etapa <> 'disponivel' then raise exception 'ETAPA_NAO_PERMITE'; end if;
  v_nome := sat__nome_usuario();
  update sat_ordens set tecnico = auth.uid(), tecnico_nome = v_nome where id = p_ordem;
  perform sat__ordem_mudar_etapa(p_ordem, 'em_manutencao', 'etapa', jsonb_build_object('tecnico', v_nome));
  return jsonb_build_object('numero', v_o.numero, 'etapa', 'em_manutencao');
end
$func$;
revoke all on function public.sat_ordem_iniciar_manutencao(uuid) from public, anon;
grant execute on function public.sat_ordem_iniciar_manutencao(uuid) to authenticated, service_role;

-- Defeito da lista (ativo) + solução em texto. O mesmo defeito não entra duas vezes na manutenção da OS.
create or replace function public.sat_ordem_defeito_adicionar(p_ordem uuid, p_defeito uuid, p_solucao text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o    sat_ordens;
  v_desc text;
  v_sol  text := btrim(coalesce(p_solucao, ''));
  v_id   uuid;
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  select d.descricao into v_desc from sat_defeitos d where d.id = p_defeito and d.ativo;
  if v_desc is null then raise exception 'DEFEITO_INVALIDO'; end if;
  if v_sol = '' then raise exception 'SOLUCAO_OBRIGATORIA'; end if;
  if length(v_sol) > 2000 then raise exception 'TEXTO_LONGO'; end if;
  if exists (select 1 from sat_ordem_defeitos x
              where x.ordem_id = p_ordem and x.defeito_id = p_defeito and x.origem = 'manutencao') then
    raise exception 'DEFEITO_REPETIDO';
  end if;
  insert into sat_ordem_defeitos (ordem_id, defeito_id, defeito_descricao, origem, solucao, usuario, usuario_nome)
  values (p_ordem, p_defeito, v_desc, 'manutencao', v_sol, auth.uid(), sat__nome_usuario())
  returning id into v_id;
  perform sat__ordem_evento(p_ordem, 'defeito', jsonb_build_object('acao', 'incluido', 'defeito', v_desc, 'solucao', v_sol));
  return v_id;
end
$func$;
revoke all on function public.sat_ordem_defeito_adicionar(uuid, uuid, text) from public, anon;
grant execute on function public.sat_ordem_defeito_adicionar(uuid, uuid, text) to authenticated, service_role;

create or replace function public.sat_ordem_defeito_remover(p_item uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_x sat_ordem_defeitos;
  v_o sat_ordens;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_x from sat_ordem_defeitos x where x.id = p_item and x.origem = 'manutencao';
  if not found then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  v_o := sat__ordem_para_manutencao(v_x.ordem_id);
  delete from sat_ordem_defeitos where id = p_item;
  perform sat__ordem_evento(v_x.ordem_id, 'defeito',
    jsonb_build_object('acao', 'removido', 'defeito', v_x.defeito_descricao, 'solucao', v_x.solucao));
end
$func$;
revoke all on function public.sat_ordem_defeito_remover(uuid) from public, anon;
grant execute on function public.sat_ordem_defeito_remover(uuid) to authenticated, service_role;

-- Peça trocada: código do item do Compels (maiúsculo), descrição e quantidade. Mesmo código não entra duas vezes
-- (remove e lança de novo com a quantidade certa).
create or replace function public.sat_ordem_peca_adicionar(p_ordem uuid, p_codigo text, p_descricao text, p_quantidade numeric)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o      sat_ordens;
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_desc   text := btrim(coalesce(p_descricao, ''));
  v_id     uuid;
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if v_codigo !~ '^[A-Z0-9][A-Z0-9_.-]{0,59}$' then raise exception 'CODIGO_INVALIDO'; end if;
  if length(v_desc) > 300 then raise exception 'TEXTO_LONGO'; end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > 9999 then raise exception 'QUANTIDADE_INVALIDA'; end if;
  if exists (select 1 from sat_ordem_pecas x where x.ordem_id = p_ordem and x.codigo = v_codigo and x.situacao = 'trocada') then
    raise exception 'PECA_REPETIDA';
  end if;
  insert into sat_ordem_pecas (ordem_id, codigo, descricao, quantidade, usuario, usuario_nome)
  values (p_ordem, v_codigo, v_desc, p_quantidade, auth.uid(), sat__nome_usuario())
  returning id into v_id;
  perform sat__ordem_evento(p_ordem, 'peca',
    jsonb_build_object('acao', 'incluida', 'codigo', v_codigo, 'descricao', v_desc, 'quantidade', p_quantidade));
  return v_id;
end
$func$;
revoke all on function public.sat_ordem_peca_adicionar(uuid, text, text, numeric) from public, anon;
grant execute on function public.sat_ordem_peca_adicionar(uuid, text, text, numeric) to authenticated, service_role;

create or replace function public.sat_ordem_peca_remover(p_item uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_x sat_ordem_pecas;
  v_o sat_ordens;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_x from sat_ordem_pecas x where x.id = p_item;
  if not found then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  v_o := sat__ordem_para_manutencao(v_x.ordem_id);
  delete from sat_ordem_pecas where id = p_item;
  perform sat__ordem_evento(v_x.ordem_id, 'peca',
    jsonb_build_object('acao', 'removida', 'codigo', v_x.codigo, 'descricao', v_x.descricao, 'quantidade', v_x.quantidade));
end
$func$;
revoke all on function public.sat_ordem_peca_remover(uuid) from public, anon;
grant execute on function public.sat_ordem_peca_remover(uuid) to authenticated, service_role;

-- Laudo (até 4000). Texto igual ao gravado não grava nada.
create or replace function public.sat_ordem_laudo_salvar(p_ordem uuid, p_laudo text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o     sat_ordens;
  v_laudo text := btrim(coalesce(p_laudo, ''));
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if length(v_laudo) > 4000 then raise exception 'TEXTO_LONGO'; end if;
  if v_laudo = v_o.laudo then return; end if;
  update sat_ordens set laudo = v_laudo, atualizado_em = now() where id = p_ordem;
  perform sat__ordem_evento(p_ordem, 'laudo', jsonb_build_object('laudo', v_laudo));
end
$func$;
revoke all on function public.sat_ordem_laudo_salvar(uuid, text) from public, anon;
grant execute on function public.sat_ordem_laudo_salvar(uuid, text) to authenticated, service_role;

-- Troca de NS: p = {ns, modelo, sequencia} (o par já normalizado pelo app, como na entrada). O antigo fica em
-- sat_ordem_ns e a busca acha a OS pelos dois.
create or replace function public.sat_ordem_trocar_ns(p_ordem uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o   sat_ordens;
  v_ns  text := btrim(coalesce(p->>'ns', ''));
  v_mod text := nullif(btrim(coalesce(p->>'modelo', '')), '');
  v_seq text := nullif(btrim(coalesce(p->>'sequencia', '')), '');
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if v_ns = '' then raise exception 'NS_OBRIGATORIO'; end if;
  if length(v_ns) > 200 then raise exception 'TEXTO_LONGO'; end if;
  if upper(v_ns) = upper(v_o.ns_atual)
     or (v_seq is not null and v_seq = v_o.sequencia and v_mod is not distinct from v_o.modelo) then
    raise exception 'NADA_A_MUDAR';
  end if;
  insert into sat_ordem_ns (ordem_id, ns_antigo, modelo_antigo, sequencia_antigo, ns_novo, modelo_novo, sequencia_novo,
                            usuario, usuario_nome)
  values (p_ordem, v_o.ns_atual, v_o.modelo, v_o.sequencia, v_ns, v_mod, v_seq, auth.uid(), sat__nome_usuario());
  update sat_ordens set ns_atual = v_ns, modelo = v_mod, sequencia = v_seq, atualizado_em = now() where id = p_ordem;
  perform sat__ordem_evento(p_ordem, 'ns', jsonb_build_object('ns_antigo', v_o.ns_atual, 'ns_novo', v_ns));
  return jsonb_build_object('ns_antigo', v_o.ns_atual, 'ns_novo', v_ns);
end
$func$;
revoke all on function public.sat_ordem_trocar_ns(uuid, jsonb) from public, anon;
grant execute on function public.sat_ordem_trocar_ns(uuid, jsonb) to authenticated, service_role;

-- Em manutenção → qualidade. Nesta entrega só EM GARANTIA (fora da garantia passa pelo orçamento, entrega 2).
create or replace function public.sat_ordem_enviar_qualidade(p_ordem uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o        sat_ordens;
  v_defeitos int;
  v_pecas    int;
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if v_o.tipo is null then raise exception 'GARANTIA_INDEFINIDA'; end if;
  if v_o.tipo <> 'em_garantia' then raise exception 'FORA_DA_GARANTIA'; end if;
  select count(*) into v_defeitos from sat_ordem_defeitos x where x.ordem_id = p_ordem and x.origem = 'manutencao';
  if v_defeitos = 0 then raise exception 'SEM_DEFEITO'; end if;
  if btrim(v_o.laudo) = '' then raise exception 'SEM_LAUDO'; end if;
  select count(*) into v_pecas from sat_ordem_pecas x where x.ordem_id = p_ordem and x.situacao = 'trocada';
  perform sat__ordem_mudar_etapa(p_ordem, 'qualidade', 'etapa',
    jsonb_build_object('defeitos', v_defeitos, 'pecas', v_pecas));
  return jsonb_build_object('numero', v_o.numero, 'etapa', 'qualidade');
end
$func$;
revoke all on function public.sat_ordem_enviar_qualidade(uuid) from public, anon;
grant execute on function public.sat_ordem_enviar_qualidade(uuid) to authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: `NOTICE:  manutenção: ok` e no fim `SAT OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0198_sat_ordem_servico.sql supabase/tests/sat_ordem_test.sql
git commit -m "feat(sat): funções da manutenção da OS (defeitos, peças, laudo, troca de NS, qualidade) (0198)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Migração 0198, parte D — correção de etapa, busca por NS, leituras de apoio e cache do Compels

**Files:**
- Modify: `supabase/migrations/0198_sat_ordem_servico.sql` (acrescentar ANTES da última linha `notify pgrst, 'reload schema';`)
- Modify: `supabase/tests/sat_ordem_test.sql` (acrescentar no fim)
- Modify: `supabase/tests/rodar-sat-test.sh` (a conta de policies da 0198 passa a 7)

**Interfaces:**
- Consumes: Tarefas 2–4.
- Produces:
  - `sat_ordem_corrigir_etapa(p_ordem uuid, p_etapa text, p_motivo text) returns jsonb` — `sat.administrar`; qualquer etapa válida; motivo 3–500; histórico `correcao_etapa` com `{motivo}`. Códigos: `ETAPA_INVALIDA`, `MOTIVO_CORRECAO_OBRIGATORIO`, `NADA_A_MUDAR`.
  - `sat_ordens_do_ns(p_modelo text, p_sequencia text) returns setof uuid` — invoker (respeita o RLS): OS pelo NS atual, antigo ou novo.
  - `sat_pecas_mais_usadas(p_produto text, p_limite int) returns table (codigo text, descricao text, usos bigint)` — invoker.
  - `sat_kits_conhecidos() returns table (codigo text, descricao text)` — invoker: `PMOE*` já usados em OS.
  - tabela `sat_compels_cache (chave, dados, lido_em)` (leitura `sat.visualizar`) e `sat_compels_cache_gravar(p_chave text, p_dados jsonb) returns void` (`sat.manutencao`; chave `estrutura:<código>` ou `pais:<itemId>`; até 2 MB). Códigos: `CHAVE_INVALIDA`, `CACHE_GRANDE`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao fim de `supabase/tests/sat_ordem_test.sql`:

```sql
-- 8. Correção de etapa (sat.administrar), busca por NS (antigo e novo), peças mais usadas, kits e cache.
do $t$
declare
  v_os  uuid := (select id from sat_ordens where ns_atual = '610-99');   -- na qualidade, trocou 610-3 → 610-99
  v_ids uuid[];
  r     jsonb;
begin
  set local role authenticated;

  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao', false);
  begin perform sat_ordem_corrigir_etapa(v_os, 'em_manutencao', 'voltou da qualidade'); raise exception 'FALHOU: corrigir sem administrar';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;

  perform set_config('teste.perms', 'sat.visualizar,sat.administrar', false);
  begin perform sat_ordem_corrigir_etapa(v_os, 'expedida', 'x x x'); raise exception 'FALHOU: etapa inválida';
  exception when raise_exception then if sqlerrm <> 'ETAPA_INVALIDA' then raise; end if; end;
  begin perform sat_ordem_corrigir_etapa(v_os, 'em_manutencao', ' a '); raise exception 'FALHOU: motivo curto';
  exception when raise_exception then if sqlerrm <> 'MOTIVO_CORRECAO_OBRIGATORIO' then raise; end if; end;
  begin perform sat_ordem_corrigir_etapa(v_os, 'qualidade', 'mesma etapa'); raise exception 'FALHOU: mesma etapa';
  exception when raise_exception then if sqlerrm <> 'NADA_A_MUDAR' then raise; end if; end;
  r := sat_ordem_corrigir_etapa(v_os, 'em_manutencao', '  qualidade achou outro defeito  ');
  if (select etapa from sat_ordens where id = v_os) <> 'em_manutencao' then raise exception 'FALHOU: correção não mudou a etapa'; end if;
  if not exists (select 1 from sat_ordem_historico where ordem_id = v_os and evento = 'correcao_etapa'
                    and etapa_de = 'qualidade' and etapa_para = 'em_manutencao'
                    and dados->>'motivo' = 'qualidade achou outro defeito') then
    raise exception 'FALHOU: histórico da correção';
  end if;

  -- busca: pelo NS novo, pelo antigo e só pela sequência
  select array_agg(x) into v_ids from sat_ordens_do_ns('610', '99') x;
  if v_ids is distinct from array[v_os] then raise exception 'FALHOU: busca pelo NS novo %', v_ids; end if;
  select array_agg(x) into v_ids from sat_ordens_do_ns('610', '3') x;
  if v_ids is distinct from array[v_os] then raise exception 'FALHOU: busca pelo NS antigo %', v_ids; end if;
  select array_agg(x) into v_ids from sat_ordens_do_ns(null, '99') x;
  if v_ids is distinct from array[v_os] then raise exception 'FALHOU: busca só pela sequência %', v_ids; end if;
  if exists (select 1 from sat_ordens_do_ns('610', '') x) then raise exception 'FALHOU: busca vazia devolveu OS'; end if;

  -- mais usadas no produto (PMOC31) e kits conhecidos
  if (select array_agg(codigo || ':' || usos) from sat_pecas_mais_usadas('pmoc31', 10)) is distinct from array['PMOE74:1'] then
    raise exception 'FALHOU: mais usadas %', (select array_agg(codigo || ':' || usos) from sat_pecas_mais_usadas('pmoc31', 10));
  end if;
  if exists (select 1 from sat_pecas_mais_usadas('', 10)) then raise exception 'FALHOU: mais usadas sem produto'; end if;
  if (select array_agg(codigo || '|' || descricao) from sat_kits_conhecidos()) is distinct from array['PMOE74|Módulo Camabio com cabo'] then
    raise exception 'FALHOU: kits conhecidos';
  end if;

  -- cache: só com manutenção, chave no formato, grava e regrava
  begin perform sat_compels_cache_gravar('estrutura:PMOC31', '{"arvore": []}'::jsonb); raise exception 'FALHOU: cache sem manutenção';
  exception when raise_exception then if sqlerrm <> 'SEM_PERMISSAO' then raise; end if; end;
  perform set_config('teste.perms', 'sat.visualizar,sat.manutencao', false);
  begin perform sat_compels_cache_gravar('qualquer coisa', '{}'::jsonb); raise exception 'FALHOU: chave inválida';
  exception when raise_exception then if sqlerrm <> 'CHAVE_INVALIDA' then raise; end if; end;
  perform sat_compels_cache_gravar('estrutura:PMOC31', '{"arvore": []}'::jsonb);
  perform sat_compels_cache_gravar('estrutura:PMOC31', '{"arvore": null}'::jsonb);
  perform sat_compels_cache_gravar('pais:12345', '[]'::jsonb);
  if (select dados from sat_compels_cache where chave = 'estrutura:PMOC31') <> '{"arvore": null}'::jsonb then
    raise exception 'FALHOU: cache não regravou';
  end if;
  begin insert into sat_compels_cache (chave, dados) values ('pais:1', '[]'); raise exception 'FALHOU: insert direto no cache';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'correção, busca, mais usadas e cache: ok';
end $t$;
```

No `supabase/tests/rodar-sat-test.sh`, no bloco da 0198, troque a linha `TABELAS_0198=...` por:

```bash
TABELAS_0198="'sat_defeitos','sat_ordens','sat_ordem_defeitos','sat_ordem_pecas','sat_ordem_ns','sat_ordem_historico','sat_compels_cache'"
```

e troque o `if [ "$POLS_OS" = "6" ] && [ "$TOTAL_OS" = "6" ]; then` e o `echo` seguinte por:

```bash
if [ "$POLS_OS" = "7" ] && [ "$TOTAL_OS" = "7" ]; then
  echo "0198: 7 policies de leitura em InitPlan, nenhuma de escrita, sat_numeracao sem policy: ok"
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: FAIL com `function sat_ordem_corrigir_etapa(uuid, unknown, unknown) does not exist`.

- [ ] **Step 3: Implementar**

Acrescente na `0198_sat_ordem_servico.sql`, ANTES da linha `notify pgrst, 'reload schema';`:

```sql
-- ---------- correção de etapa pelo administrador (sat.administrar), com motivo no histórico ----------
create or replace function public.sat_ordem_corrigir_etapa(p_ordem uuid, p_etapa text, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_motivo text := regexp_replace(btrim(coalesce(p_motivo, '')), '\s+', ' ', 'g');
  v_de     text;
begin
  if not tem_permissao('sat', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_etapa is null or p_etapa not in ('recebido', 'nota_pendente', 'disponivel', 'em_manutencao', 'qualidade') then
    raise exception 'ETAPA_INVALIDA';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 500 then raise exception 'MOTIVO_CORRECAO_OBRIGATORIO'; end if;
  select o.etapa into v_de from sat_ordens o where o.id = p_ordem;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  perform sat__ordem_mudar_etapa(p_ordem, p_etapa, 'correcao_etapa', jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('etapa_de', v_de, 'etapa_para', p_etapa);
end
$func$;
revoke all on function public.sat_ordem_corrigir_etapa(uuid, text, text) from public, anon;
grant execute on function public.sat_ordem_corrigir_etapa(uuid, text, text) to authenticated, service_role;

-- ---------- busca por NS: atual, antigo ou novo (invoker: o RLS de sat.visualizar vale) ----------
-- Sem modelo, casa só pela sequência (como a busca da entrada).
create or replace function public.sat_ordens_do_ns(p_modelo text, p_sequencia text)
returns setof uuid
language sql
stable
set search_path = public
as $func$
  select o.id from sat_ordens o
   where coalesce(p_sequencia, '') <> '' and o.sequencia = p_sequencia
     and (coalesce(p_modelo, '') = '' or o.modelo = p_modelo)
  union
  select n.ordem_id from sat_ordem_ns n
   where coalesce(p_sequencia, '') <> ''
     and ((n.sequencia_antigo = p_sequencia and (coalesce(p_modelo, '') = '' or n.modelo_antigo = p_modelo))
       or (n.sequencia_novo = p_sequencia and (coalesce(p_modelo, '') = '' or n.modelo_novo = p_modelo)))
$func$;
revoke all on function public.sat_ordens_do_ns(text, text) from public, anon;
grant execute on function public.sat_ordens_do_ns(text, text) to authenticated, service_role;

-- ---------- camada 1 da lista de peças: as mais trocadas neste produto (invoker) ----------
create or replace function public.sat_pecas_mais_usadas(p_produto text, p_limite int)
returns table (codigo text, descricao text, usos bigint)
language sql
stable
set search_path = public
as $func$
  select p.codigo, (array_agg(p.descricao order by p.em desc))[1], count(*)
    from sat_ordem_pecas p
    join sat_ordens o on o.id = p.ordem_id
   where p.situacao = 'trocada'
     and coalesce(btrim(p_produto), '') <> ''
     and upper(btrim(o.produto)) = upper(btrim(p_produto))
   group by p.codigo
   order by count(*) desc, p.codigo
   limit least(greatest(coalesce(p_limite, 15), 1), 50)
$func$;
revoke all on function public.sat_pecas_mais_usadas(text, int) from public, anon;
grant execute on function public.sat_pecas_mais_usadas(text, int) to authenticated, service_role;

-- ---------- candidatos da camada 2: kits (PMOE*) já usados em alguma OS (invoker) ----------
create or replace function public.sat_kits_conhecidos()
returns table (codigo text, descricao text)
language sql
stable
set search_path = public
as $func$
  select p.codigo, (array_agg(p.descricao order by p.em desc))[1]
    from sat_ordem_pecas p
   where p.codigo like 'PMOE%'
   group by p.codigo
   order by p.codigo
   limit 200
$func$;
revoke all on function public.sat_kits_conhecidos() from public, anon;
grant execute on function public.sat_kits_conhecidos() to authenticated, service_role;

-- ---------- cache das leituras do Compels (estrutura do produto, pais de item); validade no app (7 dias) ----------
create table if not exists public.sat_compels_cache (
  chave   text primary key,
  dados   jsonb not null,
  lido_em timestamptz not null default now()
);
alter table public.sat_compels_cache enable row level security;
drop policy if exists sat_compels_cache_select on public.sat_compels_cache;
create policy sat_compels_cache_select on public.sat_compels_cache
  for select using ((select tem_permissao('sat', 'visualizar')));
revoke all on public.sat_compels_cache from public, anon, authenticated;
grant select on public.sat_compels_cache to authenticated;
grant select, insert, update, delete on public.sat_compels_cache to service_role;

create or replace function public.sat_compels_cache_gravar(p_chave text, p_dados jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  if p_chave is null or p_chave !~ '^(estrutura:[A-Z0-9][A-Z0-9_.-]{0,59}|pais:[0-9]{1,18})$' then
    raise exception 'CHAVE_INVALIDA';
  end if;
  if p_dados is null or octet_length(p_dados::text) > 2000000 then raise exception 'CACHE_GRANDE'; end if;
  insert into sat_compels_cache as c (chave, dados, lido_em) values (p_chave, p_dados, now())
  on conflict (chave) do update set dados = excluded.dados, lido_em = excluded.lido_em;
end
$func$;
revoke all on function public.sat_compels_cache_gravar(text, jsonb) from public, anon;
grant execute on function public.sat_compels_cache_gravar(text, jsonb) to authenticated, service_role;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: `NOTICE:  correção, busca, mais usadas e cache: ok`, `0198: 7 policies ... ok` e no fim `SAT OK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0198_sat_ordem_servico.sql supabase/tests/sat_ordem_test.sql supabase/tests/rodar-sat-test.sh
git commit -m "feat(sat): correção de etapa, busca da OS por NS antigo/novo, peças mais usadas e cache do Compels (0198)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Domínio da OS — etapas, tipos, fila, validações e mensagens de erro

**Files:**
- Create: `src/modules/sat/domain/ordem.ts`
- Modify: `src/modules/sat/domain/erros.ts` (códigos novos no `MENSAGENS`)
- Test: `src/modules/sat/domain/__tests__/ordem.test.ts`
- Test: `src/modules/sat/domain/__tests__/erros.test.ts`

**Interfaces:**
- Consumes: `normalizarNs`, `NsNormalizado` de `src/modules/sat/domain/numero-serie.ts`.
- Produces (usado nas Tarefas 9–14):
  - `type Etapa = 'recebido' | 'nota_pendente' | 'disponivel' | 'em_manutencao' | 'qualidade'`; `ETAPAS`, `ROTULO_ETAPA`, `ehEtapa(x): x is Etapa`.
  - `type TipoOrdem = 'em_garantia' | 'fora_garantia' | 'remanufatura' | 'retorno_peca'`; `ROTULO_TIPO`, `rotuloTipo(t: TipoOrdem | null): string`, `ehTipo(x): x is TipoOrdem`.
  - `agruparPorEtapa<T extends { etapa: Etapa }>(ordens: T[]): ColunaFila<T>[]` com `ColunaFila<T> = { etapa: Etapa; rotulo: string; ordens: T[] }`.
  - `tempoDesde(iso: string, agora: number): string` (`'12 min'`, `'5 h'`, `'3 d'`).
  - `codigoDoProduto(produto: string): string | null`; `CODIGO_ITEM: RegExp`.
  - `type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string }`.
  - `validarDefeito({ defeitoId, solucao }): Validacao<{ defeitoId: string; solucao: string }>`
  - `validarPeca({ codigo, descricao, quantidade }): Validacao<{ codigo: string; descricao: string; quantidade: number }>`
  - `validarLaudo(laudo: string): Validacao<string>`
  - `validarTrocaNs(ns: string): Validacao<NsNormalizado>`
  - `validarCorrecaoEtapa(etapa: string, motivo: string): Validacao<{ etapa: Etapa; motivo: string }>`
  - `MAX_SOLUCAO = 2000`, `MAX_LAUDO = 4000`, `MAX_DESCRICAO_PECA = 300`, `MAX_MOTIVO_CORRECAO = 500`, `MAX_QUANTIDADE = 9999`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/modules/sat/domain/__tests__/ordem.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  agruparPorEtapa, codigoDoProduto, ehEtapa, ehTipo, rotuloTipo, ROTULO_ETAPA, tempoDesde,
  validarCorrecaoEtapa, validarDefeito, validarLaudo, validarPeca, validarTrocaNs,
} from '../ordem'

const UUID = '00000000-0000-0000-0000-0000000000d1'

describe('etapas e tipos', () => {
  it('reconhece só as etapas desta entrega', () => {
    expect(ehEtapa('em_manutencao')).toBe(true)
    expect(ehEtapa('expedicao')).toBe(false)
    expect(ROTULO_ETAPA.disponivel).toBe('Disponível para manutenção')
    expect(ROTULO_ETAPA.nota_pendente).toBe('Nota pendente')
  })
  it('tipo sem garantia definida vira "Garantia a definir"', () => {
    expect(rotuloTipo(null)).toBe('Garantia a definir')
    expect(rotuloTipo('em_garantia')).toBe('Em garantia')
    expect(rotuloTipo('fora_garantia')).toBe('Fora da garantia')
    expect(ehTipo('remanufatura')).toBe(true)
    expect(ehTipo('a_definir')).toBe(false)
  })
})

describe('agruparPorEtapa', () => {
  it('as 4 colunas da fila na ordem do fluxo; "Recebido" só aparece se tiver OS', () => {
    const ordens = [
      { id: 'a', etapa: 'em_manutencao' as const }, { id: 'b', etapa: 'nota_pendente' as const },
      { id: 'c', etapa: 'em_manutencao' as const },
    ]
    const colunas = agruparPorEtapa(ordens)
    expect(colunas.map((c) => c.etapa)).toEqual(['nota_pendente', 'disponivel', 'em_manutencao', 'qualidade'])
    expect(colunas.find((c) => c.etapa === 'em_manutencao')!.ordens.map((o) => o.id)).toEqual(['a', 'c'])
    expect(colunas.find((c) => c.etapa === 'disponivel')!.ordens).toEqual([])
    expect(agruparPorEtapa([{ id: 'x', etapa: 'recebido' as const }])[0]).toMatchObject({ etapa: 'recebido', rotulo: 'Recebido' })
  })
})

describe('tempoDesde', () => {
  const agora = Date.parse('2026-11-26T15:00:00Z')
  it('minutos, horas e dias', () => {
    expect(tempoDesde('2026-11-26T14:48:00Z', agora)).toBe('12 min')
    expect(tempoDesde('2026-11-26T10:00:00Z', agora)).toBe('5 h')
    expect(tempoDesde('2026-11-23T15:00:00Z', agora)).toBe('3 d')
    expect(tempoDesde('2026-11-26T15:00:30Z', agora)).toBe('0 min')
    expect(tempoDesde('lixo', agora)).toBe('—')
  })
})

describe('codigoDoProduto', () => {
  it('maiúsculo e sem espaço; texto livre não é código', () => {
    expect(codigoDoProduto(' pmoc31 ')).toBe('PMOC31')
    expect(codigoDoProduto('REP iDClass')).toBeNull()
    expect(codigoDoProduto('')).toBeNull()
    expect(codigoDoProduto('123')).toBeNull()
  })
})

describe('validações da manutenção', () => {
  it('defeito: id válido e solução de 1 a 2000', () => {
    expect(validarDefeito({ defeitoId: UUID, solucao: '  Trocada a fonte ' })).toEqual({ ok: true, valor: { defeitoId: UUID, solucao: 'Trocada a fonte' } })
    expect(validarDefeito({ defeitoId: 'x', solucao: 'a' })).toEqual({ ok: false, erro: 'Escolha o defeito da lista.' })
    expect(validarDefeito({ defeitoId: UUID, solucao: '  ' })).toEqual({ ok: false, erro: 'Descreva a solução do defeito.' })
    expect(validarDefeito({ defeitoId: UUID, solucao: 'x'.repeat(2001) }).ok).toBe(false)
  })
  it('peça: código maiúsculo, quantidade com vírgula, de 0 a 9999 (exclusive o zero)', () => {
    expect(validarPeca({ codigo: ' pmoe74 ', descricao: ' Módulo ', quantidade: '1,5' }))
      .toEqual({ ok: true, valor: { codigo: 'PMOE74', descricao: 'Módulo', quantidade: 1.5 } })
    expect(validarPeca({ codigo: 'PRT 1', descricao: '', quantidade: 1 })).toEqual({ ok: false, erro: 'Código do item inválido.' })
    expect(validarPeca({ codigo: 'PRT1', descricao: '', quantidade: '0' })).toEqual({ ok: false, erro: 'Quantidade inválida (maior que zero, até 9999).' })
    expect(validarPeca({ codigo: 'PRT1', descricao: '', quantidade: 'abc' }).ok).toBe(false)
    expect(validarPeca({ codigo: 'PRT1', descricao: 'x'.repeat(301), quantidade: 1 }).ok).toBe(false)
  })
  it('laudo: até 4000, limpo', () => {
    expect(validarLaudo('  ok  ')).toEqual({ ok: true, valor: 'ok' })
    expect(validarLaudo('x'.repeat(4001))).toEqual({ ok: false, erro: 'O laudo passa de 4000 caracteres.' })
  })
  it('troca de NS: normaliza como na entrada', () => {
    expect(validarTrocaNs('00043005620019177')).toEqual({ ok: true, valor: { escrito: '00043005620019177', modelo: '562', sequencia: '19177' } })
    expect(validarTrocaNs('   ')).toEqual({ ok: false, erro: 'Informe o número de série novo.' })
  })
  it('correção de etapa: etapa válida e motivo de 3 a 500', () => {
    expect(validarCorrecaoEtapa('em_manutencao', '  voltou   da qualidade ')).toEqual({ ok: true, valor: { etapa: 'em_manutencao', motivo: 'voltou da qualidade' } })
    expect(validarCorrecaoEtapa('expedicao', 'abc')).toEqual({ ok: false, erro: 'Etapa inválida.' })
    expect(validarCorrecaoEtapa('qualidade', 'ab')).toEqual({ ok: false, erro: 'Escreva o motivo da correção (3 a 500 caracteres).' })
  })
})
```

Em `src/modules/sat/domain/__tests__/erros.test.ts`, acrescente dentro do `describe('mensagemDoErro', ...)`:

```ts
  it('traduz os códigos da ordem de serviço (0198)', () => {
    expect(mensagemDoErro('ETAPA_NAO_PERMITE')).toBe('A OS não está na etapa certa para isso. Recarregue a página.')
    expect(mensagemDoErro('FORA_DA_GARANTIA')).toBe('OS fora da garantia: o orçamento ainda não está no ShopFloor.')
    expect(mensagemDoErro('SEM_LAUDO')).toBe('Escreva o laudo antes de enviar para a qualidade.')
    expect(mensagemDoErro('PECA_REPETIDA')).toBe('Essa peça já está nesta OS — remova e lance de novo com a quantidade certa.')
    for (const c of ['ORDEM_NAO_ENCONTRADA', 'ETAPA_INVALIDA', 'DEFEITO_INVALIDO', 'DEFEITO_REPETIDO', 'SOLUCAO_OBRIGATORIA',
      'TEXTO_LONGO', 'CODIGO_INVALIDO', 'QUANTIDADE_INVALIDA', 'ITEM_NAO_ENCONTRADO', 'SEM_DEFEITO',
      'GARANTIA_INDEFINIDA', 'MOTIVO_CORRECAO_OBRIGATORIO', 'CHAVE_INVALIDA', 'CACHE_GRANDE']) {
      expect(mensagemDoErro(c)).not.toBe('Não foi possível concluir. Tente de novo.')
    }
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/sat/domain/__tests__/ordem.test.ts src/modules/sat/domain/__tests__/erros.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../ordem"` e o teste novo de `erros` com a mensagem genérica.

- [ ] **Step 3: Implementar `ordem.ts`**

Crie `src/modules/sat/domain/ordem.ts`:

```ts
import { normalizarNs, type NsNormalizado } from './numero-serie'

/**
 * A ordem de serviço do SAT (spec 2026-11-26-sat-ordem-servico-design.md). Entrega 1: as etapas até a qualidade e a
 * manutenção (defeitos, peças, laudo, troca de NS). Os valores são os mesmos da migração 0198; o banco confere tudo
 * de novo (estas validações só evitam ida e volta e dão a mensagem certa).
 */
export const ETAPAS = ['recebido', 'nota_pendente', 'disponivel', 'em_manutencao', 'qualidade'] as const
export type Etapa = (typeof ETAPAS)[number]

export const ROTULO_ETAPA: Record<Etapa, string> = {
  recebido: 'Recebido',
  nota_pendente: 'Nota pendente',
  disponivel: 'Disponível para manutenção',
  em_manutencao: 'Em manutenção',
  qualidade: 'Qualidade',
}

export const ehEtapa = (x: unknown): x is Etapa => typeof x === 'string' && (ETAPAS as readonly string[]).includes(x)

export const TIPOS = ['em_garantia', 'fora_garantia', 'remanufatura', 'retorno_peca'] as const
export type TipoOrdem = (typeof TIPOS)[number]

export const ROTULO_TIPO: Record<TipoOrdem, string> = {
  em_garantia: 'Em garantia',
  fora_garantia: 'Fora da garantia',
  remanufatura: 'Remanufatura',
  retorno_peca: 'Retorno de peça',
}

export const ehTipo = (x: unknown): x is TipoOrdem => typeof x === 'string' && (TIPOS as readonly string[]).includes(x)

/** `null` = a planilha não diz se é garantia (ticket sem a coluna, ou sem ticket). */
export const rotuloTipo = (t: TipoOrdem | null) => (t ? ROTULO_TIPO[t] : 'Garantia a definir')

export interface ColunaFila<T> {
  etapa: Etapa
  rotulo: string
  ordens: T[]
}

/**
 * As colunas do quadro da fila, na ordem do fluxo. A OS nasce já em "nota pendente" ou "disponível", então
 * "Recebido" só vira coluna se alguma OS estiver lá (correção do administrador).
 */
export function agruparPorEtapa<T extends { etapa: Etapa }>(ordens: T[]): ColunaFila<T>[] {
  return ETAPAS
    .filter((e) => e !== 'recebido' || ordens.some((o) => o.etapa === 'recebido'))
    .map((etapa) => ({ etapa, rotulo: ROTULO_ETAPA[etapa], ordens: ordens.filter((o) => o.etapa === etapa) }))
}

/** Há quanto tempo (de `iso` até `agora`): minutos até 1 h, horas até 48 h, depois dias. */
export function tempoDesde(iso: string, agora: number): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const min = Math.max(0, Math.floor((agora - t) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** Código de item do Compels: maiúsculo, sem espaço (o mesmo padrão do banco). */
export const CODIGO_ITEM = /^[A-Z0-9][A-Z0-9_.-]{0,59}$/

/** O produto da OS como código do Compels (ex.: `PMOC31`); texto livre ou só número → `null`. */
export function codigoDoProduto(produto: string): string | null {
  const c = (produto ?? '').trim().toUpperCase()
  return CODIGO_ITEM.test(c) && /^[A-Z]/.test(c) ? c : null
}

export const MAX_SOLUCAO = 2000
export const MAX_LAUDO = 4000
export const MAX_DESCRICAO_PECA = 300
export const MAX_MOTIVO_CORRECAO = 500
export const MAX_QUANTIDADE = 9999

export type Validacao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const limpo = (s: unknown) => (typeof s === 'string' ? s.trim() : '')

export function validarDefeito(i: { defeitoId: string; solucao: string }): Validacao<{ defeitoId: string; solucao: string }> {
  if (typeof i.defeitoId !== 'string' || !UUID.test(i.defeitoId)) return { ok: false, erro: 'Escolha o defeito da lista.' }
  const solucao = limpo(i.solucao)
  if (solucao === '') return { ok: false, erro: 'Descreva a solução do defeito.' }
  if (solucao.length > MAX_SOLUCAO) return { ok: false, erro: `A solução passa de ${MAX_SOLUCAO} caracteres.` }
  return { ok: true, valor: { defeitoId: i.defeitoId, solucao } }
}

export function validarPeca(i: { codigo: string; descricao: string; quantidade: string | number }):
  Validacao<{ codigo: string; descricao: string; quantidade: number }> {
  const codigo = limpo(i.codigo).toUpperCase()
  if (!CODIGO_ITEM.test(codigo)) return { ok: false, erro: 'Código do item inválido.' }
  const descricao = limpo(i.descricao)
  if (descricao.length > MAX_DESCRICAO_PECA) return { ok: false, erro: `A descrição passa de ${MAX_DESCRICAO_PECA} caracteres.` }
  const q = typeof i.quantidade === 'number' ? i.quantidade : Number(limpo(i.quantidade).replace(',', '.'))
  if (!Number.isFinite(q) || q <= 0 || q > MAX_QUANTIDADE) return { ok: false, erro: 'Quantidade inválida (maior que zero, até 9999).' }
  return { ok: true, valor: { codigo, descricao, quantidade: q } }
}

export function validarLaudo(laudo: string): Validacao<string> {
  const t = limpo(laudo)
  if (t.length > MAX_LAUDO) return { ok: false, erro: `O laudo passa de ${MAX_LAUDO} caracteres.` }
  return { ok: true, valor: t }
}

export function validarTrocaNs(ns: string): Validacao<NsNormalizado> {
  const t = limpo(ns)
  if (t === '') return { ok: false, erro: 'Informe o número de série novo.' }
  if (t.length > 200) return { ok: false, erro: 'Número de série longo demais.' }
  return { ok: true, valor: normalizarNs(t) }
}

export function validarCorrecaoEtapa(etapa: string, motivo: string): Validacao<{ etapa: Etapa; motivo: string }> {
  if (!ehEtapa(etapa)) return { ok: false, erro: 'Etapa inválida.' }
  const m = limpo(motivo).replace(/\s+/g, ' ')
  if (m.length < 3 || m.length > MAX_MOTIVO_CORRECAO) return { ok: false, erro: 'Escreva o motivo da correção (3 a 500 caracteres).' }
  return { ok: true, valor: { etapa, motivo: m } }
}
```

- [ ] **Step 4: Acrescentar as mensagens em `erros.ts`**

Em `src/modules/sat/domain/erros.ts`, troque o comentário da 1ª linha por `/** Os códigos que as funções do SAT (0186/0187/0190/0198) levantam, na língua da tela. O resto vira a mensagem genérica. */` e acrescente, logo depois de `OS_EM_USO: 'Essa OS já está ligada a outro relógio.',`:

```ts
  // ordem de serviço (0198)
  ORDEM_NAO_ENCONTRADA: 'Ordem de serviço não encontrada. Recarregue a página.',
  ETAPA_NAO_PERMITE: 'A OS não está na etapa certa para isso. Recarregue a página.',
  ETAPA_INVALIDA: 'Etapa inválida.',
  DEFEITO_INVALIDO: 'Esse defeito não existe mais ou foi desativado. Recarregue a página.',
  DEFEITO_REPETIDO: 'Esse defeito já está nesta OS.',
  SOLUCAO_OBRIGATORIA: 'Descreva a solução do defeito.',
  TEXTO_LONGO: 'Texto longo demais.',
  CODIGO_INVALIDO: 'Código do item inválido.',
  QUANTIDADE_INVALIDA: 'Quantidade inválida (maior que zero, até 9999).',
  PECA_REPETIDA: 'Essa peça já está nesta OS — remova e lance de novo com a quantidade certa.',
  ITEM_NAO_ENCONTRADO: 'Esse lançamento não existe mais. Recarregue a página.',
  SEM_DEFEITO: 'Lance ao menos um defeito antes de enviar para a qualidade.',
  SEM_LAUDO: 'Escreva o laudo antes de enviar para a qualidade.',
  FORA_DA_GARANTIA: 'OS fora da garantia: o orçamento ainda não está no ShopFloor.',
  GARANTIA_INDEFINIDA: 'A planilha não diz se esta OS é garantia. Confira o ticket do suporte.',
  MOTIVO_CORRECAO_OBRIGATORIO: 'Escreva o motivo da correção (3 a 500 caracteres).',
  CHAVE_INVALIDA: 'Não foi possível guardar a leitura do Compels.',
  CACHE_GRANDE: 'Não foi possível guardar a leitura do Compels.',
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/modules/sat/domain --maxWorkers=2`
Expected: PASS (todos os testes do domínio do SAT).

- [ ] **Step 6: Commit**

```bash
git add src/modules/sat/domain/ordem.ts src/modules/sat/domain/erros.ts src/modules/sat/domain/__tests__/ordem.test.ts src/modules/sat/domain/__tests__/erros.test.ts
git commit -m "feat(sat): domínio da ordem de serviço (etapas, fila, validações da manutenção)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Leituras do Compels — cliente, estrutura do produto, camada 3, kits e busca de itens (+ script de conferência)

**Files:**
- Modify: `src/modules/compels/infra/cliente.ts` (métodos novos no fim da classe, antes do `}` final)
- Create: `src/modules/sat/domain/estrutura.ts`
- Create: `tools/compels/sat-estrutura.ts` e o gerado `tools/compels/sat-estrutura.mjs`
- Test: `src/modules/compels/infra/__tests__/cliente.test.ts` (casos novos)
- Test: `src/modules/sat/domain/__tests__/estrutura.test.ts`

**Interfaces:**
- Consumes: `listaDe`, `RespostaInesperada` de `src/modules/compels/domain/leituras-erp.ts`.
- Produces:
  - `ClienteCompels.listarDefeitosSat(): Promise<Record<string, unknown>[]>` — `POST sat/defeito/findAll` (form `page/start/limit`, paginado até `totalCount`).
  - `ClienteCompels.composicaoDoItem(codigo: string): Promise<unknown>` — `POST composicaoProduto/findByCodigoItem` (form `codigoItem`).
  - `ClienteCompels.arvoreDaComposicao(id: number): Promise<unknown>` — `POST composicaoProduto/findComposicaoByIdEntireTree` (form `id`).
  - `ClienteCompels.paisDoItem(itemId: number): Promise<unknown>` — `GET composicaoProduto/findParentsByItemId/<itemId>`.
  - `ClienteCompels.buscarItens(filtro: Record<string, unknown>): Promise<unknown>` — `POST itemMovimento/findFilter` (form `filter` = o JSON do filtro, `page`, `start`, `limit=30`); quem monta o filtro é `filtroBuscaItem` (o cliente do Compels não depende do SAT).
  - Em `estrutura.ts`: `interface NoEstrutura { codigo: string; descricao: string; itemId: number | null; filhos: NoEstrutura[] }`, `interface PecaSugerida { codigo: string; descricao: string }`, `PREFIXOS_FORA_DA_LISTA`, `idDaComposicao(resposta): number | null`, `arvoreDaResposta(resposta, codigoProduto): NoEstrutura[]`, `foraDaLista(no): boolean`, `pecasTrocaveis(arvore): NoEstrutura[]`, `codigosDaArvore(arvore): Set<string>`, `kitServe(kit: NoEstrutura[], codigosProduto: Set<string>): boolean`, `paisDaResposta(resposta): PecaSugerida[]`, `itensDaBusca(resposta, limite?): PecaSugerida[]`, `filtroBuscaItem(termo: string, dataIso: string): Record<string, unknown>`.

- [ ] **Step 1: Escrever os testes que falham (domínio)**

Crie `src/modules/sat/domain/__tests__/estrutura.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  arvoreDaResposta, codigosDaArvore, filtroBuscaItem, foraDaLista, idDaComposicao, itensDaBusca, kitServe,
  paisDaResposta, pecasTrocaveis, type NoEstrutura,
} from '../estrutura'

// Árvore FICTÍCIA no formato do findComposicaoByIdEntireTree ({children, success}; cada nó com item e children).
const no = (codigo: string, descricao: string, id: number | null, children: unknown[] = []) =>
  ({ item: { codigo, descricao, ...(id === null ? {} : { id }) }, children })
const RESPOSTA = {
  success: true,
  children: [
    no('PMOX01', 'MODULO BIOMETRICO', 11, [no('CB001', 'CABO FLAT', 12), no('BIO001', 'LEITOR BIO', 13)]),
    no('PRT900', 'PLACA PTH MONTADA', 21, [
      no('PRT901', 'PLACA SMD', 22, [no('R001', 'RESISTOR 10K', 23)]),
      no('C001', 'CAPACITOR', 24),
      no('FT100', 'FONTE 12V', 25, [no('TR1', 'TRAFO', 26)]),
    ]),
    no('GB001', 'GABINETE', 31, [no('RWSV10', 'SERVICO DE INJECAO', 32)]),
    no('RWSV11', 'SERVICO DE PINTURA', 33, [no('TINTA', 'TINTA', 34)]),
    no('EMB001', 'EMBALAGEM COMPLETA', 41, [no('CX01', 'CAIXA DE PAPELAO', 42)]),
    no('PAR01', 'PARAFUSO M3', 51),
    no('PMOE74', 'MODULO CAMABIO COM CABO', 61, [no('CB001', 'CABO FLAT', 12)]),
  ],
}

describe('idDaComposicao', () => {
  it('aceita {data: {id}}, {data: [{id}]}, {id} e lista; sem id → null', () => {
    expect(idDaComposicao({ data: { id: 77 } })).toBe(77)
    expect(idDaComposicao({ data: [{ id: 78 }] })).toBe(78)
    expect(idDaComposicao({ id: 79 })).toBe(79)
    expect(idDaComposicao([{ id: 80 }])).toBe(80)
    expect(idDaComposicao({ data: null, success: true })).toBeNull()
    expect(idDaComposicao({ data: [] })).toBeNull()
  })
})

describe('arvoreDaResposta', () => {
  it('lê os nós de 1º nível com os filhos (código em maiúsculo, item.id quando vem)', () => {
    const a = arvoreDaResposta(RESPOSTA, 'PMOC31')
    expect(a.map((n) => n.codigo)).toEqual(['PMOX01', 'PRT900', 'GB001', 'RWSV11', 'EMB001', 'PAR01', 'PMOE74'])
    expect(a[0]).toMatchObject({ descricao: 'MODULO BIOMETRICO', itemId: 11 })
    expect(a[1]!.filhos[0]!.filhos[0]!.codigo).toBe('R001')
  })
  it('se a raiz vier como um nó só (o próprio produto), desce nele', () => {
    const a = arvoreDaResposta({ success: true, children: [no('PMOC31', 'RELOGIO', 1, RESPOSTA.children)] }, 'pmoc31')
    expect(a.map((n) => n.codigo)[0]).toBe('PMOX01')
  })
  it('sem children: resposta inesperada', () => {
    expect(() => arvoreDaResposta({ success: false }, 'PMOC31')).toThrow(/estrutura do produto/)
  })
  it('nó sem código é ignorado', () => {
    expect(arvoreDaResposta({ children: [{ item: {} }, no('A1', 'X', null)] }, 'P')).toEqual([
      { codigo: 'A1', descricao: 'X', itemId: null, filhos: [] },
    ])
  })
})

describe('camada 3 — pecasTrocaveis', () => {
  const a = arvoreDaResposta(RESPOSTA, 'PMOC31')
  it('1º e 2º nível com filhos ou PMO*; sem PRT*, RWSV*, embalagem e folhas comuns', () => {
    expect(pecasTrocaveis(a).map((n) => n.codigo)).toEqual(['PMOX01', 'GB001', 'PMOE74', 'FT100'])
  })
  it('foraDaLista: prefixos e descrição de embalagem', () => {
    expect(foraDaLista({ codigo: 'PRT1', descricao: '', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'RWSV1', descricao: '', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'X1', descricao: 'Saco plástico', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'X1', descricao: 'Calço de isopor', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'GB1', descricao: 'Gabinete', itemId: null, filhos: [] })).toBe(false)
  })
})

describe('camada 2 — kitServe', () => {
  const codigos = codigosDaArvore(arvoreDaResposta(RESPOSTA, 'PMOC31'))
  it('serve quando todos os componentes de 1º nível do kit estão em algum nível do produto', () => {
    const kit: NoEstrutura[] = [
      { codigo: 'BIO001', descricao: '', itemId: null, filhos: [] },
      { codigo: 'CB001', descricao: '', itemId: null, filhos: [] },
      { codigo: 'RWSV99', descricao: 'SERVICO', itemId: null, filhos: [] },
      { codigo: 'SC01', descricao: 'SACO', itemId: null, filhos: [] },
    ]
    expect(kitServe(kit, codigos)).toBe(true)
  })
  it('não serve com um componente de fora, nem kit vazio', () => {
    expect(kitServe([{ codigo: 'BIO001', descricao: '', itemId: null, filhos: [] }, { codigo: 'ZZZ', descricao: '', itemId: null, filhos: [] }], codigos)).toBe(false)
    expect(kitServe([], codigos)).toBe(false)
  })
})

describe('pais e busca de itens', () => {
  it('pais: aceita item aninhado ou o código direto; sem duplicar', () => {
    expect(paisDaResposta({ data: [{ item: { codigo: 'PMOE74', descricao: 'KIT' } }, { codigo: 'pmoc31', descricao: 'REL' }, { codigo: 'PMOE74' }] }))
      .toEqual([{ codigo: 'PMOE74', descricao: 'KIT' }, { codigo: 'PMOC31', descricao: 'REL' }])
  })
  it('busca: as linhas do itemMovimento/findFilter viram código + descrição, até o limite', () => {
    const resposta = { data: [{ item: { codigo: 'PRT706', descricao: 'PLACA' } }, { item: { codigo: 'PRT707', descricao: 'PLACA 2' } }, { item: {} }] }
    expect(itensDaBusca(resposta)).toEqual([{ codigo: 'PRT706', descricao: 'PLACA' }, { codigo: 'PRT707', descricao: 'PLACA 2' }])
    expect(itensDaBusca(resposta, 1)).toHaveLength(1)
  })
  it('filtro: termo com cara de código vai no código; o resto na descrição', () => {
    expect(filtroBuscaItem(' prt70 ', '2026-11-26T00:00:00')).toEqual({ codigo: 'PRT70', descricao: '', data: '2026-11-26T00:00:00', exibeItensComSaldoZerado: true })
    expect(filtroBuscaItem('fonte 12v', '2026-11-26T00:00:00')).toMatchObject({ codigo: '', descricao: 'fonte 12v' })
  })
})
```

- [ ] **Step 2: Escrever os testes que falham (cliente)**

Em `src/modules/compels/infra/__tests__/cliente.test.ts`, acrescente no fim do arquivo:

```ts
describe('ClienteCompels — leituras do SAT (só leitura)', () => {
  it('defeitos: POST sat/defeito/findAll em formulário, paginado até o totalCount', async () => {
    const pagina = (n: number, de: number) => Array.from({ length: n }, (_, i) => ({ id: de + i, descricao: `D${de + i}` }))
    let chamada = 0
    const { buscar, chamadas } = fingirCompels({
      '/sat/defeito/findAll': () => json({ data: chamada++ === 0 ? pagina(100, 1) : pagina(5, 101), totalCount: 105 }),
    })
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    expect(await c.listarDefeitosSat()).toHaveLength(105)
    expect(chamadas).toHaveLength(2)
    expect(chamadas[0]!.init.method).toBe('POST')
    expect(String(chamadas[1]!.init.body)).toBe('page=2&start=100&limit=100')
  })

  it('estrutura: findByCodigoItem (codigoItem) e findComposicaoByIdEntireTree (id), em formulário', async () => {
    const { buscar, chamadas } = fingirCompels({
      '/composicaoProduto/findByCodigoItem': () => json({ data: { id: 5 } }),
      '/composicaoProduto/findComposicaoByIdEntireTree': () => json({ children: [], success: true }),
    })
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    expect(await c.composicaoDoItem(' PMOC31 ')).toEqual({ data: { id: 5 } })
    expect(await c.arvoreDaComposicao(5)).toEqual({ children: [], success: true })
    expect(String(chamadas[0]!.init.body)).toBe('codigoItem=PMOC31')
    expect(String(chamadas[1]!.init.body)).toBe('id=5')
  })

  it('pais: GET composicaoProduto/findParentsByItemId/<id>', async () => {
    const { buscar, chamadas } = fingirCompels({ '/composicaoProduto/findParentsByItemId/': () => json({ data: [] }) })
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    await c.paisDoItem(123)
    expect(chamadas[0]!.url).toBe('/composicaoProduto/findParentsByItemId/123')
    expect(chamadas[0]!.init.method ?? 'GET').toBe('GET')
  })

  it('busca de itens: itemMovimento/findFilter com o filtro (JSON) no campo filter', async () => {
    const { buscar, chamadas } = fingirCompels({ '/itemMovimento/findFilter': () => json({ data: [] }) })
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    const filtro = { codigo: '', descricao: 'fonte', data: '2026-11-26T00:00:00', exibeItensComSaldoZerado: true }
    await c.buscarItens(filtro)
    const corpo = new URLSearchParams(String(chamadas[0]!.init.body))
    expect(JSON.parse(corpo.get('filter')!)).toEqual(filtro)
    expect(corpo.get('limit')).toBe('30')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/modules/sat/domain/__tests__/estrutura.test.ts src/modules/compels/infra/__tests__/cliente.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../estrutura"` e `c.listarDefeitosSat is not a function`.

- [ ] **Step 4: Implementar `estrutura.ts`**

Crie `src/modules/sat/domain/estrutura.ts` (imports RELATIVOS: o arquivo entra no bundle dos scripts de `tools/compels`, que não conhece o `@/`):

```ts
import { listaDe, RespostaInesperada } from '../../compels/domain/leituras-erp'

/**
 * A estrutura do produto no Compels (composicaoProduto) e as camadas 2 e 3 da lista de peças da manutenção do SAT
 * (spec 2026-11-26-sat-ordem-servico-design.md, decisão 6). Tudo puro: entram as respostas cruas, saem listas.
 */
export interface NoEstrutura {
  codigo: string
  descricao: string
  /** Id interno do item no Compels (vai no findParentsByItemId); null se a resposta não trouxe. */
  itemId: number | null
  filhos: NoEstrutura[]
}

export interface PecaSugerida {
  codigo: string
  descricao: string
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const PROFUNDIDADE_MAXIMA = 15

/** `findByCodigoItem`: o id da composição do item; null = o item não tem estrutura. */
export function idDaComposicao(resposta: unknown): number | null {
  const r = obj(resposta)
  const d = r && 'data' in r ? r.data : resposta
  const alvo = Array.isArray(d) ? d[0] : d
  const id = obj(alvo)?.id
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

function lerNo(v: unknown, profundidade: number): NoEstrutura | null {
  const o = obj(v)
  if (!o || profundidade > PROFUNDIDADE_MAXIMA) return null
  const item = obj(o.item)
  const codigo = txt(item?.codigo).toUpperCase()
  if (codigo === '') return null
  const filhos = Array.isArray(o.children) ? o.children : []
  return {
    codigo,
    descricao: txt(item?.descricao),
    itemId: typeof item?.id === 'number' ? item.id : null,
    filhos: filhos.map((f) => lerNo(f, profundidade + 1)).filter((x): x is NoEstrutura => x !== null),
  }
}

/**
 * `findComposicaoByIdEntireTree` devolve `{children, success}`. Devolve os nós de 1º nível (cada um com os filhos).
 * Se a raiz vier como um nó só, que é o próprio produto, desce nele.
 */
export function arvoreDaResposta(resposta: unknown, codigoProduto: string): NoEstrutura[] {
  const r = obj(resposta)
  if (!r || !Array.isArray(r.children)) throw new RespostaInesperada('estrutura do produto')
  const nos = r.children.map((f) => lerNo(f, 1)).filter((x): x is NoEstrutura => x !== null)
  if (nos.length === 1 && nos[0]!.codigo === codigoProduto.trim().toUpperCase()) return nos[0]!.filhos
  return nos
}

/** Prefixos que nunca entram na camada 3: PRT = etapa SMD/PTH da placa; RWSV = serviço (injeção, pintura). */
export const PREFIXOS_FORA_DA_LISTA = ['PRT', 'RWSV']
const EMBALAGEM = /\b(EMBALAGEM|CAIXA DE PAPELAO|CAIXA PAPELAO|SACO|ETIQUETA|MANUAL|CALCO|PLASTICO BOLHA|FITA)\b/
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

export function foraDaLista(n: NoEstrutura): boolean {
  return PREFIXOS_FORA_DA_LISTA.some((p) => n.codigo.startsWith(p)) || EMBALAGEM.test(semAcento(n.descricao))
}

/**
 * Camada 3: as peças trocáveis do produto = nós de 1º e 2º nível que são subconjunto montado (têm filhos) ou têm
 * código PMO*, fora PRT*/RWSV*/embalagem. O nó PRT não entra, mas os filhos dele são olhados (até o 2º nível);
 * serviço e embalagem não são abertos. Folha sem PMO* (parafuso, componente) fica fora. Sem repetir código.
 */
export function pecasTrocaveis(arvore: NoEstrutura[]): NoEstrutura[] {
  const saida = new Map<string, NoEstrutura>()
  const fila: { n: NoEstrutura; nivel: number }[] = arvore.map((n) => ({ n, nivel: 1 }))
  while (fila.length > 0) {
    const { n, nivel } = fila.shift()!
    const ehPrt = n.codigo.startsWith('PRT')
    if (foraDaLista(n) && !ehPrt) continue
    if (!foraDaLista(n) && (n.filhos.length > 0 || n.codigo.startsWith('PMO')) && !saida.has(n.codigo)) saida.set(n.codigo, n)
    if (nivel < 2) fila.push(...n.filhos.map((f) => ({ n: f, nivel: nivel + 1 })))
  }
  return [...saida.values()]
}

/** Todos os códigos da árvore, em qualquer nível. */
export function codigosDaArvore(arvore: NoEstrutura[]): Set<string> {
  const s = new Set<string>()
  const andar = (ns: NoEstrutura[]) => ns.forEach((n) => { s.add(n.codigo); andar(n.filhos) })
  andar(arvore)
  return s
}

/** Camada 2: o kit serve quando TODOS os componentes de 1º nível dele (sem serviço/embalagem) estão no produto. */
export function kitServe(kit: NoEstrutura[], codigosProduto: Set<string>): boolean {
  const componentes = kit.filter((n) => !n.codigo.startsWith('RWSV') && !EMBALAGEM.test(semAcento(n.descricao)))
  return componentes.length > 0 && componentes.every((n) => codigosProduto.has(n.codigo))
}

function pecaDaLinha(l: Obj): PecaSugerida | null {
  const item = obj(l.item) ?? l
  const codigo = txt(item.codigo).toUpperCase()
  return codigo === '' ? null : { codigo, descricao: txt(item.descricao) }
}

const semRepetir = (xs: (PecaSugerida | null)[]) => {
  const m = new Map<string, PecaSugerida>()
  for (const x of xs) if (x && !m.has(x.codigo)) m.set(x.codigo, x)
  return [...m.values()]
}

/** `findParentsByItemId`: os itens que usam este item na estrutura. */
export function paisDaResposta(resposta: unknown): PecaSugerida[] {
  return semRepetir(listaDe(resposta, 'pais do item').map(pecaDaLinha))
}

/** `itemMovimento/findFilter`: as linhas viram código + descrição (até `limite`). */
export function itensDaBusca(resposta: unknown, limite = 30): PecaSugerida[] {
  return semRepetir(listaDe(resposta, 'busca de itens').map(pecaDaLinha)).slice(0, limite)
}

/** Termo com cara de código (letras + dígito, sem espaço) vai em `codigo`; o resto em `descricao`. */
export function filtroBuscaItem(termo: string, dataIso: string): Record<string, unknown> {
  const t = termo.trim()
  const pareceCodigo = /^[A-Za-z]{2,}[A-Za-z0-9_.-]*\d[A-Za-z0-9_.-]*$/.test(t)
  return { codigo: pareceCodigo ? t.toUpperCase() : '', descricao: pareceCodigo ? '' : t, data: dataIso, exibeItensComSaldoZerado: true }
}
```

- [ ] **Step 5: Implementar os métodos do cliente**

Em `src/modules/compels/infra/cliente.ts`, dentro da classe, depois do método `buscarNegociantesPorCodigo`, acrescente:

```ts
  // ---- SAT (spec 2026-11-26-sat-ordem-servico-design.md): SÓ LEITURA ----

  /** Defeitos cadastrados no SAT do Compels (`POST sat/defeito/findAll`, formulário paginado). Só leitura. */
  async listarDefeitosSat(): Promise<Record<string, unknown>[]> {
    const limite = 100
    const todas: Record<string, unknown>[] = []
    for (let pagina = 1; pagina <= 20; pagina++) {
      const resposta = await this.json('/sat/defeito/findAll', this.formulario({
        page: String(pagina), start: String((pagina - 1) * limite), limit: String(limite),
      }))
      const linhas = listaDe(resposta, 'defeitos do SAT')
      todas.push(...linhas)
      const total = (resposta as { totalCount?: unknown } | null)?.totalCount
      if (linhas.length < limite || (typeof total === 'number' && todas.length >= total)) break
    }
    return todas
  }

  /** A composição (estrutura) de um item pelo código (`POST composicaoProduto/findByCodigoItem`). Só leitura. */
  composicaoDoItem(codigo: string): Promise<unknown> {
    return this.json('/composicaoProduto/findByCodigoItem', this.formulario({ codigoItem: codigo.trim() }))
  }

  /** A árvore inteira de uma composição (`POST composicaoProduto/findComposicaoByIdEntireTree`). Só leitura. */
  arvoreDaComposicao(id: number): Promise<unknown> {
    return this.json('/composicaoProduto/findComposicaoByIdEntireTree', this.formulario({ id: String(id) }))
  }

  /** Os itens que usam este item na estrutura (`GET composicaoProduto/findParentsByItemId/<id>`). Só leitura. */
  paisDoItem(itemId: number): Promise<unknown> {
    return this.json(`/composicaoProduto/findParentsByItemId/${itemId}`)
  }

  /**
   * Busca no cadastro de itens pela tela Movimento de Item (`itemMovimento/findFilter`), a mesma de
   * `consultarSaldoItem`. Só leitura. O filtro vem pronto (`filtroBuscaItem` no domínio do SAT).
   */
  buscarItens(filtro: Record<string, unknown>): Promise<unknown> {
    return this.json('/itemMovimento/findFilter', this.formulario({
      filter: JSON.stringify(filtro), page: '1', start: '0', limit: '30',
    }))
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/modules/sat/domain/__tests__/estrutura.test.ts src/modules/compels/infra/__tests__/cliente.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Script de conferência (só leitura) e o `.mjs` gerado**

Crie `tools/compels/sat-estrutura.ts`:

```ts
/**
 * CONFERÊNCIA (SÓ LEITURA) das leituras do Compels que a manutenção do SAT usa (plano 2026-11-26, Tarefa 7):
 *   1. composicaoProduto/findByCodigoItem → id da composição do PRODUTO;
 *   2. findComposicaoByIdEntireTree → a árvore; imprime as chaves do 1º nó cru e a camada 3 (peças trocáveis);
 *   3. --pais: findParentsByItemId dos 5 primeiros trocáveis que têm item.id, e os PMOE* entre os pais;
 *   4. --busca TERMO: itemMovimento/findFilter com o termo (confere se a busca é PARCIAL: "fonte" acha "FONTE 12V").
 * Nunca grava nada, nunca imprime senha nem token.
 *
 * Uso: node tools/compels/sat-estrutura.mjs PRODUTO [--pais] [--busca TERMO]      (ex.: PMOC31 --pais --busca fonte)
 * Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (opcionais: COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL,
 * COMPELS_API_URL) — as mesmas do .env.production.
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/sat-estrutura.ts --file tools/compels/sat-estrutura.mjs --format esm --platform node
 */
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente } from '../../src/modules/compels/infra/config'
import {
  arvoreDaResposta, filtroBuscaItem, idDaComposicao, itensDaBusca, paisDaResposta, pecasTrocaveis,
} from '../../src/modules/sat/domain/estrutura'

const args = process.argv.slice(2)
const produto = (args.find((a) => !a.startsWith('--')) ?? '').trim().toUpperCase()
const comPais = args.includes('--pais')
const iBusca = args.indexOf('--busca')
const termo = iBusca >= 0 ? (args[iBusca + 1] ?? '').trim() : ''

if (!produto) {
  console.log('uso: node tools/compels/sat-estrutura.mjs PRODUTO [--pais] [--busca TERMO]')
  process.exit(1)
}

const cliente = new ClienteCompels(configDoAmbiente())

const cru = await cliente.composicaoDoItem(produto)
console.log(`findByCodigoItem(${produto}): chaves do topo = ${Object.keys((cru ?? {}) as object).join(', ')}`)
const id = idDaComposicao(cru)
if (id === null) {
  console.log('  → sem id de composição (o produto não tem estrutura OU o formato é outro). Resposta crua (1.000 caracteres):')
  console.log(JSON.stringify(cru).slice(0, 1000))
  process.exit(2)
}
console.log(`  → id da composição: ${id}`)

const arvoreCrua = await cliente.arvoreDaComposicao(id)
const filhos = (arvoreCrua as { children?: unknown[] } | null)?.children ?? []
console.log(`findComposicaoByIdEntireTree(${id}): ${filhos.length} nó(s) na raiz; chaves do 1º nó = ${Object.keys((filhos[0] ?? {}) as object).join(', ')}`)
console.log(`  chaves do item do 1º nó = ${Object.keys(((filhos[0] as { item?: object } | undefined)?.item ?? {}) as object).join(', ')}`)
const arvore = arvoreDaResposta(arvoreCrua, produto)
const trocaveis = pecasTrocaveis(arvore)
console.log(`Camada 3 (peças trocáveis): ${trocaveis.length}`)
for (const n of trocaveis) console.log(`  ${n.codigo.padEnd(12)} ${n.descricao}  (item.id ${n.itemId ?? '—'}, ${n.filhos.length} filho(s))`)
console.log('1º nível inteiro (para conferir a regra):')
for (const n of arvore) console.log(`  ${n.codigo.padEnd(12)} ${n.descricao}  (${n.filhos.length} filho(s))`)

if (comPais) {
  for (const n of trocaveis.filter((t) => t.itemId !== null).slice(0, 5)) {
    const pais = paisDaResposta(await cliente.paisDoItem(n.itemId!))
    const kits = pais.filter((p) => p.codigo.startsWith('PMOE'))
    console.log(`pais de ${n.codigo}: ${pais.length} (PMOE*: ${kits.map((k) => k.codigo).join(', ') || 'nenhum'})`)
  }
}

if (termo) {
  const hoje = new Date().toISOString().slice(0, 10) + 'T00:00:00'
  const itens = itensDaBusca(await cliente.buscarItens(filtroBuscaItem(termo, hoje)), 10)
  console.log(`busca "${termo}": ${itens.length} item(ns)`)
  for (const i of itens) console.log(`  ${i.codigo.padEnd(12)} ${i.descricao}`)
}
```

Gere o `.mjs` e confira que ele roda sem credencial (deve falhar dizendo quais variáveis faltam):

```bash
npx rolldown tools/compels/sat-estrutura.ts --file tools/compels/sat-estrutura.mjs --format esm --platform node
env -u COMPELS_EZPOINT_USUARIO -u COMPELS_EZPOINT_SENHA node tools/compels/sat-estrutura.mjs PMOC31; echo "saída=$?"
```
Expected: `ConfiguracaoIncompleta: Faltam variáveis de ambiente do Compels: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA.` e `saída=1`.

> **Conferência real (o usuário roda, só leitura, na instância AWS com as `COMPELS_*` do `.env.production`):**
> `node tools/compels/sat-estrutura.mjs PMOC31 --pais --busca fonte` e `node tools/compels/sat-estrutura.mjs PMOC31 --busca PRT70`.
> O que olhar: (a) saiu um id de composição — senão o `findByCodigoItem` quer outro formato (JSON em vez de formulário: trocar `this.formulario({ codigoItem })` por `{ method: 'POST', body: JSON.stringify({ codigoItem }) }` em `composicaoDoItem`); (b) as chaves do item do 1º nó incluem `id` (senão a parte "pais" da camada 2 fica sem efeito e só os kits já usados contam); (c) a camada 3 lista placas/fonte/módulos/gabinete — se as placas montadas forem `PRT*`, tirar `'PRT'` de `PREFIXOS_FORA_DA_LISTA`; (d) "fonte" acha itens com FONTE na descrição e "PRT70" acha PRT70x — se a busca só aceitar o código exato, a camada 4 vira "código exato" (ajuste só em `filtroBuscaItem`). Anote o resultado no PR.

- [ ] **Step 8: Commit**

```bash
git add src/modules/sat/domain/estrutura.ts src/modules/sat/domain/__tests__/estrutura.test.ts src/modules/compels/infra/cliente.ts src/modules/compels/infra/__tests__/cliente.test.ts tools/compels/sat-estrutura.ts tools/compels/sat-estrutura.mjs
git commit -m "feat(sat): leituras do Compels para a lista de peças (estrutura, pais, busca) + conferência só-leitura

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Carga dos defeitos do Compels (script que gera o SQL)

**Files:**
- Create: `src/modules/sat/domain/defeitos-compels.ts`
- Create: `tools/compels/defeitos-sat.ts` e o gerado `tools/compels/defeitos-sat.mjs`
- Test: `src/modules/sat/domain/__tests__/defeitos-compels.test.ts`

**Interfaces:**
- Consumes: `ClienteCompels.listarDefeitosSat()` (Tarefa 7); tabela `sat_defeitos` (Tarefa 2; `codigo_compels` único).
- Produces: `interface DefeitoCompels { codigo: string; descricao: string }`, `defeitosDaResposta(linhas: Record<string, unknown>[]): DefeitoCompels[]`, `sqlDaCargaDeDefeitos(defeitos: DefeitoCompels[], quando: Date): string`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/sat/domain/__tests__/defeitos-compels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defeitosDaResposta, sqlDaCargaDeDefeitos } from '../defeitos-compels'

describe('defeitosDaResposta', () => {
  it('usa codigo (ou id) e descricao (ou nome); limpa espaços e quebras; sem repetir código', () => {
    expect(defeitosDaResposta([
      { id: 7, codigo: ' 01 ', descricao: ' NÃO\nLIGA ' },
      { id: 8, nome: 'Display apagado' },
      { id: 9, codigo: '01', descricao: 'repetido' },
    ])).toEqual([
      { codigo: '01', descricao: 'NÃO LIGA' },
      { codigo: '8', descricao: 'Display apagado' },
    ])
  })
  it('linha sem código ou sem descrição: resposta inesperada (com os campos que vieram)', () => {
    expect(() => defeitosDaResposta([{ ativo: true }])).toThrow(/defeito do SAT.*ativo/)
  })
  it('lista vazia: resposta inesperada (o Compels tem 88)', () => {
    expect(() => defeitosDaResposta([])).toThrow(/nenhum defeito/)
  })
})

describe('sqlDaCargaDeDefeitos', () => {
  it('um insert idempotente, com aspas escapadas e o cabeçalho', () => {
    const sql = sqlDaCargaDeDefeitos([{ codigo: '01', descricao: "Cabo d'água" }, { codigo: '02', descricao: 'Tela' }],
      new Date('2026-11-26T15:00:00Z'))
    expect(sql).toContain('-- 2 defeitos lidos do Compels em 2026-11-26T15:00:00.000Z')
    expect(sql).toContain("insert into public.sat_defeitos as d (codigo_compels, descricao) values\n  ('01', 'Cabo d''água'),\n  ('02', 'Tela')\n")
    expect(sql).toContain('on conflict (codigo_compels) do update set descricao = excluded.descricao, atualizado_em = now()')
    expect(sql).toContain('where d.descricao is distinct from excluded.descricao;')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/sat/domain/__tests__/defeitos-compels.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../defeitos-compels"`.

- [ ] **Step 3: Implementar**

Crie `src/modules/sat/domain/defeitos-compels.ts` (imports relativos — entra no bundle do script):

```ts
import { RespostaInesperada } from '../../compels/domain/leituras-erp'

/**
 * Carga única dos defeitos do SAT do Compels (`sat/defeito/findAll`) em `sat_defeitos` (spec 2026-11-26, decisão 7).
 * A migração não fala com o Compels: o script `tools/compels/defeitos-sat.mjs` lê e IMPRIME o SQL, que é aplicado
 * com `psql -1 -f` (Dev e RDS). Reaplicar não duplica: o código do Compels é a chave.
 */
export interface DefeitoCompels {
  codigo: string
  descricao: string
}

const texto = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim()

export function defeitosDaResposta(linhas: Record<string, unknown>[]): DefeitoCompels[] {
  if (linhas.length === 0) throw new RespostaInesperada('nenhum defeito do SAT veio do Compels')
  const porCodigo = new Map<string, DefeitoCompels>()
  for (const l of linhas) {
    const codigo = texto(l.codigo ?? l.id)
    const descricao = texto(l.descricao ?? l.nome)
    if (codigo === '' || descricao === '') {
      throw new RespostaInesperada(`defeito do SAT sem código ou descrição (campos: ${Object.keys(l).join(', ')})`)
    }
    if (!porCodigo.has(codigo)) porCodigo.set(codigo, { codigo, descricao: descricao.slice(0, 300) })
  }
  return [...porCodigo.values()]
}

const sql = (s: string) => `'${s.replace(/'/g, "''")}'`

export function sqlDaCargaDeDefeitos(defeitos: DefeitoCompels[], quando: Date): string {
  const valores = defeitos.map((d) => `  (${sql(d.codigo)}, ${sql(d.descricao)})`).join(',\n')
  return [
    `-- ${defeitos.length} defeitos lidos do Compels em ${quando.toISOString()} (tools/compels/defeitos-sat.mjs).`,
    '-- Aplicar com: psql -1 -v ON_ERROR_STOP=1 -f <este arquivo>. Reaplicar não duplica (código do Compels).',
    'insert into public.sat_defeitos as d (codigo_compels, descricao) values',
    valores,
    'on conflict (codigo_compels) do update set descricao = excluded.descricao, atualizado_em = now()',
    ' where d.descricao is distinct from excluded.descricao;',
    '',
  ].join('\n')
}
```

Crie `tools/compels/defeitos-sat.ts`:

```ts
/**
 * Gera o SQL de carga dos defeitos do SAT (Compels `sat/defeito/findAll`, SÓ LEITURA) para `sat_defeitos` (0198).
 * Imprime o SQL na saída padrão; contagem e avisos vão para a saída de erro. Nunca imprime senha nem token.
 *
 * Uso: node tools/compels/defeitos-sat.mjs [--amostra] > defeitos-sat.sql
 *   --amostra: mostra (na saída de erro) a 1ª linha crua, para conferir os nomes dos campos.
 * Variáveis: COMPELS_EZPOINT_USUARIO, COMPELS_EZPOINT_SENHA (opcionais: COMPELS_EZPOINT_EMPRESA, COMPELS_EZPOINT_URL,
 * COMPELS_API_URL) — as mesmas do .env.production.
 *
 * O `.mjs` ao lado é GERADO. Para gerar de novo:
 *   npx rolldown tools/compels/defeitos-sat.ts --file tools/compels/defeitos-sat.mjs --format esm --platform node
 */
import { ClienteCompels } from '../../src/modules/compels/infra/cliente'
import { configDoAmbiente } from '../../src/modules/compels/infra/config'
import { defeitosDaResposta, sqlDaCargaDeDefeitos } from '../../src/modules/sat/domain/defeitos-compels'

const amostra = process.argv.slice(2).includes('--amostra')
const linhas = await new ClienteCompels(configDoAmbiente()).listarDefeitosSat()
if (amostra) console.error(JSON.stringify(linhas[0] ?? null, null, 2))
const defeitos = defeitosDaResposta(linhas)
console.error(`${defeitos.length} defeitos lidos do Compels.`)
process.stdout.write(sqlDaCargaDeDefeitos(defeitos, new Date()))
```

- [ ] **Step 4: Rodar e ver passar; gerar o `.mjs`**

Run: `npx vitest run src/modules/sat/domain/__tests__/defeitos-compels.test.ts --maxWorkers=2`
Expected: PASS.

```bash
npx rolldown tools/compels/defeitos-sat.ts --file tools/compels/defeitos-sat.mjs --format esm --platform node
env -u COMPELS_EZPOINT_USUARIO -u COMPELS_EZPOINT_SENHA node tools/compels/defeitos-sat.mjs > /dev/null; echo "saída=$?"
```
Expected: `ConfiguracaoIncompleta: Faltam variáveis de ambiente do Compels: ...` e `saída=1`.

> **Operação (o usuário roda, na instância AWS, com as `COMPELS_*` do `.env.production`; depois da 0198 aplicada):**
> `node tools/compels/defeitos-sat.mjs --amostra > defeitos-sat.sql` — confere na tela que vieram 88 defeitos e os nomes dos campos; aplica `defeitos-sat.sql` no Dev (SQL Editor) e no RDS com o mesmo comando `psql ... -1 -v ON_ERROR_STOP=1 -f` da migração. O arquivo gerado não vai para o git.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sat/domain/defeitos-compels.ts src/modules/sat/domain/__tests__/defeitos-compels.test.ts tools/compels/defeitos-sat.ts tools/compels/defeitos-sat.mjs
git commit -m "feat(sat): script que gera o SQL de carga dos defeitos do Compels (só leitura)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Infra — repositório da OS, cache e leituras do Compels com cache

**Files:**
- Create: `src/modules/sat/infra/ordens-repository.ts`
- Create: `src/modules/sat/infra/cache-compels.ts`
- Create: `src/modules/sat/infra/estrutura-compels.ts`
- Test: `src/modules/sat/infra/__tests__/ordens-repository.test.ts`
- Test: `src/modules/sat/infra/__tests__/cache-compels.test.ts`

**Interfaces:**
- Consumes: Tarefa 2–5 (tabelas e funções da 0198), Tarefa 6 (`Etapa`, `TipoOrdem`, `ehEtapa`, `ehTipo`, `tempoDesde`), Tarefa 7 (`ClienteCompels` novos métodos, `estrutura.ts`), `ErroDoBanco` de `src/modules/sat/infra/repository.ts`, `normalizarNs`/`NsNormalizado`, `clienteCompelsDoFaturamento` de `src/modules/faturamento/infra/compels.ts`, `createServerSupabase` de `@/shared/lib/supabase/server`.
- Produces (usado nas Tarefas 10–14):
  - `ordens-repository.ts`:
    - `interface FiltroOrdens { tipo: '' | TipoOrdem | 'a_definir'; cliente: string; ns: string; de: string; ate: string }`
    - `interface OrdemResumo { id: string; numero: string; etapa: Etapa; etapaDesde: string; tempoNaEtapa: string; tipo: TipoOrdem | null; cliente: string; nsAtual: string; produto: string; ticketNumero: string; tecnicoNome: string; criadoEm: string }`
    - `interface DefeitoDaOrdem { id: string; defeitoId: string; descricao: string; origem: 'manutencao' | 'qualidade'; solucao: string; usuarioNome: string; em: string }`
    - `interface PecaDaOrdem { id: string; codigo: string; descricao: string; quantidade: number; situacao: 'trocada' | 'devolvida'; usuarioNome: string; em: string }`
    - `interface TrocaNs { id: string; nsAntigo: string; nsNovo: string; usuarioNome: string; em: string }`
    - `type EventoOrdemTipo = 'etapa' | 'correcao_etapa' | 'garantia' | 'defeito' | 'peca' | 'laudo' | 'ns'`
    - `interface EventoOrdem { evento: EventoOrdemTipo; etapaDe: Etapa | null; etapaPara: Etapa | null; dados: Record<string, unknown>; usuarioNome: string; em: string }`
    - `interface OrdemDetalhe extends OrdemResumo { entradaId: string | null; garantia: string; cnpj: string; laudo: string; nf: { numero: string; situacao: 'aprovada' | 'reprovada' } | null; defeitos: DefeitoDaOrdem[]; pecas: PecaDaOrdem[]; trocasNs: TrocaNs[]; historico: EventoOrdem[] }`
    - `interface DefeitoSat { id: string; descricao: string; codigoCompels: string | null }`
    - `ordemResumoDaLinha(l: Record<string, unknown>, agora: number): OrdemResumo`, `eventoDaLinha(l): EventoOrdem`
    - `listarOrdens(f: FiltroOrdens, agora?: number): Promise<OrdemResumo[]>`, `lerOrdem(id: string, agora?: number): Promise<OrdemDetalhe | null>`, `ordemDaEntrada(entradaId: string): Promise<{ id: string; numero: string; etapa: Etapa } | null>`, `listarDefeitosAtivos(): Promise<DefeitoSat[]>`, `produtoDaOrdem(id: string): Promise<string | null>`, `pecasMaisUsadas(produto: string): Promise<PecaSugerida[]>`, `kitsConhecidos(): Promise<PecaSugerida[]>`
    - gravações (todas `Promise<void>`, erro do banco → `ErroDoBanco(código)`): `iniciarManutencao(ordemId)`, `adicionarDefeito(ordemId, defeitoId, solucao)`, `removerDefeito(itemId)`, `adicionarPeca(ordemId, { codigo, descricao, quantidade })`, `removerPeca(itemId)`, `salvarLaudo(ordemId, laudo)`, `trocarNs(ordemId, ns: NsNormalizado)`, `enviarQualidade(ordemId)`, `corrigirEtapa(ordemId, etapa: Etapa, motivo)`.
  - `cache-compels.ts`: `VALIDADE_CACHE_MS = 7 * 24 * 60 * 60 * 1000`; `interface ArmazemCache { ler(chave: string): Promise<{ dados: unknown; lidoEm: string } | null>; gravar(chave: string, dados: unknown): Promise<void> }`; `lerComCache<T>(chave: string, buscar: () => Promise<T>, armazem: ArmazemCache, agora?: number): Promise<T>`; `armazemDoBanco(): ArmazemCache`.
  - `estrutura-compels.ts`: `class CompelsIndisponivel extends Error`; `leiturasDoCompels(cliente?, armazem?): { estrutura(codigo: string): Promise<NoEstrutura[] | null>; paisDoItem(itemId: number): Promise<PecaSugerida[]>; buscarItens(termo: string): Promise<PecaSugerida[]> }`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/modules/sat/infra/__tests__/cache-compels.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))

import { lerComCache, VALIDADE_CACHE_MS, type ArmazemCache } from '../cache-compels'

const AGORA = Date.parse('2026-11-26T12:00:00Z')
function armazem(guardado: { dados: unknown; lidoEm: string } | null): ArmazemCache & { gravar: ReturnType<typeof vi.fn> } {
  return { ler: vi.fn(async () => guardado), gravar: vi.fn(async () => {}) }
}

describe('lerComCache', () => {
  it('dentro da validade: devolve o guardado e não chama o Compels', async () => {
    const a = armazem({ dados: { arvore: [] }, lidoEm: new Date(AGORA - VALIDADE_CACHE_MS + 60_000).toISOString() })
    const buscar = vi.fn(async () => ({ arvore: null }))
    expect(await lerComCache('estrutura:PMOC31', buscar, a, AGORA)).toEqual({ arvore: [] })
    expect(buscar).not.toHaveBeenCalled()
  })
  it('vencido ou ausente: lê do Compels e grava', async () => {
    const a = armazem({ dados: { arvore: [] }, lidoEm: new Date(AGORA - VALIDADE_CACHE_MS - 1).toISOString() })
    expect(await lerComCache('estrutura:PMOC31', async () => ({ arvore: null }), a, AGORA)).toEqual({ arvore: null })
    expect(a.gravar).toHaveBeenCalledWith('estrutura:PMOC31', { arvore: null })
    const vazio = armazem(null)
    expect(await lerComCache('pais:1', async () => [], vazio, AGORA)).toEqual([])
    expect(vazio.gravar).toHaveBeenCalledWith('pais:1', [])
  })
  it('Compels fora: vale o guardado vencido; sem guardado, o erro sobe', async () => {
    const a = armazem({ dados: [1], lidoEm: '2020-01-01T00:00:00Z' })
    expect(await lerComCache('pais:1', async () => { throw new Error('fora') }, a, AGORA)).toEqual([1])
    await expect(lerComCache('pais:1', async () => { throw new Error('fora') }, armazem(null), AGORA)).rejects.toThrow('fora')
  })
  it('gravar falhou: a leitura vale mesmo assim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = armazem(null)
    a.gravar.mockRejectedValueOnce(new Error('SEM_PERMISSAO'))
    expect(await lerComCache('pais:1', async () => [2], a, AGORA)).toEqual([2])
  })
})
```

Crie `src/modules/sat/infra/__tests__/ordens-repository.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))

import { ErroDoBanco } from '../repository'
import {
  adicionarPeca, corrigirEtapa, enviarQualidade, eventoDaLinha, ordemResumoDaLinha, trocarNs,
} from '../ordens-repository'

afterEach(() => rpc.mockReset())

const AGORA = Date.parse('2026-11-26T15:00:00Z')

describe('ordemResumoDaLinha', () => {
  it('lê a linha da sat_ordens; tipo/etapa desconhecidos não passam', () => {
    expect(ordemResumoDaLinha({
      id: 'o1', numero: '0397/26', etapa: 'em_manutencao', etapa_desde: '2026-11-26T10:00:00Z', tipo: 'em_garantia',
      cliente: 'C', ns_atual: '562-1', produto: 'PMOC31', ticket_numero: '900', tecnico_nome: 'T', criado_em: '2026-11-25T10:00:00Z',
    }, AGORA)).toEqual({
      id: 'o1', numero: '0397/26', etapa: 'em_manutencao', etapaDesde: '2026-11-26T10:00:00Z', tempoNaEtapa: '5 h',
      tipo: 'em_garantia', cliente: 'C', nsAtual: '562-1', produto: 'PMOC31', ticketNumero: '900', tecnicoNome: 'T',
      criadoEm: '2026-11-25T10:00:00Z',
    })
    expect(ordemResumoDaLinha({ etapa: 'qualquer', tipo: 'x' }, AGORA)).toMatchObject({ etapa: 'recebido', tipo: null })
  })
})

describe('eventoDaLinha', () => {
  it('lê o histórico (etapas null quando não é mudança de etapa)', () => {
    expect(eventoDaLinha({ evento: 'peca', etapa_de: null, etapa_para: null, dados: { codigo: 'X' }, usuario_nome: 'U', em: 'E' }))
      .toEqual({ evento: 'peca', etapaDe: null, etapaPara: null, dados: { codigo: 'X' }, usuarioNome: 'U', em: 'E' })
  })
})

describe('gravações', () => {
  it('chamam a função da 0198 com os nomes de parâmetro certos', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await adicionarPeca('o1', { codigo: 'PMOE74', descricao: 'Kit', quantidade: 1.5 })
    expect(rpc).toHaveBeenLastCalledWith('sat_ordem_peca_adicionar', { p_ordem: 'o1', p_codigo: 'PMOE74', p_descricao: 'Kit', p_quantidade: 1.5 })
    await trocarNs('o1', { escrito: '562-9', modelo: '562', sequencia: '9' })
    expect(rpc).toHaveBeenLastCalledWith('sat_ordem_trocar_ns', { p_ordem: 'o1', p: { ns: '562-9', modelo: '562', sequencia: '9' } })
    await corrigirEtapa('o1', 'em_manutencao', 'motivo')
    expect(rpc).toHaveBeenLastCalledWith('sat_ordem_corrigir_etapa', { p_ordem: 'o1', p_etapa: 'em_manutencao', p_motivo: 'motivo' })
  })
  it('erro do banco vira ErroDoBanco com o código', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SEM_LAUDO' } })
    const e = await enviarQualidade('o1').catch((x) => x)
    expect(e).toBeInstanceOf(ErroDoBanco)
    expect(e.message).toBe('SEM_LAUDO')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/sat/infra/__tests__/cache-compels.test.ts src/modules/sat/infra/__tests__/ordens-repository.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../cache-compels"` / `"../ordens-repository"`.

- [ ] **Step 3: Implementar `cache-compels.ts`**

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

/**
 * Cache das leituras do Compels no banco (`sat_compels_cache`, 0198): a estrutura muda pouco, então a tela da
 * manutenção não chama o Compels a cada abertura. Validade de 7 dias; Compels fora do ar → vale o guardado vencido.
 */
export const VALIDADE_CACHE_MS = 7 * 24 * 60 * 60 * 1000

export interface ArmazemCache {
  ler(chave: string): Promise<{ dados: unknown; lidoEm: string } | null>
  gravar(chave: string, dados: unknown): Promise<void>
}

export async function lerComCache<T>(chave: string, buscar: () => Promise<T>, armazem: ArmazemCache, agora = Date.now()): Promise<T> {
  const guardado = await armazem.ler(chave)
  if (guardado && agora - Date.parse(guardado.lidoEm) < VALIDADE_CACHE_MS) return guardado.dados as T
  let novo: T
  try {
    novo = await buscar()
  } catch (e) {
    if (guardado) return guardado.dados as T
    throw e
  }
  try {
    await armazem.gravar(chave, novo)
  } catch (e) {
    console.error('[sat] cache do Compels não gravou:', chave, e instanceof Error ? e.message : e)
  }
  return novo
}

/** Lê pelo RLS (sat.visualizar) e grava pela função `sat_compels_cache_gravar` (sat.manutencao). */
export function armazemDoBanco(): ArmazemCache {
  return {
    async ler(chave) {
      const sb = await createServerSupabase()
      const { data, error } = await sb.from('sat_compels_cache').select('dados, lido_em').eq('chave', chave).maybeSingle()
      if (error) throw new Error(`cache do Compels: ${error.message}`)
      return data ? { dados: (data as { dados: unknown }).dados, lidoEm: String((data as { lido_em: unknown }).lido_em) } : null
    },
    async gravar(chave, dados) {
      const sb = await createServerSupabase()
      const { error } = await sb.rpc('sat_compels_cache_gravar', { p_chave: chave, p_dados: dados })
      if (error) throw new Error(error.message)
    },
  }
}
```

- [ ] **Step 4: Implementar `estrutura-compels.ts`**

```ts
import 'server-only'
import type { ClienteCompels } from '@/modules/compels/infra/cliente'
import { clienteCompelsDoFaturamento } from '@/modules/faturamento/infra/compels'
import {
  arvoreDaResposta, filtroBuscaItem, idDaComposicao, itensDaBusca, paisDaResposta,
  type NoEstrutura, type PecaSugerida,
} from '../domain/estrutura'
import { armazemDoBanco, lerComCache, type ArmazemCache } from './cache-compels'

/** O login do Compels não está neste ambiente (Dev sem `COMPELS_*`): a tela mostra o aviso e segue com a busca. */
export class CompelsIndisponivel extends Error {
  constructor() {
    super('Compels indisponível neste ambiente.')
    this.name = 'CompelsIndisponivel'
  }
}

type LeitorCompels = Pick<ClienteCompels, 'composicaoDoItem' | 'arvoreDaComposicao' | 'paisDoItem' | 'buscarItens'>

/** As leituras do Compels da manutenção (SÓ LEITURA), com cache de 7 dias para estrutura e pais. */
export function leiturasDoCompels(
  cliente: LeitorCompels | null = clienteCompelsDoFaturamento(),
  armazem: ArmazemCache = armazemDoBanco(),
) {
  const exigir = (): LeitorCompels => {
    if (!cliente) throw new CompelsIndisponivel()
    return cliente
  }
  return {
    /** A árvore do produto; `null` = o item não tem estrutura no Compels. */
    async estrutura(codigo: string): Promise<NoEstrutura[] | null> {
      const r = await lerComCache(`estrutura:${codigo}`, async () => {
        const c = exigir()
        const id = idDaComposicao(await c.composicaoDoItem(codigo))
        return { arvore: id === null ? null : arvoreDaResposta(await c.arvoreDaComposicao(id), codigo) }
      }, armazem)
      return r.arvore
    },
    async paisDoItem(itemId: number): Promise<PecaSugerida[]> {
      return lerComCache(`pais:${itemId}`, async () => paisDaResposta(await exigir().paisDoItem(itemId)), armazem)
    },
    /** Camada 4: sem cache (cada busca é um termo novo). */
    async buscarItens(termo: string): Promise<PecaSugerida[]> {
      const hoje = new Date().toISOString().slice(0, 10) + 'T00:00:00'
      return itensDaBusca(await exigir().buscarItens(filtroBuscaItem(termo, hoje)))
    },
  }
}
```

- [ ] **Step 5: Implementar `ordens-repository.ts`**

```ts
import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarNs, type NsNormalizado } from '../domain/numero-serie'
import { ehEtapa, ehTipo, tempoDesde, type Etapa, type TipoOrdem } from '../domain/ordem'
import type { PecaSugerida } from '../domain/estrutura'
import { ErroDoBanco } from './repository'

/**
 * A ordem de serviço do SAT (0198): leitura pelo RLS (`sat.visualizar`); escrita SÓ pelas funções security definer,
 * que conferem a permissão e a etapa de novo no banco.
 */
type Linha = Record<string, unknown>
const txt = (v: unknown) => (typeof v === 'string' ? v : '')
const txtOuNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATA = /^\d{4}-\d{2}-\d{2}$/
const literal = (s: string) => s.replace(/[\\%_*]/g, (c) => `\\${c}`)
const embutido = (v: unknown): Linha | null => ((Array.isArray(v) ? v[0] : v) as Linha | null | undefined) ?? null
const objeto = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const LIMITE_FILA = 500

export interface FiltroOrdens {
  tipo: '' | TipoOrdem | 'a_definir'
  cliente: string
  ns: string
  /** `aaaa-mm-dd` (inclusive), pela data em que a OS nasceu. */
  de: string
  ate: string
}

export interface OrdemResumo {
  id: string
  numero: string
  etapa: Etapa
  etapaDesde: string
  /** "5 h", "3 d" — calculado aqui (fora do componente). */
  tempoNaEtapa: string
  tipo: TipoOrdem | null
  cliente: string
  nsAtual: string
  produto: string
  ticketNumero: string
  tecnicoNome: string
  criadoEm: string
}

export interface DefeitoDaOrdem {
  id: string
  defeitoId: string
  descricao: string
  origem: 'manutencao' | 'qualidade'
  solucao: string
  usuarioNome: string
  em: string
}

export interface PecaDaOrdem {
  id: string
  codigo: string
  descricao: string
  quantidade: number
  situacao: 'trocada' | 'devolvida'
  usuarioNome: string
  em: string
}

export interface TrocaNs {
  id: string
  nsAntigo: string
  nsNovo: string
  usuarioNome: string
  em: string
}

export type EventoOrdemTipo = 'etapa' | 'correcao_etapa' | 'garantia' | 'defeito' | 'peca' | 'laudo' | 'ns'

export interface EventoOrdem {
  evento: EventoOrdemTipo
  etapaDe: Etapa | null
  etapaPara: Etapa | null
  dados: Record<string, unknown>
  usuarioNome: string
  em: string
}

export interface OrdemDetalhe extends OrdemResumo {
  entradaId: string | null
  garantia: string
  cnpj: string
  laudo: string
  nf: { numero: string; situacao: 'aprovada' | 'reprovada' } | null
  defeitos: DefeitoDaOrdem[]
  pecas: PecaDaOrdem[]
  trocasNs: TrocaNs[]
  historico: EventoOrdem[]
}

export interface DefeitoSat {
  id: string
  descricao: string
  codigoCompels: string | null
}

const CAMPOS_RESUMO = 'id, numero, etapa, etapa_desde, tipo, cliente, ns_atual, produto, ticket_numero, tecnico_nome, criado_em'

export function ordemResumoDaLinha(l: Linha, agora: number): OrdemResumo {
  return {
    id: txt(l.id), numero: txt(l.numero), etapa: ehEtapa(l.etapa) ? l.etapa : 'recebido',
    etapaDesde: txt(l.etapa_desde), tempoNaEtapa: tempoDesde(txt(l.etapa_desde), agora),
    tipo: ehTipo(l.tipo) ? l.tipo : null, cliente: txt(l.cliente), nsAtual: txt(l.ns_atual), produto: txt(l.produto),
    ticketNumero: txt(l.ticket_numero), tecnicoNome: txt(l.tecnico_nome), criadoEm: txt(l.criado_em),
  }
}

export function eventoDaLinha(l: Linha): EventoOrdem {
  return {
    evento: txt(l.evento) as EventoOrdemTipo,
    etapaDe: ehEtapa(l.etapa_de) ? l.etapa_de : null,
    etapaPara: ehEtapa(l.etapa_para) ? l.etapa_para : null,
    dados: objeto(l.dados), usuarioNome: txt(l.usuario_nome), em: txt(l.em),
  }
}

// ---------- leitura ----------
export async function listarOrdens(f: FiltroOrdens, agora = Date.now()): Promise<OrdemResumo[]> {
  const sb = await createServerSupabase()
  let q = sb.from('sat_ordens').select(CAMPOS_RESUMO)
  if (f.tipo === 'a_definir') q = q.is('tipo', null)
  else if (ehTipo(f.tipo)) q = q.eq('tipo', f.tipo)
  if (f.cliente.trim() !== '') q = q.ilike('cliente', `%${literal(f.cliente.trim())}%`)
  if (f.ns.trim() !== '') {
    const ns = normalizarNs(f.ns)
    if (ns.sequencia) {
      const ids = await sb.rpc('sat_ordens_do_ns', { p_modelo: ns.modelo, p_sequencia: ns.sequencia })
      if (ids.error) throw new Error(`busca da OS pelo NS: ${ids.error.message}`)
      const lista = ((ids.data ?? []) as unknown[]).map((x) => String(x))
      if (lista.length === 0) return []
      q = q.in('id', lista)
    } else q = q.ilike('ns_atual', `%${literal(f.ns.trim())}%`)
  }
  if (DATA.test(f.de)) q = q.gte('criado_em', `${f.de}T00:00:00-03:00`)
  if (DATA.test(f.ate)) q = q.lte('criado_em', `${f.ate}T23:59:59.999-03:00`)
  const { data, error } = await q.order('etapa_desde', { ascending: true }).order('numero').limit(LIMITE_FILA)
  if (error) throw new Error(`ordens do SAT: ${error.message}`)
  return ((data ?? []) as Linha[]).map((l) => ordemResumoDaLinha(l, agora))
}

export async function lerOrdem(id: string, agora = Date.now()): Promise<OrdemDetalhe | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const sb = await createServerSupabase()
  const o = await sb.from('sat_ordens')
    .select(`${CAMPOS_RESUMO}, entrada_id, garantia, cnpj, laudo, entrada:sat_entradas(nf:sat_nfs(numero, situacao))`)
    .eq('id', id).maybeSingle()
  if (o.error) throw new Error(`OS do SAT: ${o.error.message}`)
  if (!o.data) return null
  const l = o.data as unknown as Linha

  const [d, p, n, h] = await Promise.all([
    sb.from('sat_ordem_defeitos').select('id, defeito_id, defeito_descricao, origem, solucao, usuario_nome, em').eq('ordem_id', id).order('em'),
    sb.from('sat_ordem_pecas').select('id, codigo, descricao, quantidade, situacao, usuario_nome, em').eq('ordem_id', id).order('em'),
    sb.from('sat_ordem_ns').select('id, ns_antigo, ns_novo, usuario_nome, em').eq('ordem_id', id).order('em'),
    sb.from('sat_ordem_historico').select('evento, etapa_de, etapa_para, dados, usuario_nome, em').eq('ordem_id', id).order('seq'),
  ])
  for (const r of [d, p, n, h]) if (r.error) throw new Error(`OS do SAT: ${r.error.message}`)

  const nf = embutido(embutido(l.entrada)?.nf)
  return {
    ...ordemResumoDaLinha(l, agora),
    entradaId: txtOuNull(l.entrada_id), garantia: txt(l.garantia), cnpj: txt(l.cnpj), laudo: txt(l.laudo),
    nf: nf ? { numero: txt(nf.numero), situacao: txt(nf.situacao) === 'aprovada' ? 'aprovada' : 'reprovada' } : null,
    defeitos: ((d.data ?? []) as Linha[]).map((x) => ({
      id: txt(x.id), defeitoId: txt(x.defeito_id), descricao: txt(x.defeito_descricao),
      origem: (txt(x.origem) === 'qualidade' ? 'qualidade' : 'manutencao') as DefeitoDaOrdem['origem'], solucao: txt(x.solucao),
      usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
    pecas: ((p.data ?? []) as Linha[]).map((x) => ({
      id: txt(x.id), codigo: txt(x.codigo), descricao: txt(x.descricao), quantidade: Number(x.quantidade),
      situacao: (txt(x.situacao) === 'devolvida' ? 'devolvida' : 'trocada') as PecaDaOrdem['situacao'],
      usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
    trocasNs: ((n.data ?? []) as Linha[]).map((x) => ({
      id: txt(x.id), nsAntigo: txt(x.ns_antigo), nsNovo: txt(x.ns_novo), usuarioNome: txt(x.usuario_nome), em: txt(x.em),
    })),
    historico: ((h.data ?? []) as Linha[]).map(eventoDaLinha),
  }
}

/** A OS de um relógio recebido (para o link na ficha do equipamento). */
export async function ordemDaEntrada(entradaId: string): Promise<{ id: string; numero: string; etapa: Etapa } | null> {
  if (!UUID.test(entradaId)) return null
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_ordens').select('id, numero, etapa').eq('entrada_id', entradaId).maybeSingle()
  if (error) throw new Error(`OS do relógio: ${error.message}`)
  if (!data) return null
  const l = data as Linha
  return { id: txt(l.id), numero: txt(l.numero), etapa: ehEtapa(l.etapa) ? l.etapa : 'recebido' }
}

export async function listarDefeitosAtivos(): Promise<DefeitoSat[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_defeitos').select('id, descricao, codigo_compels').eq('ativo', true).order('descricao')
  if (error) throw new Error(`defeitos do SAT: ${error.message}`)
  return ((data ?? []) as Linha[]).map((x) => ({ id: txt(x.id), descricao: txt(x.descricao), codigoCompels: txtOuNull(x.codigo_compels) }))
}

export async function produtoDaOrdem(id: string): Promise<string | null> {
  if (!UUID.test(id)) return null
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sat_ordens').select('produto').eq('id', id).maybeSingle()
  if (error) throw new Error(`produto da OS: ${error.message}`)
  return data ? txt((data as Linha).produto) : null
}

const pecas = (data: unknown) => ((data ?? []) as Linha[]).map((x) => ({ codigo: txt(x.codigo), descricao: txt(x.descricao) }))

/** Camada 1: as mais trocadas neste produto no histórico do ShopFloor. */
export async function pecasMaisUsadas(produto: string): Promise<PecaSugerida[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_pecas_mais_usadas', { p_produto: produto, p_limite: 15 })
  if (error) throw new Error(`peças mais usadas: ${error.message}`)
  return pecas(data)
}

/** Candidatos da camada 2: kits PMOE* já usados em alguma OS. */
export async function kitsConhecidos(): Promise<PecaSugerida[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('sat_kits_conhecidos')
  if (error) throw new Error(`kits conhecidos: ${error.message}`)
  return pecas(data)
}

// ---------- gravação (funções da 0198) ----------
async function chamar(funcao: string, args: Record<string, unknown>): Promise<void> {
  const sb = await createServerSupabase()
  const { error } = await sb.rpc(funcao, args)
  if (error) throw new ErroDoBanco(error.message)
}

export const iniciarManutencao = (ordemId: string) => chamar('sat_ordem_iniciar_manutencao', { p_ordem: ordemId })
export const adicionarDefeito = (ordemId: string, defeitoId: string, solucao: string) =>
  chamar('sat_ordem_defeito_adicionar', { p_ordem: ordemId, p_defeito: defeitoId, p_solucao: solucao })
export const removerDefeito = (itemId: string) => chamar('sat_ordem_defeito_remover', { p_item: itemId })
export const adicionarPeca = (ordemId: string, p: { codigo: string; descricao: string; quantidade: number }) =>
  chamar('sat_ordem_peca_adicionar', { p_ordem: ordemId, p_codigo: p.codigo, p_descricao: p.descricao, p_quantidade: p.quantidade })
export const removerPeca = (itemId: string) => chamar('sat_ordem_peca_remover', { p_item: itemId })
export const salvarLaudo = (ordemId: string, laudo: string) => chamar('sat_ordem_laudo_salvar', { p_ordem: ordemId, p_laudo: laudo })
export const trocarNs = (ordemId: string, ns: NsNormalizado) =>
  chamar('sat_ordem_trocar_ns', { p_ordem: ordemId, p: { ns: ns.escrito, modelo: ns.modelo, sequencia: ns.sequencia } })
export const enviarQualidade = (ordemId: string) => chamar('sat_ordem_enviar_qualidade', { p_ordem: ordemId })
export const corrigirEtapa = (ordemId: string, etapa: Etapa, motivo: string) =>
  chamar('sat_ordem_corrigir_etapa', { p_ordem: ordemId, p_etapa: etapa, p_motivo: motivo })
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/modules/sat/infra --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sat/infra/ordens-repository.ts src/modules/sat/infra/cache-compels.ts src/modules/sat/infra/estrutura-compels.ts src/modules/sat/infra/__tests__/ordens-repository.test.ts src/modules/sat/infra/__tests__/cache-compels.test.ts
git commit -m "feat(sat): repositório da OS e leituras do Compels com cache de 7 dias

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: As 4 camadas da lista de peças

**Files:**
- Create: `src/modules/sat/application/pecas-sugeridas.ts`
- Test: `src/modules/sat/application/__tests__/pecas-sugeridas.test.ts`

**Interfaces:**
- Consumes: `codigoDoProduto` (Tarefa 6); `NoEstrutura`, `PecaSugerida`, `pecasTrocaveis`, `codigosDaArvore`, `kitServe` (Tarefa 7).
- Produces:
  - `interface DepsPecas { maisUsadas(produto: string): Promise<PecaSugerida[]>; kitsConhecidos(): Promise<PecaSugerida[]>; estrutura(codigo: string): Promise<NoEstrutura[] | null>; paisDoItem(itemId: number): Promise<PecaSugerida[]> }`
  - `interface CamadasPecas { maisUsadas: PecaSugerida[]; kits: PecaSugerida[]; estrutura: PecaSugerida[]; avisos: string[] }`
  - `pecasSugeridas(produto: string, deps: DepsPecas): Promise<CamadasPecas>`; `MAX_NOS_PARA_PAIS = 30`; `MAX_KITS_AVALIADOS = 20`.
  - A camada 4 (busca) NÃO passa por aqui: é `leiturasDoCompels().buscarItens` direto (Tarefa 11).

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/sat/application/__tests__/pecas-sugeridas.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { NoEstrutura } from '../../domain/estrutura'
import { pecasSugeridas, type DepsPecas } from '../pecas-sugeridas'

const n = (codigo: string, descricao: string, itemId: number | null, filhos: NoEstrutura[] = []): NoEstrutura =>
  ({ codigo, descricao, itemId, filhos })
// Produto FICTÍCIO: módulo bio (com leitor e cabo), fonte, gabinete.
const PRODUTO: NoEstrutura[] = [
  n('PMOX01', 'MODULO BIO', 11, [n('BIO001', 'LEITOR', 12), n('CB001', 'CABO', 13)]),
  n('FT100', 'FONTE', 21, [n('TR1', 'TRAFO', 22)]),
  n('GB001', 'GABINETE', 31, [n('RWSV10', 'INJECAO', 32)]),
]
const KITS: Record<string, NoEstrutura[]> = {
  PMOE74: [n('BIO001', 'LEITOR', 12), n('CB001', 'CABO', 13)],   // serve
  PMOE99: [n('BIO001', 'LEITOR', 12), n('OUTRO', 'X', 99)],      // não serve
  PMOE12: [n('FT100', 'FONTE', 21)],                             // serve (veio do histórico)
}

function deps(extra: Partial<DepsPecas> = {}): DepsPecas {
  return {
    maisUsadas: vi.fn(async () => [{ codigo: 'FT100', descricao: 'FONTE' }, { codigo: 'PRT706', descricao: 'PLACA' }]),
    kitsConhecidos: vi.fn(async () => [{ codigo: 'PMOE12', descricao: 'KIT FONTE' }, { codigo: 'PRT1', descricao: 'NÃO É KIT' }]),
    estrutura: vi.fn(async (c: string) => (c === 'PMOC31' ? PRODUTO : KITS[c] ?? null)),
    paisDoItem: vi.fn(async (id: number) => (id === 11
      ? [{ codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' }, { codigo: 'PMOE99', descricao: 'KIT X' }, { codigo: 'PMOC31', descricao: 'REL' }]
      : [])),
    ...extra,
  }
}

describe('pecasSugeridas', () => {
  it('as 3 camadas, sem repetir código (fica na primeira em que aparece)', async () => {
    const r = await pecasSugeridas(' pmoc31 ', deps())
    expect(r.maisUsadas.map((p) => p.codigo)).toEqual(['FT100', 'PRT706'])
    expect(r.kits).toEqual([{ codigo: 'PMOE12', descricao: 'KIT FONTE' }, { codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' }])
    expect(r.estrutura.map((p) => p.codigo)).toEqual(['PMOX01', 'GB001'])
    expect(r.avisos).toEqual([])
  })

  it('produto sem código do Compels: só a camada 1 e um aviso', async () => {
    const d = deps()
    const r = await pecasSugeridas('REP iDClass', d)
    expect(r.kits).toEqual([])
    expect(r.estrutura).toEqual([])
    expect(r.avisos).toEqual(['O produto desta OS não é um código do Compels: as camadas de kits e de estrutura ficam vazias. Use a busca.'])
    expect(d.estrutura).not.toHaveBeenCalled()
  })

  it('produto sem estrutura no Compels: aviso', async () => {
    const r = await pecasSugeridas('PMOZ00', deps({ estrutura: vi.fn(async () => null) }))
    expect(r.avisos).toEqual(['O produto PMOZ00 não tem estrutura no Compels.'])
  })

  it('Compels fora: aviso e segue com o que tem', async () => {
    const r = await pecasSugeridas('PMOC31', deps({ estrutura: vi.fn(async () => { throw new Error('fora') }) }))
    expect(r.maisUsadas).toHaveLength(2)
    expect(r.avisos).toEqual(['Não foi possível ler a estrutura do produto no Compels agora. Use a busca.'])
  })

  it('pais falhando não derruba: os kits do histórico continuam', async () => {
    const r = await pecasSugeridas('PMOC31', deps({ paisDoItem: vi.fn(async () => { throw new Error('fora') }) }))
    expect(r.kits.map((k) => k.codigo)).toEqual(['PMOE12'])
    expect(r.avisos).toEqual(['Não foi possível procurar todos os kits no Compels agora.'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/sat/application/__tests__/pecas-sugeridas.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../pecas-sugeridas"`.

- [ ] **Step 3: Implementar**

Crie `src/modules/sat/application/pecas-sugeridas.ts`:

```ts
import { codigoDoProduto } from '../domain/ordem'
import { codigosDaArvore, kitServe, pecasTrocaveis, type NoEstrutura, type PecaSugerida } from '../domain/estrutura'

/**
 * A lista de peças da manutenção, camadas 1 a 3 (spec 2026-11-26, decisão 6; a 4 é a busca):
 *   1. as mais trocadas neste produto (histórico do ShopFloor; o do Compels chega na entrega 6);
 *   2. os kits de reposição (PMOE*) que servem ao produto: candidatos = kits já usados + pais PMOE* das peças
 *      trocáveis; serve quando todos os componentes do kit estão na árvore do produto (calculado, ninguém cadastra);
 *   3. as peças trocáveis da estrutura (regra em `pecasTrocaveis`).
 * Um código aparece só na primeira camada em que entra. Falha do Compels vira aviso, nunca erro da tela.
 */
export interface DepsPecas {
  maisUsadas(produto: string): Promise<PecaSugerida[]>
  kitsConhecidos(): Promise<PecaSugerida[]>
  estrutura(codigo: string): Promise<NoEstrutura[] | null>
  paisDoItem(itemId: number): Promise<PecaSugerida[]>
}

export interface CamadasPecas {
  maisUsadas: PecaSugerida[]
  kits: PecaSugerida[]
  estrutura: PecaSugerida[]
  avisos: string[]
}

export const MAX_NOS_PARA_PAIS = 30
export const MAX_KITS_AVALIADOS = 20
const EM_PARALELO = 5

async function emLotes<T, R>(itens: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = []
  for (let i = 0; i < itens.length; i += EM_PARALELO) saida.push(...(await Promise.all(itens.slice(i, i + EM_PARALELO).map(fn))))
  return saida
}

function semRepetir(camadas: PecaSugerida[][]): PecaSugerida[][] {
  const vistos = new Set<string>()
  return camadas.map((c) => c.filter((p) => {
    if (vistos.has(p.codigo)) return false
    vistos.add(p.codigo)
    return true
  }))
}

export async function pecasSugeridas(produto: string, deps: DepsPecas): Promise<CamadasPecas> {
  const avisos: string[] = []
  const maisUsadas = await deps.maisUsadas(produto.trim()).catch(() => [] as PecaSugerida[])
  const fim = (kits: PecaSugerida[], estrutura: PecaSugerida[]): CamadasPecas => {
    const [a, b, c] = semRepetir([maisUsadas, kits, estrutura])
    return { maisUsadas: a!, kits: b!, estrutura: c!, avisos }
  }

  const codigo = codigoDoProduto(produto)
  if (!codigo) {
    avisos.push('O produto desta OS não é um código do Compels: as camadas de kits e de estrutura ficam vazias. Use a busca.')
    return fim([], [])
  }

  let arvore: NoEstrutura[] | null
  try {
    arvore = await deps.estrutura(codigo)
  } catch {
    avisos.push('Não foi possível ler a estrutura do produto no Compels agora. Use a busca.')
    return fim([], [])
  }
  if (arvore === null) {
    avisos.push(`O produto ${codigo} não tem estrutura no Compels.`)
    return fim([], [])
  }

  const trocaveis = pecasTrocaveis(arvore)
  const codigosProduto = codigosDaArvore(arvore)

  // candidatos a kit: os já usados + os pais PMOE* das peças trocáveis
  const candidatos = new Map<string, string>()
  for (const k of await deps.kitsConhecidos().catch(() => [] as PecaSugerida[])) {
    if (k.codigo.startsWith('PMOE')) candidatos.set(k.codigo, k.descricao)
  }
  const falhas = { pais: false }
  const comId = trocaveis.filter((t) => t.itemId !== null).slice(0, MAX_NOS_PARA_PAIS)
  const pais = await emLotes(comId, (t) => deps.paisDoItem(t.itemId!).catch(() => {
    falhas.pais = true
    return [] as PecaSugerida[]
  }))
  for (const p of pais.flat()) if (p.codigo.startsWith('PMOE') && !candidatos.has(p.codigo)) candidatos.set(p.codigo, p.descricao)
  if (falhas.pais) avisos.push('Não foi possível procurar todos os kits no Compels agora.')
  candidatos.delete(codigo)

  const avaliar = [...candidatos.keys()].sort().slice(0, MAX_KITS_AVALIADOS)
  const servem = await emLotes(avaliar, async (k) => {
    try {
      const a = await deps.estrutura(k)
      return a !== null && kitServe(a, codigosProduto)
    } catch {
      return false
    }
  })
  const kits = avaliar.filter((_, i) => servem[i]).map((k) => ({ codigo: k, descricao: candidatos.get(k) ?? '' }))
  const estrutura = trocaveis.map((t) => ({ codigo: t.codigo, descricao: t.descricao }))
  return fim(kits, estrutura)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/sat/application/__tests__/pecas-sugeridas.test.ts --maxWorkers=2`
Expected: PASS.

> Conferência do 1º teste: camada 1 = FT100, PRT706. Kits avaliados (ordem alfabética) = PMOE12 (histórico; FT100 está no produto → serve), PMOE74 (pai do 11; BIO001+CB001 → serve), PMOE99 (OUTRO não está → não serve); PMOC31 é o próprio produto e PRT1 não é PMOE. Camada 3 = PMOX01, FT100, GB001 → FT100 já saiu na camada 1 → sobram PMOX01, GB001.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sat/application/pecas-sugeridas.ts src/modules/sat/application/__tests__/pecas-sugeridas.test.ts
git commit -m "feat(sat): lista de peças da manutenção em camadas (mais usadas, kits que servem, estrutura)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Server actions da OS

**Files:**
- Create: `src/modules/sat/application/ordens-actions.ts`
- Test: `src/modules/sat/application/__tests__/ordens-actions.test.ts`

**Interfaces:**
- Consumes: Tarefa 6 (validações, `Etapa`), Tarefa 9 (repositório, `leiturasDoCompels`, `CompelsIndisponivel`), Tarefa 10 (`pecasSugeridas`, `CamadasPecas`), `mensagemDoErro` (Tarefa 6), `ErroDoBanco` de `../infra/repository`, `getSessao`, `podeNoModulo`.
- Produces (todas `'use server'`, devolvem `ResultadoAcao<T> = { ok: true; valor: T } | { ok: false; erro: string }`; usadas nas Tarefas 13 e 14):
  - `iniciarManutencaoAction(ordemId: string): Promise<ResultadoAcao<null>>`
  - `adicionarDefeitoAction(ordemId: string, defeitoId: string, solucao: string): Promise<ResultadoAcao<null>>`
  - `removerDefeitoAction(ordemId: string, itemId: string): Promise<ResultadoAcao<null>>`
  - `adicionarPecaAction(ordemId: string, p: { codigo: string; descricao: string; quantidade: string }): Promise<ResultadoAcao<null>>`
  - `removerPecaAction(ordemId: string, itemId: string): Promise<ResultadoAcao<null>>`
  - `salvarLaudoAction(ordemId: string, laudo: string): Promise<ResultadoAcao<null>>`
  - `trocarNsAction(ordemId: string, ns: string): Promise<ResultadoAcao<null>>`
  - `enviarQualidadeAction(ordemId: string): Promise<ResultadoAcao<null>>`
  - `corrigirEtapaAction(ordemId: string, etapa: string, motivo: string): Promise<ResultadoAcao<null>>` (`sat.administrar`)
  - `pecasSugeridasAction(ordemId: string): Promise<ResultadoAcao<CamadasPecas>>`
  - `buscarItensAction(termo: string): Promise<ResultadoAcao<PecaSugerida[]>>`
  - Todas exigem `sat.visualizar` + `sat.manutencao`, menos `corrigirEtapaAction` (`sat.visualizar` + `sat.administrar`).

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/sat/application/__tests__/ordens-actions.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const erros = vi.hoisted(() => ({ ErroDoBanco: class ErroDoBanco extends Error {} }))
vi.mock('../../infra/repository', () => erros)
const repo = vi.hoisted(() => ({
  iniciarManutencao: vi.fn(async () => {}), adicionarDefeito: vi.fn(async () => {}), removerDefeito: vi.fn(async () => {}),
  adicionarPeca: vi.fn(async () => {}), removerPeca: vi.fn(async () => {}), salvarLaudo: vi.fn(async () => {}),
  trocarNs: vi.fn(async () => {}), enviarQualidade: vi.fn(async () => {}), corrigirEtapa: vi.fn(async () => {}),
  produtoDaOrdem: vi.fn(async () => 'PMOC31'),
  pecasMaisUsadas: vi.fn(async () => []), kitsConhecidos: vi.fn(async () => []),
}))
vi.mock('../../infra/ordens-repository', () => repo)
const compels = vi.hoisted(() => ({
  estrutura: vi.fn(async () => null), paisDoItem: vi.fn(async () => []),
  buscarItens: vi.fn(async () => [{ codigo: 'PRT706', descricao: 'PLACA' }]),
}))
const CompelsIndisponivel = vi.hoisted(() => class CompelsIndisponivel extends Error {})
vi.mock('../../infra/estrutura-compels', () => ({ leiturasDoCompels: () => compels, CompelsIndisponivel }))

function sessao(sat: Record<string, boolean>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', nome: 'S', email: 's@x', perfil: { porModulo: { sat }, permissoes: {} } }),
  }))
}

const OS = '00000000-0000-0000-0000-0000000000a1'
const DEF = '00000000-0000-0000-0000-0000000000d1'
const SEM_PERMISSAO = { ok: false, erro: 'Você não tem permissão para esta ação.' }
const OK = { ok: true, valor: null }

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('actions da OS — permissão', () => {
  it('sem sat.manutencao: nada grava', async () => {
    sessao({ visualizar: true, administrar: true, aprovar_nf: true })
    const a = await import('../ordens-actions')
    expect(await a.iniciarManutencaoAction(OS)).toEqual(SEM_PERMISSAO)
    expect(await a.adicionarPecaAction(OS, { codigo: 'X1', descricao: '', quantidade: '1' })).toEqual(SEM_PERMISSAO)
    expect(await a.pecasSugeridasAction(OS)).toEqual(SEM_PERMISSAO)
    expect(await a.buscarItensAction('fonte')).toEqual(SEM_PERMISSAO)
    expect(repo.iniciarManutencao).not.toHaveBeenCalled()
    expect(repo.adicionarPeca).not.toHaveBeenCalled()
  })
  it('manutenção sem visualizar: nada grava', async () => {
    sessao({ manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.enviarQualidadeAction(OS)).toEqual(SEM_PERMISSAO)
  })
  it('corrigir etapa só com sat.administrar', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.corrigirEtapaAction(OS, 'em_manutencao', 'motivo ok')).toEqual(SEM_PERMISSAO)
    expect(repo.corrigirEtapa).not.toHaveBeenCalled()
  })
})

describe('actions da OS — manutenção', () => {
  it('ids inválidos são recusados antes do banco', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.iniciarManutencaoAction('x')).toEqual({ ok: false, erro: 'Pedido inválido.' })
    expect(await a.removerPecaAction(OS, 'x')).toEqual({ ok: false, erro: 'Pedido inválido.' })
    expect(repo.iniciarManutencao).not.toHaveBeenCalled()
  })
  it('defeito, peça, laudo e NS chegam limpos ao repositório', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.adicionarDefeitoAction(OS, DEF, '  trocada a fonte ')).toEqual(OK)
    expect(repo.adicionarDefeito).toHaveBeenCalledWith(OS, DEF, 'trocada a fonte')
    expect(await a.adicionarPecaAction(OS, { codigo: ' pmoe74 ', descricao: ' Kit ', quantidade: '2' })).toEqual(OK)
    expect(repo.adicionarPeca).toHaveBeenCalledWith(OS, { codigo: 'PMOE74', descricao: 'Kit', quantidade: 2 })
    expect(await a.salvarLaudoAction(OS, ' laudo ')).toEqual(OK)
    expect(repo.salvarLaudo).toHaveBeenCalledWith(OS, 'laudo')
    expect(await a.trocarNsAction(OS, '562-19178')).toEqual(OK)
    expect(repo.trocarNs).toHaveBeenCalledWith(OS, { escrito: '562-19178', modelo: '562', sequencia: '19178' })
  })
  it('validação do domínio volta como mensagem, sem chamar o banco', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.adicionarPecaAction(OS, { codigo: 'X 1', descricao: '', quantidade: '1' })).toEqual({ ok: false, erro: 'Código do item inválido.' })
    expect(await a.trocarNsAction(OS, ' ')).toEqual({ ok: false, erro: 'Informe o número de série novo.' })
    expect(repo.adicionarPeca).not.toHaveBeenCalled()
    expect(repo.trocarNs).not.toHaveBeenCalled()
  })
  it('erro do banco vira a mensagem da tela', async () => {
    sessao({ visualizar: true, manutencao: true })
    repo.enviarQualidade.mockRejectedValueOnce(new erros.ErroDoBanco('SEM_LAUDO'))
    const a = await import('../ordens-actions')
    expect(await a.enviarQualidadeAction(OS)).toEqual({ ok: false, erro: 'Escreva o laudo antes de enviar para a qualidade.' })
  })
  it('corrigir etapa com sat.administrar: etapa e motivo validados', async () => {
    sessao({ visualizar: true, administrar: true })
    const a = await import('../ordens-actions')
    expect(await a.corrigirEtapaAction(OS, 'expedicao', 'motivo ok')).toEqual({ ok: false, erro: 'Etapa inválida.' })
    expect(await a.corrigirEtapaAction(OS, 'disponivel', '  voltou  ')).toEqual(OK)
    expect(repo.corrigirEtapa).toHaveBeenCalledWith(OS, 'disponivel', 'voltou')
  })
})

describe('actions da OS — lista de peças', () => {
  it('camadas pelo produto da OS', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    const r = await a.pecasSugeridasAction(OS)
    expect(r).toEqual({ ok: true, valor: { maisUsadas: [], kits: [], estrutura: [], avisos: ['O produto PMOC31 não tem estrutura no Compels.'] } })
    expect(repo.produtoDaOrdem).toHaveBeenCalledWith(OS)
  })
  it('OS que não existe: erro', async () => {
    sessao({ visualizar: true, manutencao: true })
    repo.produtoDaOrdem.mockResolvedValueOnce(null)
    const a = await import('../ordens-actions')
    expect(await a.pecasSugeridasAction(OS)).toEqual({ ok: false, erro: 'Ordem de serviço não encontrada. Recarregue a página.' })
  })
  it('busca: de 2 a 60 caracteres; Compels indisponível vira mensagem', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.buscarItensAction('f')).toEqual({ ok: false, erro: 'Digite ao menos 2 letras para buscar.' })
    expect(await a.buscarItensAction('fonte')).toEqual({ ok: true, valor: [{ codigo: 'PRT706', descricao: 'PLACA' }] })
    compels.buscarItens.mockRejectedValueOnce(new CompelsIndisponivel())
    expect(await a.buscarItensAction('fonte')).toEqual({ ok: false, erro: 'O Compels não está disponível neste ambiente.' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/modules/sat/application/__tests__/ordens-actions.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../ordens-actions"`.

- [ ] **Step 3: Implementar**

Crie `src/modules/sat/application/ordens-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Permissao } from '@/modules/auth/domain/perfil'
import { mensagemDoErro } from '../domain/erros'
import { validarCorrecaoEtapa, validarDefeito, validarLaudo, validarPeca, validarTrocaNs } from '../domain/ordem'
import type { PecaSugerida } from '../domain/estrutura'
import { ErroDoBanco } from '../infra/repository'
import {
  adicionarDefeito, adicionarPeca, corrigirEtapa, enviarQualidade, iniciarManutencao, kitsConhecidos, pecasMaisUsadas,
  produtoDaOrdem, removerDefeito, removerPeca, salvarLaudo, trocarNs,
} from '../infra/ordens-repository'
import { CompelsIndisponivel, leiturasDoCompels } from '../infra/estrutura-compels'
import { pecasSugeridas, type CamadasPecas } from './pecas-sugeridas'

/**
 * Ações da ordem de serviço do SAT (spec 2026-11-26, entrega 1). A permissão é conferida aqui ANTES de tudo e de
 * novo no banco (funções da 0198), que também confere a etapa. Nada aqui grava no Compels: só lê (lista de peças).
 */
export type ResultadoAcao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'
const PEDIDO_INVALIDO = 'Pedido inválido.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idOk = (id: unknown): id is string => typeof id === 'string' && UUID.test(id)
const textoOk = (t: unknown, max: number): t is string => typeof t === 'string' && t.length <= max

async function pode(perm: Permissao): Promise<boolean> {
  const sessao = await getSessao()
  return !!sessao && podeNoModulo(sessao.perfil, 'sat', 'visualizar') && podeNoModulo(sessao.perfil, 'sat', perm)
}

function falha(e: unknown, generica: string): { ok: false; erro: string } {
  if (e instanceof ErroDoBanco) return { ok: false, erro: mensagemDoErro(e.message, generica) }
  console.error('[sat]', generica, e instanceof Error ? e.message : e)
  return { ok: false, erro: generica }
}

async function gravar(ordemId: string, generica: string, grava: () => Promise<void>): Promise<ResultadoAcao<null>> {
  try {
    await grava()
  } catch (e) {
    return falha(e, generica)
  }
  revalidatePath(`/sat/ordens/${ordemId}`)
  revalidatePath('/sat/ordens')
  return { ok: true, valor: null }
}

export async function iniciarManutencaoAction(ordemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível abrir a manutenção.', () => iniciarManutencao(ordemId))
}

export async function adicionarDefeitoAction(ordemId: string, defeitoId: string, solucao: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(solucao, 5000)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarDefeito({ defeitoId, solucao })
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível lançar o defeito.', () => adicionarDefeito(ordemId, v.valor.defeitoId, v.valor.solucao))
}

export async function removerDefeitoAction(ordemId: string, itemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !idOk(itemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível remover o defeito.', () => removerDefeito(itemId))
}

export async function adicionarPecaAction(
  ordemId: string, p: { codigo: string; descricao: string; quantidade: string },
): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !p || typeof p !== 'object' || !textoOk(p.codigo, 100) || !textoOk(p.descricao, 1000) ||
      !textoOk(p.quantidade, 20)) {
    return { ok: false, erro: PEDIDO_INVALIDO }
  }
  const v = validarPeca(p)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível lançar a peça.', () => adicionarPeca(ordemId, v.valor))
}

export async function removerPecaAction(ordemId: string, itemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !idOk(itemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível remover a peça.', () => removerPeca(itemId))
}

export async function salvarLaudoAction(ordemId: string, laudo: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(laudo, 10000)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarLaudo(laudo)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível salvar o laudo.', () => salvarLaudo(ordemId, v.valor))
}

export async function trocarNsAction(ordemId: string, ns: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(ns, 500)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarTrocaNs(ns)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível trocar o número de série.', () => trocarNs(ordemId, v.valor))
}

export async function enviarQualidadeAction(ordemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível enviar para a qualidade.', () => enviarQualidade(ordemId))
}

/** O administrador corrige a etapa (qualquer uma desta entrega), com motivo no histórico. */
export async function corrigirEtapaAction(ordemId: string, etapa: string, motivo: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('administrar'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(etapa, 40) || !textoOk(motivo, 2000)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarCorrecaoEtapa(etapa, motivo)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível corrigir a etapa.', () => corrigirEtapa(ordemId, v.valor.etapa, v.valor.motivo))
}

/** As camadas 1–3 da lista de peças, pelo produto da OS (estrutura e pais em cache de 7 dias). */
export async function pecasSugeridasAction(ordemId: string): Promise<ResultadoAcao<CamadasPecas>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  try {
    const produto = await produtoDaOrdem(ordemId)
    if (produto === null) return { ok: false, erro: mensagemDoErro('ORDEM_NAO_ENCONTRADA') }
    const compels = leiturasDoCompels()
    return {
      ok: true,
      valor: await pecasSugeridas(produto, {
        maisUsadas: pecasMaisUsadas, kitsConhecidos,
        estrutura: (c) => compels.estrutura(c), paisDoItem: (id) => compels.paisDoItem(id),
      }),
    }
  } catch (e) {
    return falha(e, 'Não foi possível montar a lista de peças.')
  }
}

/** Camada 4: busca no cadastro de itens do Compels (só leitura). */
export async function buscarItensAction(termo: string): Promise<ResultadoAcao<PecaSugerida[]>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof termo !== 'string') return { ok: false, erro: PEDIDO_INVALIDO }
  const t = termo.trim()
  if (t.length < 2 || t.length > 60) return { ok: false, erro: 'Digite ao menos 2 letras para buscar.' }
  try {
    return { ok: true, valor: await leiturasDoCompels().buscarItens(t) }
  } catch (e) {
    if (e instanceof CompelsIndisponivel) return { ok: false, erro: 'O Compels não está disponível neste ambiente.' }
    return falha(e, 'Não foi possível buscar no Compels agora.')
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/modules/sat/application --maxWorkers=2`
Expected: PASS (os testes antigos das actions da entrada continuam passando).

- [ ] **Step 5: Commit**

```bash
git add src/modules/sat/application/ordens-actions.ts src/modules/sat/application/__tests__/ordens-actions.test.ts
git commit -m "feat(sat): server actions da ordem de serviço (manutenção, correção de etapa, lista de peças)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Fila do SAT (quadro por etapa) e o item no menu

**Files:**
- Create: `src/app/(app)/sat/etapa-ordem.tsx`
- Create: `src/app/(app)/sat/ordens/page.tsx`
- Modify: `src/shared/ui/app-shell.tsx:121-126` (array `SAT`)
- Test: `src/app/(app)/sat/ordens/__tests__/page.test.tsx`
- Test: `src/shared/ui/__tests__/app-shell-menu-sat.test.ts`

**Interfaces:**
- Consumes: `listarOrdens`, `FiltroOrdens`, `OrdemResumo` (Tarefa 9); `agruparPorEtapa`, `ehTipo`, `TIPOS`, `ROTULO_TIPO`, `ROTULO_ETAPA`, `rotuloTipo`, `Etapa`, `TipoOrdem` (Tarefa 6).
- Produces: `EtapaOrdem({ etapa }: { etapa: Etapa })` e `TipoOrdemSelo({ tipo }: { tipo: TipoOrdem | null })` em `src/app/(app)/sat/etapa-ordem.tsx` (usados nas Tarefas 13–14); rota `/sat/ordens`; item de menu `sat-ordens`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/app/(app)/sat/ordens/__tests__/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { OrdemResumo } from '@/modules/sat/infra/ordens-repository'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => <p>sem permissão</p> }))
const repo = vi.hoisted(() => ({ listarOrdens: vi.fn(async (): Promise<OrdemResumo[]> => []) }))
vi.mock('@/modules/sat/infra/ordens-repository', () => repo)

function sessao(sat: Record<string, boolean>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', email: 'x@x', perfil: { porModulo: { sat }, permissoes: {} } }),
  }))
}

const os = (id: string, etapa: OrdemResumo['etapa'], extra: Partial<OrdemResumo> = {}): OrdemResumo => ({
  id, numero: `0${id}/26`, etapa, etapaDesde: '2026-11-26T10:00:00Z', tempoNaEtapa: '5 h', tipo: 'em_garantia',
  cliente: 'Cliente Fictício', nsAtual: `562-${id}`, produto: 'PMOC31', ticketNumero: '', tecnicoNome: '',
  criadoEm: '2026-11-26T10:00:00Z', ...extra,
})

async function abrir(sp: Record<string, string> = {}) {
  const { default: Pagina } = await import('../page')
  render(await Pagina({ searchParams: Promise.resolve(sp) }))
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('/sat/ordens', () => {
  it('sem sat.visualizar: sem permissão, sem leitura', async () => {
    sessao({ manutencao: true })
    await abrir()
    expect(screen.getByText('sem permissão')).toBeInTheDocument()
    expect(repo.listarOrdens).not.toHaveBeenCalled()
  })

  it('quadro com as 4 colunas, contagem e cartões com link para a ficha', async () => {
    sessao({ visualizar: true })
    repo.listarOrdens.mockResolvedValueOnce([os('397', 'disponivel'), os('398', 'em_manutencao', { tipo: null }), os('399', 'disponivel')])
    await abrir()
    const disponivel = screen.getByRole('region', { name: 'Disponível para manutenção' })
    expect(within(disponivel).getByText('2')).toBeInTheDocument()
    expect(within(disponivel).getByRole('link', { name: /0397\/26/ })).toHaveAttribute('href', '/sat/ordens/397')
    const manut = screen.getByRole('region', { name: 'Em manutenção' })
    expect(within(manut).getByText('Garantia a definir')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Qualidade' })).getByText('Nenhuma OS.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recebido' })).toBeNull()
  })

  it('filtros vão para o repositório; tipo desconhecido é ignorado; busca por NS diz onde está', async () => {
    sessao({ visualizar: true })
    repo.listarOrdens.mockResolvedValueOnce([os('398', 'em_manutencao')])
    await abrir({ tipo: 'qualquer', cliente: 'Cli', ns: '562-398', de: '2026-11-01', ate: '2026-11-30' })
    expect(repo.listarOrdens).toHaveBeenCalledWith({ tipo: '', cliente: 'Cli', ns: '562-398', de: '2026-11-01', ate: '2026-11-30' })
    expect(screen.getByText('Número de série encontrado em: Em manutenção (1)')).toBeInTheDocument()
  })

  it('busca por NS sem resultado avisa', async () => {
    sessao({ visualizar: true })
    await abrir({ ns: '999-1', tipo: 'a_definir' })
    expect(repo.listarOrdens).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'a_definir', ns: '999-1' }))
    expect(screen.getByText('Nenhuma OS com esse número de série.')).toBeInTheDocument()
  })
})
```

Em `src/shared/ui/__tests__/app-shell-menu-sat.test.ts`, acrescente dentro do `describe('menu do SAT', ...)` (e `ClipboardList` no import de `lucide-react` do topo: `import { BellRing, ClipboardList } from 'lucide-react'`):

```ts
  it('"Ordens de serviço" vem logo depois da entrada, com sat.visualizar', () => {
    const chaves = SAT.map((i) => i.chave)
    expect(chaves.indexOf('sat-ordens')).toBe(chaves.indexOf('sat-entrada') + 1)
    const item = SAT.find((i) => i.chave === 'sat-ordens')!
    expect(item).toMatchObject({ rotulo: 'Ordens de serviço', href: '/sat/ordens', modulo: 'sat', perm: 'visualizar' })
    expect(item.icone).toBe(ClipboardList)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(app)/sat/ordens/__tests__/page.test.tsx" src/shared/ui/__tests__/app-shell-menu-sat.test.ts --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../page"` e `indexOf('sat-ordens')` = -1.

- [ ] **Step 3: Implementar os selos**

Crie `src/app/(app)/sat/etapa-ordem.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import { ROTULO_ETAPA, rotuloTipo, type Etapa, type TipoOrdem } from '@/modules/sat/domain/ordem'
import { cn } from '@/lib/utils'

const COR_ETAPA: Record<Etapa, string> = {
  recebido: 'bg-slate-100 text-slate-800',
  nota_pendente: 'bg-red-100 text-red-800',
  disponivel: 'bg-amber-100 text-amber-900',
  em_manutencao: 'bg-sky-100 text-sky-900',
  qualidade: 'bg-emerald-100 text-emerald-800',
}

/** A etapa da OS do SAT, com a cor da etapa. */
export function EtapaOrdem({ etapa }: { etapa: Etapa }) {
  return <Badge className={cn(COR_ETAPA[etapa])}>{ROTULO_ETAPA[etapa]}</Badge>
}

/** Em garantia / fora da garantia / garantia a definir (ainda sem a coluna da planilha). */
export function TipoOrdemSelo({ tipo }: { tipo: TipoOrdem | null }) {
  const cor = tipo === 'em_garantia' ? 'bg-emerald-50 text-emerald-800'
    : tipo === null ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-800'
  return <Badge className={cn(cor)}>{rotuloTipo(tipo)}</Badge>
}
```

- [ ] **Step 4: Implementar a fila**

Crie `src/app/(app)/sat/ordens/page.tsx`:

```tsx
import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { agruparPorEtapa, ehTipo, ROTULO_TIPO, TIPOS } from '@/modules/sat/domain/ordem'
import { listarOrdens, type FiltroOrdens } from '@/modules/sat/infra/ordens-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { TipoOrdemSelo } from '../etapa-ordem'

const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? '' : v ?? '').slice(0, 200)

/**
 * SAT → Ordens de serviço: o quadro por etapa (contagem + cartões), com filtros por tipo, cliente, NS (antigo ou
 * novo) e período em que a OS nasceu. sat.visualizar.
 */
export default async function FilaSatPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver as ordens de serviço do SAT." />
  }
  const sp = await searchParams
  const tipo = um(sp.tipo)
  const filtro: FiltroOrdens = {
    tipo: tipo === 'a_definir' || ehTipo(tipo) ? tipo : '',
    cliente: um(sp.cliente), ns: um(sp.ns), de: um(sp.de), ate: um(sp.ate),
  }
  const ordens = await listarOrdens(filtro)
  const colunas = agruparPorEtapa(ordens)
  const buscouNs = filtro.ns.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-tinta">Ordens de serviço</h2>
      <form className="grid grid-cols-1 gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <select name="tipo" defaultValue={filtro.tipo} aria-label="Tipo" className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="">Todos os tipos</option>
          {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
          <option value="a_definir">Garantia a definir</option>
        </select>
        <Input name="cliente" placeholder="Cliente" aria-label="Cliente" defaultValue={filtro.cliente} />
        <Input name="ns" placeholder="Número de série (antigo ou novo)" aria-label="Número de série" defaultValue={filtro.ns} />
        <Input name="de" type="date" aria-label="Aberta de" defaultValue={filtro.de} />
        <Input name="ate" type="date" aria-label="Aberta até" defaultValue={filtro.ate} />
        <Button type="submit">Filtrar</Button>
      </form>

      {buscouNs && (
        <p className="text-sm">
          {ordens.length === 0
            ? 'Nenhuma OS com esse número de série.'
            : `Número de série encontrado em: ${colunas.filter((c) => c.ordens.length > 0).map((c) => `${c.rotulo} (${c.ordens.length})`).join(', ')}`}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {colunas.map((c) => (
          <section key={c.etapa} aria-label={c.rotulo} className="flex flex-col gap-2 rounded-lg border bg-white p-3">
            <h3 className="flex items-center justify-between gap-2 text-sm font-semibold text-tinta">
              {c.rotulo}
              <span className="rounded-full bg-muted px-2 text-xs">{c.ordens.length}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {c.ordens.map((o) => (
                <li key={o.id}>
                  <Link href={`/sat/ordens/${o.id}`} className="flex flex-col gap-0.5 rounded-md border px-2 py-1 text-sm hover:bg-muted/40">
                    <span className="flex justify-between gap-2">
                      <span className="font-mono font-semibold">{o.numero}</span>
                      <span className="text-xs text-muted-foreground">há {o.tempoNaEtapa}</span>
                    </span>
                    <span className="font-mono text-xs">{o.nsAtual}</span>
                    <span className="truncate text-xs text-muted-foreground">{o.cliente || '—'}</span>
                    <TipoOrdemSelo tipo={o.tipo} />
                  </Link>
                </li>
              ))}
              {c.ordens.length === 0 && <li className="text-xs text-muted-foreground">Nenhuma OS.</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Item no menu**

Em `src/shared/ui/app-shell.tsx`, no array `SAT`, logo depois da linha do `sat-entrada`, acrescente (o ícone `ClipboardList` já está importado):

```ts
  { chave: 'sat-ordens', rotulo: 'Ordens de serviço', href: '/sat/ordens', icone: ClipboardList, modulo: 'sat', perm: 'visualizar' },
```

e troque o comentário acima do array por:

```ts
// SAT: entrada de equipamento que volta do cliente (FO-161) e a ordem de serviço de cada relógio. Grupo próprio no
// menu. Os Alertas do SAT moram aqui (o SAT não tem Configurações próprias), com `sat.administrar` e a trava
// ALERTAS_SAT_LIBERADO_PARA.
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run "src/app/(app)/sat" src/shared/ui/__tests__/app-shell-menu-sat.test.ts --maxWorkers=2`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/sat/etapa-ordem.tsx" "src/app/(app)/sat/ordens/page.tsx" "src/app/(app)/sat/ordens/__tests__/page.test.tsx" src/shared/ui/app-shell.tsx src/shared/ui/__tests__/app-shell-menu-sat.test.ts
git commit -m "feat(sat): fila das ordens de serviço por etapa (filtros e busca por NS antigo/novo) + menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Ficha da OS (cabeçalho, linha do tempo, trocas de NS), correção de etapa e link na ficha do relógio

**Files:**
- Create: `src/app/(app)/sat/blocos.tsx`
- Create: `src/app/(app)/sat/ordens/[id]/linha-do-tempo.ts`
- Create: `src/app/(app)/sat/ordens/[id]/corrigir-etapa.tsx`
- Create: `src/app/(app)/sat/ordens/[id]/page.tsx`
- Modify: `src/app/(app)/sat/equipamentos/[id]/page.tsx` (link para a OS)
- Test: `src/app/(app)/sat/ordens/[id]/__tests__/linha-do-tempo.test.ts`
- Test: `src/app/(app)/sat/ordens/[id]/__tests__/corrigir-etapa.test.tsx`
- Test: `src/app/(app)/sat/ordens/[id]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `lerOrdem`, `listarDefeitosAtivos`, `ordemDaEntrada`, `OrdemDetalhe`, `EventoOrdem` (Tarefa 9); `corrigirEtapaAction` (Tarefa 11); `EtapaOrdem`, `TipoOrdemSelo` (Tarefa 12); `ETAPAS`, `ROTULO_ETAPA`, `rotuloTipo`, `ehTipo` (Tarefa 6); `dia`, `quando` de `src/app/(app)/sat/formato.ts`.
- Produces:
  - `Secao({ titulo, children })`, `Dados({ linhas }: { linhas: [string, string][] })` em `src/app/(app)/sat/blocos.tsx`.
  - `textoEvento(e: EventoOrdem): string` em `linha-do-tempo.ts`.
  - `CorrigirEtapa({ ordemId, etapaAtual }: { ordemId: string; etapaAtual: Etapa })`.
  - A ficha renderiza `<Manutencao ... />` com as props da Tarefa 14: `{ ordemId, etapa, tipo, podeManutencao, defeitos, pecas, laudo, defeitosAtivos }`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/app/(app)/sat/ordens/[id]/__tests__/linha-do-tempo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { EventoOrdem } from '@/modules/sat/infra/ordens-repository'
import { textoEvento } from '../linha-do-tempo'

const ev = (e: Partial<EventoOrdem>): EventoOrdem => ({ evento: 'etapa', etapaDe: null, etapaPara: null, dados: {}, usuarioNome: '', em: '', ...e })

describe('textoEvento', () => {
  it('etapas', () => {
    expect(textoEvento(ev({ etapaPara: 'recebido', dados: { nf: '4521' } }))).toBe('Recebido com a NF 4521')
    expect(textoEvento(ev({ etapaDe: 'recebido', etapaPara: 'nota_pendente', dados: { nf: '4521', nf_situacao: 'reprovada' } })))
      .toBe('Recebido → Nota pendente (NF 4521 reprovada)')
    expect(textoEvento(ev({ etapaDe: 'disponivel', etapaPara: 'em_manutencao', dados: { tecnico: 'Rita' } })))
      .toBe('Disponível para manutenção → Em manutenção — técnico Rita')
    expect(textoEvento(ev({ evento: 'correcao_etapa', etapaDe: 'qualidade', etapaPara: 'em_manutencao', dados: { motivo: 'outro defeito' } })))
      .toBe('Etapa corrigida: Qualidade → Em manutenção — motivo: outro defeito')
  })
  it('garantia, defeito, peça, laudo e NS', () => {
    expect(textoEvento(ev({ evento: 'garantia', dados: { tipo_de: null, tipo_para: 'em_garantia', ticket_de: '', ticket_para: '902' } })))
      .toBe('Garantia: Garantia a definir → Em garantia (ticket — → 902)')
    expect(textoEvento(ev({ evento: 'defeito', dados: { acao: 'incluido', defeito: 'Não liga', solucao: 'Trocada a fonte' } })))
      .toBe('Defeito lançado: Não liga — Trocada a fonte')
    expect(textoEvento(ev({ evento: 'defeito', dados: { acao: 'removido', defeito: 'Não liga', solucao: 'x' } })))
      .toBe('Defeito removido: Não liga — x')
    expect(textoEvento(ev({ evento: 'peca', dados: { acao: 'incluida', codigo: 'PMOE74', descricao: 'Kit', quantidade: 1.5 } })))
      .toBe('Peça lançada: 1,5 × PMOE74 Kit')
    expect(textoEvento(ev({ evento: 'peca', dados: { acao: 'removida', codigo: 'PRT1', descricao: '', quantidade: 1 } })))
      .toBe('Peça removida: 1 × PRT1')
    expect(textoEvento(ev({ evento: 'laudo', dados: { laudo: 'x' } }))).toBe('Laudo atualizado')
    expect(textoEvento(ev({ evento: 'ns', dados: { ns_antigo: '562-1', ns_novo: '562-9' } }))).toBe('NS trocado: 562-1 → 562-9')
  })
})
```

Crie `src/app/(app)/sat/ordens/[id]/__tests__/corrigir-etapa.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { corrigirEtapaAction } from '@/modules/sat/application/ordens-actions'
import { CorrigirEtapa } from '../corrigir-etapa'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/sat/application/ordens-actions', () => ({ corrigirEtapaAction: vi.fn(async () => ({ ok: true, valor: null })) }))

const OS = '00000000-0000-0000-0000-0000000000a1'
beforeEach(() => vi.clearAllMocks())

describe('CorrigirEtapa', () => {
  it('abre, escolhe a etapa, escreve o motivo e confirma', async () => {
    render(<CorrigirEtapa ordemId={OS} etapaAtual="qualidade" />)
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir etapa' }))
    fireEvent.change(screen.getByLabelText('Nova etapa'), { target: { value: 'em_manutencao' } })
    fireEvent.change(screen.getByLabelText('Motivo da correção'), { target: { value: 'qualidade achou outro defeito' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    await waitFor(() => expect(corrigirEtapaAction).toHaveBeenCalledWith(OS, 'em_manutencao', 'qualidade achou outro defeito'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Etapa corrigida.'))
  })
  it('erro da action vira toast de erro', async () => {
    vi.mocked(corrigirEtapaAction).mockResolvedValueOnce({ ok: false, erro: 'Escreva o motivo da correção (3 a 500 caracteres).' })
    render(<CorrigirEtapa ordemId={OS} etapaAtual="qualidade" />)
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir etapa' }))
    fireEvent.change(screen.getByLabelText('Nova etapa'), { target: { value: 'disponivel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Escreva o motivo da correção (3 a 500 caracteres).'))
  })
})
```

Crie `src/app/(app)/sat/ordens/[id]/__tests__/page.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OrdemDetalhe } from '@/modules/sat/infra/ordens-repository'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => <p>sem permissão</p> }))
const props = vi.hoisted(() => ({ manutencao: null as unknown, corrigir: null as unknown }))
vi.mock('../manutencao', () => ({ Manutencao: (p: unknown) => { props.manutencao = p; return null } }))
vi.mock('../corrigir-etapa', () => ({ CorrigirEtapa: (p: unknown) => { props.corrigir = p; return <p>corrigir</p> } }))
const repo = vi.hoisted(() => ({
  lerOrdem: vi.fn(async (): Promise<OrdemDetalhe | null> => null),
  listarDefeitosAtivos: vi.fn(async () => [{ id: 'd1', descricao: 'Não liga', codigoCompels: '1' }]),
}))
vi.mock('@/modules/sat/infra/ordens-repository', () => repo)

function sessao(sat: Record<string, boolean>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', email: 'x@x', perfil: { porModulo: { sat }, permissoes: {} } }),
  }))
}

const ID = '00000000-0000-0000-0000-0000000000a1'
const ORDEM: OrdemDetalhe = {
  id: ID, numero: '0397/26', etapa: 'em_manutencao', etapaDesde: '2026-11-26T10:00:00Z', tempoNaEtapa: '5 h',
  tipo: 'em_garantia', cliente: 'Cliente Fictício', nsAtual: '562-99', produto: 'PMOC31', ticketNumero: '900',
  tecnicoNome: 'Rita', criadoEm: '2026-11-25T10:00:00Z', entradaId: '00000000-0000-0000-0000-0000000000e1',
  garantia: 'GARANTIA', cnpj: '12.345.678/0001-90', laudo: 'ok', nf: { numero: '4521', situacao: 'aprovada' },
  defeitos: [], pecas: [],
  trocasNs: [{ id: 't1', nsAntigo: '562-1', nsNovo: '562-99', usuarioNome: 'Rita', em: '2026-11-26T11:00:00Z' }],
  historico: [{ evento: 'ns', etapaDe: null, etapaPara: null, dados: { ns_antigo: '562-1', ns_novo: '562-99' }, usuarioNome: 'Rita', em: '2026-11-26T11:00:00Z' }],
}

async function abrir(id = ID) {
  const { default: Pagina } = await import('../page')
  render(await Pagina({ params: Promise.resolve({ id }) }))
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
  props.manutencao = null
  props.corrigir = null
})

describe('/sat/ordens/[id]', () => {
  it('sem sat.visualizar: sem permissão', async () => {
    sessao({ manutencao: true })
    await abrir()
    expect(screen.getByText('sem permissão')).toBeInTheDocument()
    expect(repo.lerOrdem).not.toHaveBeenCalled()
  })
  it('id inválido ou OS inexistente: 404', async () => {
    sessao({ visualizar: true })
    await expect(abrir('x')).rejects.toThrow('NOT_FOUND')
    await expect(abrir()).rejects.toThrow('NOT_FOUND')
  })
  it('cabeçalho, trocas de NS, linha do tempo e link para o relógio', async () => {
    sessao({ visualizar: true })
    repo.lerOrdem.mockResolvedValueOnce(ORDEM)
    await abrir()
    expect(screen.getByRole('heading', { name: 'OS 0397/26' })).toBeInTheDocument()
    expect(screen.getByText('NF 4521 (aprovada)')).toBeInTheDocument()
    expect(screen.getAllByText('562-1 → 562-99').length).toBeGreaterThan(0)
    expect(screen.getByText('NS trocado: 562-1 → 562-99')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver o relógio recebido' })).toHaveAttribute('href', '/sat/equipamentos/00000000-0000-0000-0000-0000000000e1')
    expect(props.manutencao).toMatchObject({ ordemId: ID, etapa: 'em_manutencao', podeManutencao: false, defeitosAtivos: [] })
    expect(props.corrigir).toBeNull()
    expect(repo.listarDefeitosAtivos).not.toHaveBeenCalled()
  })
  it('com manutenção em OS em manutenção: lista de defeitos; com administrar: correção de etapa', async () => {
    sessao({ visualizar: true, manutencao: true, administrar: true })
    repo.lerOrdem.mockResolvedValueOnce(ORDEM)
    await abrir()
    expect(props.manutencao).toMatchObject({ podeManutencao: true, defeitosAtivos: [{ id: 'd1', descricao: 'Não liga', codigoCompels: '1' }] })
    expect(props.corrigir).toEqual({ ordemId: ID, etapaAtual: 'em_manutencao' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(app)/sat/ordens/[id]" --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../linha-do-tempo"`, `"../corrigir-etapa"`, `"../page"`.

- [ ] **Step 3: Implementar os blocos e a linha do tempo**

Crie `src/app/(app)/sat/blocos.tsx`:

```tsx
/** Os blocos das fichas do SAT: uma seção com título e uma grade de rótulo/valor. */
export function Dados({ linhas }: { linhas: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {linhas.map(([r, v]) => (
        <div key={r} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{r}</dt>
          <dd className="whitespace-pre-wrap">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <h3 className="text-sm font-semibold text-tinta">{titulo}</h3>
      {children}
    </section>
  )
}
```

Crie `src/app/(app)/sat/ordens/[id]/linha-do-tempo.ts`:

```ts
import { ehEtapa, ehTipo, ROTULO_ETAPA, rotuloTipo } from '@/modules/sat/domain/ordem'
import type { EventoOrdem } from '@/modules/sat/infra/ordens-repository'

const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const etapa = (v: unknown) => (ehEtapa(v) ? ROTULO_ETAPA[v] : '—')
const tipo = (v: unknown) => rotuloTipo(ehTipo(v) ? v : null)
const qtd = (v: unknown) => s(v).replace('.', ',')

/** Uma linha da linha do tempo da OS, em português. */
export function textoEvento(e: EventoOrdem): string {
  const d = e.dados
  switch (e.evento) {
    case 'etapa': {
      if (e.etapaDe === null) return `Recebido${s(d.nf) ? ` com a NF ${s(d.nf)}` : ''}`
      const nf = s(d.nf_situacao) ? ` (NF ${s(d.nf)} ${s(d.nf_situacao)})` : ''
      const tecnico = s(d.tecnico) ? ` — técnico ${s(d.tecnico)}` : ''
      return `${etapa(e.etapaDe)} → ${etapa(e.etapaPara)}${nf}${tecnico}`
    }
    case 'correcao_etapa':
      return `Etapa corrigida: ${etapa(e.etapaDe)} → ${etapa(e.etapaPara)} — motivo: ${s(d.motivo)}`
    case 'garantia':
      return `Garantia: ${tipo(d.tipo_de)} → ${tipo(d.tipo_para)} (ticket ${s(d.ticket_de) || '—'} → ${s(d.ticket_para) || '—'})`
    case 'defeito':
      return `Defeito ${d.acao === 'removido' ? 'removido' : 'lançado'}: ${s(d.defeito)} — ${s(d.solucao)}`
    case 'peca':
      return `Peça ${d.acao === 'removida' ? 'removida' : 'lançada'}: ${qtd(d.quantidade)} × ${[s(d.codigo), s(d.descricao)].filter(Boolean).join(' ')}`
    case 'laudo':
      return 'Laudo atualizado'
    case 'ns':
      return `NS trocado: ${s(d.ns_antigo)} → ${s(d.ns_novo)}`
    default:
      return s(e.evento)
  }
}
```

- [ ] **Step 4: Implementar a correção de etapa**

Crie `src/app/(app)/sat/ordens/[id]/corrigir-etapa.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { corrigirEtapaAction } from '@/modules/sat/application/ordens-actions'
import { ETAPAS, MAX_MOTIVO_CORRECAO, ROTULO_ETAPA, type Etapa } from '@/modules/sat/domain/ordem'

/** O administrador corrige a etapa da OS (sat.administrar). O motivo vai para a linha do tempo. */
export function CorrigirEtapa({ ordemId, etapaAtual }: { ordemId: string; etapaAtual: Etapa }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [etapa, setEtapa] = useState<Etapa>(etapaAtual)
  const [motivo, setMotivo] = useState('')
  const [pendente, iniciar] = useTransition()

  const confirmar = () => iniciar(async () => {
    const r = await corrigirEtapaAction(ordemId, etapa, motivo)
    if (!r.ok) { toast.error(r.erro); return }
    toast.success('Etapa corrigida.')
    setAberto(false)
    setMotivo('')
    router.refresh()
  })

  if (!aberto) return <div><Button variant="outline" onClick={() => setAberto(true)}>Corrigir etapa</Button></div>

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-white p-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Nova etapa</span>
        <select aria-label="Nova etapa" value={etapa} onChange={(e) => setEtapa(e.target.value as Etapa)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm">
          {ETAPAS.map((x) => <option key={x} value={x}>{ROTULO_ETAPA[x]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">Motivo da correção</span>
        <Textarea aria-label="Motivo da correção" value={motivo} maxLength={MAX_MOTIVO_CORRECAO} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button onClick={confirmar} disabled={pendente || etapa === etapaAtual}>{pendente ? 'Salvando…' : 'Confirmar correção'}</Button>
        <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Implementar a ficha**

Crie `src/app/(app)/sat/ordens/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { rotuloTipo } from '@/modules/sat/domain/ordem'
import { lerOrdem, listarDefeitosAtivos } from '@/modules/sat/infra/ordens-repository'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { Dados, Secao } from '../../blocos'
import { EtapaOrdem, TipoOrdemSelo } from '../../etapa-ordem'
import { quando } from '../../formato'
import { CorrigirEtapa } from './corrigir-etapa'
import { textoEvento } from './linha-do-tempo'
import { Manutencao } from './manutencao'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * SAT → ficha da OS: cabeçalho, manutenção (defeitos, peças, laudo, troca de NS — com sat.manutencao), trocas de NS,
 * correção de etapa (sat.administrar) e a linha do tempo. sat.visualizar.
 */
export default async function FichaOrdemPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sat', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver as ordens de serviço do SAT." />
  }
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const o = await lerOrdem(id)
  if (!o) notFound()
  const podeManutencao = podeNoModulo(sessao.perfil, 'sat', 'manutencao')
  const podeAdministrar = podeNoModulo(sessao.perfil, 'sat', 'administrar')
  const defeitosAtivos = podeManutencao && o.etapa === 'em_manutencao' ? await listarDefeitosAtivos() : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sat/ordens" className="text-sm underline">← Ordens de serviço</Link>
        <h2 className="text-lg font-semibold text-tinta">OS {o.numero}</h2>
        <EtapaOrdem etapa={o.etapa} />
        <TipoOrdemSelo tipo={o.tipo} />
      </div>

      <Secao titulo="Ordem de serviço">
        <Dados linhas={[
          ['Número de série', o.nsAtual || '—'],
          ['Produto', o.produto || '—'],
          ['Cliente', o.cliente || '—'],
          ['CNPJ', o.cnpj || '—'],
          ['Tipo', rotuloTipo(o.tipo)],
          ['Garantia (planilha)', o.garantia || '—'],
          ['Ticket do suporte', o.ticketNumero || '—'],
          ['NF de entrada', o.nf ? `NF ${o.nf.numero} (${o.nf.situacao})` : '—'],
          ['Técnico', o.tecnicoNome || '—'],
          ['Aberta em', quando(o.criadoEm)],
          ['Nesta etapa há', o.tempoNaEtapa],
        ]} />
        {o.entradaId && (
          <Link className="text-sm underline" href={`/sat/equipamentos/${o.entradaId}`}>Ver o relógio recebido</Link>
        )}
      </Secao>

      <Manutencao
        ordemId={o.id} etapa={o.etapa} tipo={o.tipo} podeManutencao={podeManutencao}
        defeitos={o.defeitos} pecas={o.pecas} laudo={o.laudo} defeitosAtivos={defeitosAtivos}
      />

      {o.trocasNs.length > 0 && (
        <Secao titulo="Trocas de número de série">
          <ul className="flex flex-col gap-1 text-sm">
            {o.trocasNs.map((t) => (
              <li key={t.id} className="flex flex-wrap gap-x-3">
                <span className="font-mono">{t.nsAntigo} → {t.nsNovo}</span>
                <span className="text-muted-foreground">{quando(t.em)} — {t.usuarioNome || '—'}</span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {podeAdministrar && <CorrigirEtapa ordemId={o.id} etapaAtual={o.etapa} />}

      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold text-tinta">Linha do tempo</h3>
        <ol className="flex flex-col gap-1 rounded-lg border bg-white p-3 text-sm">
          {o.historico.map((h, i) => (
            <li key={i} className="flex flex-wrap gap-x-3">
              <span className="text-muted-foreground">{quando(h.em)}</span>
              <span>{textoEvento(h)}</span>
              <span className="text-muted-foreground">— {h.usuarioNome || '—'}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
```

Para a ficha compilar antes da Tarefa 14, crie já o arquivo `src/app/(app)/sat/ordens/[id]/manutencao.tsx` com a assinatura final (a Tarefa 14 troca o corpo):

```tsx
'use client'

import type { Etapa, TipoOrdem } from '@/modules/sat/domain/ordem'
import type { DefeitoDaOrdem, DefeitoSat, PecaDaOrdem } from '@/modules/sat/infra/ordens-repository'

export interface ManutencaoProps {
  ordemId: string
  etapa: Etapa
  tipo: TipoOrdem | null
  podeManutencao: boolean
  defeitos: DefeitoDaOrdem[]
  pecas: PecaDaOrdem[]
  laudo: string
  defeitosAtivos: DefeitoSat[]
}

/** A manutenção da OS (corpo completo na Tarefa 14). */
export function Manutencao(_: ManutencaoProps) {
  return null
}
```

- [ ] **Step 6: Link para a OS na ficha do relógio**

Em `src/app/(app)/sat/equipamentos/[id]/page.tsx`:
- acrescente os imports `import { ordemDaEntrada } from '@/modules/sat/infra/ordens-repository'` e `import { EtapaOrdem } from '../../etapa-ordem'`;
- troque `const motivos = podeNf ? await listarMotivos() : []` por:

```tsx
  const [motivos, ordem] = await Promise.all([podeNf ? listarMotivos() : Promise.resolve([]), ordemDaEntrada(e.id)])
```

- logo depois do `<StatusNf situacao={n.situacao} />` do cabeçalho, acrescente:

```tsx
        {ordem && (
          <Link href={`/sat/ordens/${ordem.id}`} className="flex items-center gap-2 text-sm underline">
            OS {ordem.numero} <EtapaOrdem etapa={ordem.etapa} />
          </Link>
        )}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run "src/app/(app)/sat" --maxWorkers=2 && npx tsc --noEmit -p .`
Expected: PASS nos testes; `tsc` sem erro.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/sat/blocos.tsx" "src/app/(app)/sat/ordens/[id]" "src/app/(app)/sat/equipamentos/[id]/page.tsx"
git commit -m "feat(sat): ficha da ordem de serviço (linha do tempo, trocas de NS, correção de etapa) e link na ficha do relógio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Manutenção dentro da ficha (defeitos, peças em 4 camadas, laudo, troca de NS, enviar para a qualidade)

**Files:**
- Modify: `src/app/(app)/sat/ordens/[id]/manutencao.tsx` (corpo completo)
- Create: `src/app/(app)/sat/ordens/[id]/seletor-pecas.tsx`
- Test: `src/app/(app)/sat/ordens/[id]/__tests__/manutencao.test.tsx`
- Test: `src/app/(app)/sat/ordens/[id]/__tests__/seletor-pecas.test.tsx`

**Interfaces:**
- Consumes: as actions da Tarefa 11; `ManutencaoProps` (Tarefa 13); `DefeitoDaOrdem`, `PecaDaOrdem`, `DefeitoSat` (Tarefa 9); `PecaSugerida` (Tarefa 7); `CamadasPecas` (Tarefa 10); `MAX_SOLUCAO`, `MAX_LAUDO` (Tarefa 6); `Secao` (Tarefa 13).
- Produces: `Manutencao(props: ManutencaoProps)`; `SeletorPecas({ ordemId, onEscolher }: { ordemId: string; onEscolher: (p: PecaSugerida) => void })`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/app/(app)/sat/ordens/[id]/__tests__/seletor-pecas.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { buscarItensAction, pecasSugeridasAction } from '@/modules/sat/application/ordens-actions'
import { SeletorPecas } from '../seletor-pecas'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/sat/application/ordens-actions', () => ({
  pecasSugeridasAction: vi.fn(async () => ({
    ok: true,
    valor: {
      maisUsadas: [{ codigo: 'FT100', descricao: 'FONTE' }],
      kits: [{ codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' }],
      estrutura: [{ codigo: 'GB001', descricao: 'GABINETE' }],
      avisos: ['Não foi possível procurar todos os kits no Compels agora.'],
    },
  })),
  buscarItensAction: vi.fn(async () => ({ ok: true, valor: [{ codigo: 'PRT706', descricao: 'PLACA' }] })),
}))

const OS = '00000000-0000-0000-0000-0000000000a1'
beforeEach(() => vi.clearAllMocks())

describe('SeletorPecas', () => {
  it('mostra as 3 camadas e os avisos; clicar escolhe a peça', async () => {
    const onEscolher = vi.fn()
    render(<SeletorPecas ordemId={OS} onEscolher={onEscolher} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver peças sugeridas' }))
    await waitFor(() => expect(pecasSugeridasAction).toHaveBeenCalledWith(OS))
    expect(await screen.findByText('Mais usadas neste modelo')).toBeInTheDocument()
    expect(screen.getByText('Kits de reposição que servem')).toBeInTheDocument()
    expect(screen.getByText('Peças da estrutura')).toBeInTheDocument()
    expect(screen.getByText('Não foi possível procurar todos os kits no Compels agora.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'PMOE74 — MODULO CAMABIO COM CABO' }))
    expect(onEscolher).toHaveBeenCalledWith({ codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' })
  })
  it('camada 4: busca no Compels', async () => {
    const onEscolher = vi.fn()
    render(<SeletorPecas ordemId={OS} onEscolher={onEscolher} />)
    fireEvent.change(screen.getByLabelText('Buscar item no Compels'), { target: { value: 'placa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(buscarItensAction).toHaveBeenCalledWith('placa'))
    fireEvent.click(await screen.findByRole('button', { name: 'PRT706 — PLACA' }))
    expect(onEscolher).toHaveBeenCalledWith({ codigo: 'PRT706', descricao: 'PLACA' })
  })
  it('erro da busca aparece na tela', async () => {
    vi.mocked(buscarItensAction).mockResolvedValueOnce({ ok: false, erro: 'Digite ao menos 2 letras para buscar.' })
    render(<SeletorPecas ordemId={OS} onEscolher={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Digite ao menos 2 letras para buscar.')).toBeInTheDocument()
  })
})
```

Crie `src/app/(app)/sat/ordens/[id]/__tests__/manutencao.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import * as acoes from '@/modules/sat/application/ordens-actions'
import { Manutencao, type ManutencaoProps } from '../manutencao'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const ok = vi.hoisted(() => ({ ok: true, valor: null }))
vi.mock('@/modules/sat/application/ordens-actions', () => ({
  iniciarManutencaoAction: vi.fn(async () => ok), adicionarDefeitoAction: vi.fn(async () => ok),
  removerDefeitoAction: vi.fn(async () => ok), adicionarPecaAction: vi.fn(async () => ok),
  removerPecaAction: vi.fn(async () => ok), salvarLaudoAction: vi.fn(async () => ok),
  trocarNsAction: vi.fn(async () => ok), enviarQualidadeAction: vi.fn(async () => ok),
}))
vi.mock('../seletor-pecas', () => ({
  SeletorPecas: ({ onEscolher }: { onEscolher: (p: { codigo: string; descricao: string }) => void }) =>
    <button onClick={() => onEscolher({ codigo: 'PMOE74', descricao: 'Kit Camabio' })}>escolher kit</button>,
}))

const OS = '00000000-0000-0000-0000-0000000000a1'
const D1 = '00000000-0000-0000-0000-0000000000d1'
const base: ManutencaoProps = {
  ordemId: OS, etapa: 'em_manutencao', tipo: 'em_garantia', podeManutencao: true, laudo: '',
  defeitos: [{ id: 'x1', defeitoId: D1, descricao: 'Não liga', origem: 'manutencao', solucao: 'Trocada a fonte', usuarioNome: 'Rita', em: '' }],
  pecas: [{ id: 'p1', codigo: 'FT100', descricao: 'FONTE', quantidade: 1, situacao: 'trocada', usuarioNome: 'Rita', em: '' }],
  defeitosAtivos: [{ id: D1, descricao: 'Não liga', codigoCompels: '1' }],
}
beforeEach(() => vi.clearAllMocks())

describe('Manutencao', () => {
  it('disponível + sat.manutencao: só o botão de abrir a manutenção', async () => {
    render(<Manutencao {...base} etapa="disponivel" defeitos={[]} pecas={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar manutenção' }))
    await waitFor(() => expect(acoes.iniciarManutencaoAction).toHaveBeenCalledWith(OS))
    expect(screen.queryByRole('button', { name: 'Enviar para a qualidade' })).toBeNull()
  })
  it('sem sat.manutencao: só leitura', () => {
    render(<Manutencao {...base} podeManutencao={false} laudo="Fonte queimada" />)
    expect(screen.getByText('Não liga')).toBeInTheDocument()
    expect(screen.getByText('Fonte queimada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lançar defeito' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull()
  })
  it('lança defeito com a solução', async () => {
    render(<Manutencao {...base} />)
    fireEvent.change(screen.getByLabelText('Defeito'), { target: { value: D1 } })
    fireEvent.change(screen.getByLabelText('Solução'), { target: { value: 'Trocado o cabo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lançar defeito' }))
    await waitFor(() => expect(acoes.adicionarDefeitoAction).toHaveBeenCalledWith(OS, D1, 'Trocado o cabo'))
  })
  it('escolhe a peça na lista e lança com a quantidade', async () => {
    render(<Manutencao {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'escolher kit' }))
    expect(screen.getByLabelText('Código do item')).toHaveValue('PMOE74')
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lançar peça' }))
    await waitFor(() => expect(acoes.adicionarPecaAction).toHaveBeenCalledWith(OS, { codigo: 'PMOE74', descricao: 'Kit Camabio', quantidade: '2' }))
  })
  // um render por ação: enquanto a ação roda, os botões ficam desabilitados (useTransition)
  it('remove a peça (o 2º "Remover": o 1º é do defeito)', async () => {
    render(<Manutencao {...base} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover' })[1]!)
    await waitFor(() => expect(acoes.removerPecaAction).toHaveBeenCalledWith(OS, 'p1'))
  })
  it('salva o laudo', async () => {
    render(<Manutencao {...base} />)
    fireEvent.change(screen.getByLabelText('Laudo'), { target: { value: 'Fonte queimada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar laudo' }))
    await waitFor(() => expect(acoes.salvarLaudoAction).toHaveBeenCalledWith(OS, 'Fonte queimada'))
  })
  it('troca o NS', async () => {
    render(<Manutencao {...base} />)
    fireEvent.change(screen.getByLabelText('Número de série novo'), { target: { value: '562-99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trocar NS' }))
    await waitFor(() => expect(acoes.trocarNsAction).toHaveBeenCalledWith(OS, '562-99'))
  })
  it('envia para a qualidade', async () => {
    render(<Manutencao {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para a qualidade' }))
    await waitFor(() => expect(acoes.enviarQualidadeAction).toHaveBeenCalledWith(OS))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Enviada para a qualidade.'))
  })
  it('fora da garantia: avisa que o orçamento ainda não está aqui; erro do banco vira toast', async () => {
    vi.mocked(acoes.enviarQualidadeAction).mockResolvedValueOnce({ ok: false, erro: 'OS fora da garantia: o orçamento ainda não está no ShopFloor.' })
    render(<Manutencao {...base} tipo="fora_garantia" />)
    expect(screen.getByText('Fora da garantia: o orçamento e o envio para a qualidade chegam na próxima entrega.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para a qualidade' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('OS fora da garantia: o orçamento ainda não está no ShopFloor.'))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/(app)/sat/ordens/[id]/__tests__/manutencao.test.tsx" "src/app/(app)/sat/ordens/[id]/__tests__/seletor-pecas.test.tsx" --maxWorkers=2`
Expected: FAIL — `Failed to resolve import "../seletor-pecas"` e, na manutenção, `Unable to find role="button" and name "Iniciar manutenção"`.

- [ ] **Step 3: Implementar o seletor de peças**

Crie `src/app/(app)/sat/ordens/[id]/seletor-pecas.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buscarItensAction, pecasSugeridasAction } from '@/modules/sat/application/ordens-actions'
import type { CamadasPecas } from '@/modules/sat/application/pecas-sugeridas'
import type { PecaSugerida } from '@/modules/sat/domain/estrutura'

function Lista({ titulo, pecas, onEscolher }: { titulo: string; pecas: PecaSugerida[]; onEscolher: (p: PecaSugerida) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
      {pecas.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma.</span>}
      <div className="flex flex-wrap gap-1">
        {pecas.map((p) => (
          <Button key={p.codigo} type="button" variant="outline" size="sm" onClick={() => onEscolher(p)}>
            {p.descricao ? `${p.codigo} — ${p.descricao}` : p.codigo}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A lista de peças da manutenção: as 3 camadas sugeridas (mais usadas no modelo, kits que servem, peças da
 * estrutura) e a busca no cadastro do Compels (camada 4). Só leitura do Compels; escolher só preenche o formulário.
 */
export function SeletorPecas({ ordemId, onEscolher }: { ordemId: string; onEscolher: (p: PecaSugerida) => void }) {
  const [camadas, setCamadas] = useState<CamadasPecas | null>(null)
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<PecaSugerida[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, iniciar] = useTransition()

  const sugerir = () => iniciar(async () => {
    setErro(null)
    const r = await pecasSugeridasAction(ordemId)
    if (!r.ok) { setErro(r.erro); return }
    setCamadas(r.valor)
  })
  const buscar = () => iniciar(async () => {
    setErro(null)
    const r = await buscarItensAction(termo)
    if (!r.ok) { setErro(r.erro); setAchados(null); return }
    setAchados(r.valor)
  })

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2">
      {camadas === null ? (
        <div><Button type="button" variant="outline" onClick={sugerir} disabled={carregando}>
          {carregando ? 'Carregando…' : 'Ver peças sugeridas'}
        </Button></div>
      ) : (
        <>
          {camadas.avisos.map((a) => <p key={a} className="text-xs text-amber-800">{a}</p>)}
          <Lista titulo="Mais usadas neste modelo" pecas={camadas.maisUsadas} onEscolher={onEscolher} />
          <Lista titulo="Kits de reposição que servem" pecas={camadas.kits} onEscolher={onEscolher} />
          <Lista titulo="Peças da estrutura" pecas={camadas.estrutura} onEscolher={onEscolher} />
        </>
      )}
      <div className="flex gap-2">
        <Input aria-label="Buscar item no Compels" placeholder="Buscar item no Compels (código ou descrição)" value={termo}
          maxLength={60} onChange={(e) => setTermo(e.target.value)} />
        <Button type="button" variant="outline" onClick={buscar} disabled={carregando}>Buscar</Button>
      </div>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {achados && <Lista titulo="Resultado da busca" pecas={achados} onEscolher={onEscolher} />}
    </div>
  )
}
```

- [ ] **Step 4: Implementar a manutenção**

Substitua o conteúdo de `src/app/(app)/sat/ordens/[id]/manutencao.tsx` por:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  adicionarDefeitoAction, adicionarPecaAction, enviarQualidadeAction, iniciarManutencaoAction, removerDefeitoAction,
  removerPecaAction, salvarLaudoAction, trocarNsAction, type ResultadoAcao,
} from '@/modules/sat/application/ordens-actions'
import { MAX_LAUDO, MAX_SOLUCAO, type Etapa, type TipoOrdem } from '@/modules/sat/domain/ordem'
import type { DefeitoDaOrdem, DefeitoSat, PecaDaOrdem } from '@/modules/sat/infra/ordens-repository'
import { Secao } from '../../blocos'
import { SeletorPecas } from './seletor-pecas'

export interface ManutencaoProps {
  ordemId: string
  etapa: Etapa
  tipo: TipoOrdem | null
  podeManutencao: boolean
  defeitos: DefeitoDaOrdem[]
  pecas: PecaDaOrdem[]
  laudo: string
  defeitosAtivos: DefeitoSat[]
}

const qtd = (n: number) => String(n).replace('.', ',')

/**
 * A manutenção dentro da ficha da OS. Com sat.manutencao: "Iniciar manutenção" (disponível) e, em manutenção,
 * defeitos (lista + solução), peças (4 camadas), laudo, troca de NS e "Enviar para a qualidade". Sem a permissão
 * (ou em outra etapa), só leitura. O banco confere permissão e etapa de novo.
 */
export function Manutencao({ ordemId, etapa, tipo, podeManutencao, defeitos, pecas, laudo, defeitosAtivos }: ManutencaoProps) {
  const router = useRouter()
  const [pendente, iniciar] = useTransition()
  const [defeitoId, setDefeitoId] = useState('')
  const [solucao, setSolucao] = useState('')
  const [codigo, setCodigo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [quantidade, setQuantidade] = useState('1')
  const [textoLaudo, setTextoLaudo] = useState(laudo)
  const [nsNovo, setNsNovo] = useState('')
  const editando = podeManutencao && etapa === 'em_manutencao'

  const executar = (acao: () => Promise<ResultadoAcao<null>>, sucesso: string, depois?: () => void) => iniciar(async () => {
    const r = await acao()
    if (!r.ok) { toast.error(r.erro); return }
    toast.success(sucesso)
    depois?.()
    router.refresh()
  })

  return (
    <Secao titulo="Manutenção">
      {podeManutencao && etapa === 'disponivel' && (
        <div>
          <Button onClick={() => executar(() => iniciarManutencaoAction(ordemId), 'Manutenção iniciada.')} disabled={pendente}>
            Iniciar manutenção
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Defeitos encontrados</span>
        {defeitos.length === 0 && <span className="text-sm text-muted-foreground">Nenhum.</span>}
        <ul className="flex flex-col gap-1 text-sm">
          {defeitos.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3">
              <span className="font-medium">{d.descricao}</span>
              <span>{d.solucao}</span>
              {d.origem === 'qualidade' && <span className="text-xs text-muted-foreground">(qualidade)</span>}
              {editando && d.origem === 'manutencao' && (
                <Button variant="ghost" size="sm" disabled={pendente}
                  onClick={() => executar(() => removerDefeitoAction(ordemId, d.id), 'Defeito removido.')}>Remover</Button>
              )}
            </li>
          ))}
        </ul>
        {editando && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <select aria-label="Defeito" value={defeitoId} onChange={(e) => setDefeitoId(e.target.value)}
              className="h-9 rounded-md border bg-transparent px-2 text-sm">
              <option value="">Escolha o defeito</option>
              {defeitosAtivos.map((d) => <option key={d.id} value={d.id}>{d.descricao}</option>)}
            </select>
            <Input aria-label="Solução" placeholder="Solução" value={solucao} maxLength={MAX_SOLUCAO} onChange={(e) => setSolucao(e.target.value)} />
            <Button disabled={pendente} onClick={() => executar(() => adicionarDefeitoAction(ordemId, defeitoId, solucao), 'Defeito lançado.',
              () => { setDefeitoId(''); setSolucao('') })}>Lançar defeito</Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Peças trocadas</span>
        {pecas.length === 0 && <span className="text-sm text-muted-foreground">Nenhuma.</span>}
        <ul className="flex flex-col gap-1 text-sm">
          {pecas.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3">
              <span className="font-mono">{qtd(p.quantidade)} × {p.codigo}</span>
              <span>{p.descricao}</span>
              {p.situacao === 'devolvida' && <span className="text-xs text-muted-foreground">(devolvida)</span>}
              {editando && p.situacao === 'trocada' && (
                <Button variant="ghost" size="sm" disabled={pendente}
                  onClick={() => executar(() => removerPecaAction(ordemId, p.id), 'Peça removida.')}>Remover</Button>
              )}
            </li>
          ))}
        </ul>
        {editando && (
          <>
            <SeletorPecas ordemId={ordemId} onEscolher={(p) => { setCodigo(p.codigo); setDescricao(p.descricao) }} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_6rem_auto]">
              <Input aria-label="Código do item" placeholder="Código" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
              <Input aria-label="Descrição do item" placeholder="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              <Input aria-label="Quantidade" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              <Button disabled={pendente} onClick={() => executar(() => adicionarPecaAction(ordemId, { codigo, descricao, quantidade }),
                'Peça lançada.', () => { setCodigo(''); setDescricao(''); setQuantidade('1') })}>Lançar peça</Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Laudo</span>
        {editando ? (
          <>
            <Textarea aria-label="Laudo" value={textoLaudo} maxLength={MAX_LAUDO} onChange={(e) => setTextoLaudo(e.target.value)} />
            <div><Button variant="outline" disabled={pendente}
              onClick={() => executar(() => salvarLaudoAction(ordemId, textoLaudo), 'Laudo salvo.')}>Salvar laudo</Button></div>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{laudo || '—'}</p>
        )}
      </div>

      {editando && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Troca de número de série</span>
          <div className="flex gap-2">
            <Input aria-label="Número de série novo" placeholder="NS novo" value={nsNovo} onChange={(e) => setNsNovo(e.target.value)} />
            <Button variant="outline" disabled={pendente}
              onClick={() => executar(() => trocarNsAction(ordemId, nsNovo), 'Número de série trocado.', () => setNsNovo(''))}>Trocar NS</Button>
          </div>
        </div>
      )}

      {editando && (
        <div className="flex flex-col gap-1 border-t pt-2">
          {tipo !== 'em_garantia' && (
            <p className="text-sm text-amber-800">
              {tipo === null
                ? 'A planilha ainda não diz se esta OS é garantia: confira o ticket do suporte antes de enviar.'
                : 'Fora da garantia: o orçamento e o envio para a qualidade chegam na próxima entrega.'}
            </p>
          )}
          <div><Button disabled={pendente}
            onClick={() => executar(() => enviarQualidadeAction(ordemId), 'Enviada para a qualidade.')}>Enviar para a qualidade</Button></div>
        </div>
      )}
    </Secao>
  )
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run "src/app/(app)/sat" --maxWorkers=2 && npx tsc --noEmit -p .`
Expected: PASS; `tsc` sem erro.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/sat/ordens/[id]/manutencao.tsx" "src/app/(app)/sat/ordens/[id]/seletor-pecas.tsx" "src/app/(app)/sat/ordens/[id]/__tests__/manutencao.test.tsx" "src/app/(app)/sat/ordens/[id]/__tests__/seletor-pecas.test.tsx"
git commit -m "feat(sat): manutenção na ficha da OS (defeitos, peças em 4 camadas, laudo, troca de NS, qualidade)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Verificação final da entrega

**Files:**
- Nenhum arquivo novo (só correções que a verificação apontar, cada uma com o teste que a cobre).

**Interfaces:**
- Consumes: tudo das Tarefas 1–14.
- Produces: a branch pronta para revisão (sem push).

- [ ] **Step 1: Testes SQL**

Run: `bash supabase/tests/rodar-sat-test.sh`
Expected: termina com `SAT OK` (inclui `idempotência da 0198`, `0198: 7 policies` e `0186, 0187, 0190 e 0198 do zero`).

- [ ] **Step 2: Testes do app (só o que esta entrega toca, e depois tudo)**

Run: `npx vitest run src/modules/sat src/modules/compels "src/app/(app)/sat" src/modules/auth src/modules/perfis src/shared/ui --maxWorkers=2`
Expected: PASS.

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (nenhum teste antigo quebrado).

- [ ] **Step 3: Tipos, lint e build**

```bash
npx tsc --noEmit -p .
npx eslint src/modules/sat src/modules/compels "src/app/(app)/sat" src/shared/ui/app-shell.tsx tools/compels/sat-estrutura.ts tools/compels/defeitos-sat.ts
NODE_OPTIONS="--max-old-space-size=4096" npx next build
```
Expected: os três sem erro (o build lista `/sat/ordens` e `/sat/ordens/[id]`).

- [ ] **Step 4: Os `.mjs` gerados batem com o `.ts`**

```bash
npx rolldown tools/compels/sat-estrutura.ts --file tools/compels/sat-estrutura.mjs --format esm --platform node
npx rolldown tools/compels/defeitos-sat.ts --file tools/compels/defeitos-sat.mjs --format esm --platform node
git status --short tools/compels
```
Expected: nada modificado (se mudou, commitar o `.mjs` novo junto da correção que mudou o `.ts`).

- [ ] **Step 5: Conferir que nada grava no Compels**

Run: `git diff main --stat -- src/modules/compels && git diff main -- src/modules/compels/infra/cliente.ts | grep -E "^\+.*(gravar|save|baixar|lock)" || echo "nenhuma gravação nova no Compels"`
Expected: `nenhuma gravação nova no Compels`.

- [ ] **Step 6: Commit (só se a verificação pediu correção)**

```bash
git status --short
```
Expected: árvore limpa. Se houve correção, commitar com a mensagem `fix(sat): <o que foi corrigido>` + a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Antes do deploy (para o usuário; nada disto é executado por este plano)

Ordem (mesmo roteiro dos deploys do SAT: migração antes do app):
1. Rodar a conferência só-leitura `node tools/compels/sat-estrutura.mjs PMOC31 --pais --busca fonte` na instância AWS e acertar o que ela apontar (Tarefa 7, passo 7).
2. Confirmar no Compels o último número de OS de 2026 e, se passou de 396, trocar a semente na `0198_sat_ordem_servico.sql` antes de aplicar.
3. Aplicar a 0198 no Dev, depois no RDS (`psql -1 -v ON_ERROR_STOP=1 -f`).
4. `node tools/compels/defeitos-sat.mjs --amostra > defeitos-sat.sql` e aplicar o arquivo no Dev e no RDS (88 defeitos).
5. Dar `sat.manutencao` ao perfil do SAT (Configurações → Perfis).
6. Deploy do app.
