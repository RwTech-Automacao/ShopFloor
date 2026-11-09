# Almoxarifado por necessidade, FASE 1 (coletiva e trava do posto anterior): plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com `- [ ]`.

**Meta (fase 1):** (a) o Almoxarifado passa a **olhar o posto anterior da rota** em toda entrada (caixa e peça): só entra o que esse posto concluiu, pela regra do `gate` do perfil; (b) a tela do Almoxarifado ganha a **lista de necessidades** (caixas fechadas com o posto anterior concluído e ainda sem entrada), e o responsável **confirma bipando o código da caixa** (o bipe de hoje); (c) o Cadastrar Posto **impede um segundo posto** com perfil Almoxarifado.
**Fase 2 (plano próprio, só depois da revisão desta):** lote individual com amostra, `sf_nqa_lotes`, envio de lote, bloqueio do bipe avulso quando o anterior é NQA individual, cancelar o lote em Registros.
**Spec:** `docs/superpowers/specs/2026-10-20-almoxarifado-por-necessidade-design.md` (branch `feat/almoxarifado-necessidade`, worktree `ShopFloor-necessidade`).
**Pilha:** Postgres 15 (plpgsql), Supabase, Next.js 16 (**ler `AGENTS.md` e `node_modules/next/dist/docs/`**), React 19, TypeScript, Vitest.

## Restrições globais (a função mexida roda em produção todo dia: cuidado máximo)

- PT-BR. `tem_permissao` **sempre com 2 argumentos**. Perfil do posto (`sf_posto_perfis.recurso` e `.gate`) decide, **nunca o nome do posto**.
- **Migração aditiva e idempotente**, corpo com `$func$` (o SQL Editor não aceita dois cifrões), `notify pgrst, 'reload schema'`. **Números de migração: 0155 em diante** (a 0154 é do Dashboard, em outra branch; conferir lacunas lendo `supabase/migrations`).
- **Não quebrar nada que existe:** `supabase/tests/almoxarifado_test.sql` (2.535 linhas), `estoque_envios_test.sql` e `estoque_enviado_test.sql` têm de continuar **verdes sem alterar o sentido** de nenhum caso. O que a regra nova recusar e antes passava exige **atualizar a massa do teste para satisfazer o posto anterior**, e isso deve ser dito no relatório, caso a caso. Os testes novos vão em **arquivo novo**.
- A assinatura de `sf_almoxarifado_entrada` **não muda** (mesmos parâmetros e retorno jsonb `{ok, ...}`); as recusas novas são **motivos novos** no jsonb, no padrão das existentes.
- **Sem tabela nova nesta fase.** Nada de `sf_nqa_lotes`, nada de `sf_estoque_envios` novo tipo: isso é a fase 2.
- Commits pequenos, PT-BR, com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Não fazer push, não trocar de branch. **Nada contra produção nem contra o banco local do Supabase**: use só o Postgres descartável em Docker dos scripts `supabase/tests/rodar-*.sh`.

## Regras de negócio (decididas com o usuário)

1. **Posto anterior** = o posto imediatamente antes do Almoxarifado em `sf_ordem_postos` (`order by ordem`, o anterior ao que tem perfil `recurso = 'almoxarifado'`). Se não houver anterior (Almoxarifado é o primeiro), a regra **não se aplica** (comportamento de hoje).
2. **Concluído pelo gate do perfil do posto anterior** (a mesma semântica do Lançamento, `0031_sf_lancar.sql`/`0103`): gate `'aprovado'` = existe registro da peça nesse posto com `lower(status) = 'aprovado'` ("existe Aprovado", **não** "último status"); gate `'registrado'` = existe registro da peça nesse posto.
3. **Unidade peça (OP individual):** a peça (`numero_serie_norm`) precisa estar concluída no posto anterior. Recusa nova: motivo `posto_anterior_nao_concluido`, com `detalhe` em PT-BR dizendo o posto e se precisa estar aprovado.
4. **Unidade caixa (OP coletiva):** só **caixa fechada** (`sf_caixas.fechada`, `revisao = 0`). Concluída quando **todas as peças da caixa** cumprem o gate do posto anterior: anterior de recurso `caixa` (Embalagem) → a caixa estar fechada basta (a Embalagem não tem status); anterior de recurso `nqa` → todas as peças da caixa com NQA Aprovado (**`sf_nqa_caixa` não grava `numero_caixa`**; ligar SN → caixa pelas linhas da Embalagem, como o mapeamento descreveu); qualquer outro → todas as peças com registro que cumpra o gate. Recusa: `posto_anterior_nao_concluido` (mesmo motivo, mesmo padrão).
5. **Necessidade** = caixa que cumpre a regra 4 e ainda **não tem** `sf_registros` no posto Almoxarifado com o seu `numero_caixa`. A lista é **consulta** (função), sem tabela.
6. **Um posto Almoxarifado por OP** (e por sistema): o Cadastrar Posto recusa criar/trocar um segundo posto com perfil de recurso `almoxarifado`.

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/0155_sf_almox_posto_anterior.sql` | criar: função auxiliar de "unidade concluída no posto anterior" + `sf_almox_necessidades(p_pmo, p_op)` + `sf_almoxarifado_entrada` recriada com as recusas novas (corpo copiado da 0129 vigente, **só acrescentando**) |
| `supabase/tests/almoxarifado_necessidade_test.sql` (+ massa/esquema se precisar) e `supabase/tests/rodar-almoxarifado-test.sh` | criar/acrescentar; rodar o runner inteiro |
| `src/modules/shopfloor/domain/almoxarifado.ts` | frases novas do operador para `posto_anterior_nao_concluido`; tipo `NecessidadeAlmoxarifado` |
| `src/modules/shopfloor/application/almoxarifado-actions.ts` | action `listarNecessidadesAlmoxarifado(pmo, op)` (gate `recebimento.lancar` + `shopfloor.visualizar`) e a tradução do motivo novo |
| `src/app/(app)/shopfloor/operar/lancamento/almoxarifado-panel.tsx` | lista de necessidades acima do campo de bipe (caixas pendentes, com a quantidade de peças e o código); a caixa confirmada some da lista |
| Cadastrar Posto: `src/modules/shopfloor/application/postos-actions.ts` (ou o arquivo que cria/edita posto; **achar lendo o código**) | recusa de um segundo posto com perfil Almoxarifado |
| testes novos ao lado de cada um | TS: domínio, action, painel, posto |

## Tarefa 1: SQL (a parte arriscada, primeiro)

- [ ] **1.1** Ler **inteira** a `0129_sf_almoxarifado_entrada.sql` (a vigente; confira se alguma migração posterior a recria: `grep -ln "sf_almoxarifado_entrada" supabase/migrations/*.sql`), a `0031_sf_lancar.sql` e a `0103` (a trava `SEQUENCIA`), a `0130` (como `sf_nqa_caixa` grava), `supabase/tests/almoxarifado_test.sql` e `rodar-almoxarifado-test.sh`.
- [ ] **1.2 Rede de segurança:** rodar `supabase/tests/rodar-almoxarifado-test.sh` **antes de mudar qualquer coisa** e anotar que está verde.
- [ ] **1.3 Testes novos primeiro** (`almoxarifado_necessidade_test.sql`, vermelhos): para cada combinação, **peça e caixa**: anterior `registrado` (Embalagem) × `aprovado` (NQA, Inspeção); concluído × não concluído; "existe Aprovado" com a peça reprovada e depois aprovada (passa) e aprovada e depois reprovada (**passa**, é a regra de hoje); caixa aberta (continua `caixa_aberta`); caixa com uma peça sem NQA (recusa); Almoxarifado sem posto anterior (regra não se aplica); `sf_almox_necessidades` lista só caixas fechadas concluídas e sem entrada, e a caixa confirmada **sai** da lista; caixa remontada após reprova (`revisao`) **não** entra duas vezes; OP sem Almoxarifado na rota devolve vazio.
- [ ] **1.4** Migração `0155`: função auxiliar (por exemplo `sf_almox_unidade_concluida(...)`) + `sf_almox_necessidades(p_pmo text, p_op text) returns table (...)` (`security definer`, `set search_path = public`, `tem_permissao('recebimento','lancar')` e `('shopfloor','visualizar')` no padrão da 0129, `revoke` de `public`/`anon`, `grant` a `authenticated`) + `create or replace function public.sf_almoxarifado_entrada(...)` **com o mesmo corpo da vigente e só as recusas novas acrescentadas no ponto certo** (depois das recusas de posto/OP e **antes** da gravação; dentro da trava existente). Cabeçalho no estilo da 0129 explicando o quê, por quê e a regra "existe Aprovado" mantida por paridade.
- [ ] **1.5** Rodar `rodar-almoxarifado-test.sh` inteiro (testes antigos + novos, a 0155 **duas vezes** com `psql -1` como já fazem os outros) e `rodar-estoque-envios-test.sh` e `rodar-estoque-enviado-test.sh`: **todos verdes**. Cada ajuste de massa em teste antigo vai listado no relatório.
- [ ] **1.6** Commit.

## Tarefa 2: TypeScript (domínio, action, painel)

- [ ] **2.1** Ler `almoxarifado.ts`, `almoxarifado-actions.ts` (frases do operador e tradução dos motivos), `almoxarifado-panel.tsx`, `recebimento/almoxarifado/page.tsx` e os testes existentes desses arquivos.
- [ ] **2.2** Testes primeiro, depois: frase em PT-BR para `posto_anterior_nao_concluido` (diz o posto anterior e se precisa estar aprovado); `listarNecessidadesAlmoxarifado` (permissões, devolve a lista tipada, erro do banco vira mensagem, **nunca lista vazia no lugar de falha**); o painel mostra "Caixas esperando confirmação" com código e nº de peças, some a caixa confirmada (recarrega após o bipe), estado vazio com texto claro, e **o bipe continua funcionando como hoje**.
- [ ] **2.3** Commit.

## Tarefa 3: um posto Almoxarifado só

- [ ] **3.1** Achar a action que cria e edita posto (Cadastrar Posto) lendo o código; teste primeiro: criar ou trocar o perfil de um posto para `almoxarifado` quando já existe **outro** posto com esse perfil é recusado com "Já existe um posto Almoxarifado; só pode haver um."; editar o próprio posto Almoxarifado sem mudar o perfil continua permitido; outros perfis não são afetados. Implementar, commitar.

## Tarefa 4: verificação (antes de reportar)

- [ ] `npx tsc --noEmit` limpo; `npx vitest run --maxWorkers=2` inteiro verde; os três runners SQL verdes; `NODE_OPTIONS="--max-old-space-size=4096" npx next build` sem erro.
- [ ] Relatório: hashes, a lista de **tudo** que mudou em teste antigo (idealmente nada além da massa), os casos novos cobertos e qualquer ambiguidade que você resolveu (e como).

## Fora do escopo desta fase

Lote individual, amostra, `sf_nqa_lotes`, tipo `lote` na fila, bloqueio do bipe avulso com NQA individual, cancelamento de lote, envio em lote, qualquer mudança na integração com o Compels.
