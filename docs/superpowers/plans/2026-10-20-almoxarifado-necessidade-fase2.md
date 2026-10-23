# Almoxarifado por necessidade, FASE 2 (lote individual com amostra): plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com `- [ ]`.

**Meta:** em OP de **embalagem individual** cujo posto anterior ao Almoxarifado é de **perfil NQA**, o **lote aprovado no NQA** vira uma **necessidade** com todos os SNs listados. A pessoa do Almoxarifado **bipa uma amostra de SNs do lote** (tamanho da Tabela NQA pelo tamanho do lote) e confirma; o ShopFloor grava **uma entrada por SN** (histórico por peça) e **um envio só** ao Compels, com a quantidade do lote e a lista dos SNs. O bipe de **peça avulsa** passa a ser **recusado** nesse caso. O **cancelamento** é sempre do **lote inteiro**, em Registros.
**Pré-requisito:** a fase 1 (`docs/superpowers/plans/2026-10-20-almoxarifado-necessidade-fase1.md`, migração 0155, já neste branch). **Spec:** `docs/superpowers/specs/2026-10-20-almoxarifado-por-necessidade-design.md` (branch `feat/almoxarifado-necessidade`, worktree `ShopFloor-necessidade`).
**Pilha:** Postgres 15 (plpgsql), Supabase, Next.js 16 (**ler `AGENTS.md` e `node_modules/next/dist/docs/`**), React 19, TypeScript, Vitest.

## Restrições globais (funções de produção: cuidado máximo)

- PT-BR. `tem_permissao` **sempre com 2 argumentos**. Perfil do posto (`sf_posto_perfis.recurso` e `.gate`) decide, **nunca o nome**.
- **Migração aditiva e idempotente**, corpo `$func$`, `notify pgrst, 'reload schema'` ao fim. **Números: 0156 em diante** (0154 é do Dashboard, 0155 é a fase 1). Conferir lacunas lendo `supabase/migrations`.
- **Não quebrar nada que existe:** `supabase/tests/almoxarifado_test.sql`, `almoxarifado_necessidade_test.sql`, `estoque_envios_test.sql`, `estoque_enviado_test.sql` e `finalizacao_test.sql` (se tocar finalização) têm de continuar **verdes sem mudar o sentido** de nenhum caso. Se a regra nova recusar algo que antes passava, **ajuste só a massa do teste** (a OP de teste passa a ter o lote aprovado, por exemplo) e **liste cada ajuste no relatório**. Testes novos em **arquivo novo** (`almoxarifado_lote_test.sql`).
- **Assinatura e retorno de `sf_almoxarifado_entrada` não mudam**; só um motivo novo (`serie_exige_lote`), depois das recusas antigas e da recusa da fase 1, antes da gravação, dentro da trava. **`sf_estoque_reservar` retorna `table`**: mudar colunas de retorno exige `drop function` e cuidado com o worker em produção; **evite** mudar o retorno (o lote usa os mesmos campos: `quantidade`, `bipe`, `alvo`).
- **Não alterar `sf_nqa_individual`** nem criar a tabela `sf_nqa_lotes` (decisão: o lote é uma **consulta** sobre `sf_registros.nqa_lote_id`, com um índice parcial; reavaliar só se medir lento).
- **Sem sorteio de SNs e sem "quantidade contada":** isso foi uma sugestão e **não** foi aprovada. A amostra é "bipar K SNs quaisquer, distintos, do lote".
- Commits pequenos, PT-BR, com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Não fazer push, não trocar de branch. **Nada contra produção nem contra o banco local do Supabase**: use só o Postgres descartável dos `supabase/tests/rodar-*.sh`.

## Regras de negócio (decididas pelo usuário em 20/10)

1. **Quando vale:** OP com `embalagem_individual = true` **e** posto anterior ao Almoxarifado com `recurso = 'nqa'` (use `sf_almox_posto_anterior`, da 0155). Fora disso, nada muda (individual sem NQA continua **bipe a bipe**; coletiva continua por caixa).
2. **Lote** = grupo de linhas de `sf_registros` no **posto NQA anterior** com o mesmo `nqa_lote_id`; **aprovado** = **todas** as linhas do lote com `lower(status) = 'aprovado'`; **tamanho** = `count(distinct numero_serie_norm)`. Lote reprovado **não** vira necessidade.
3. **Necessidade de lote** = lote aprovado cujos SNs **não** têm entrada no Almoxarifado. A lista mostra **todos os SNs do lote**.
4. **Confirmar:** a pessoa envia uma amostra de **K SNs distintos que pertencem ao lote**, com **K = `tamanho_amostra` da `tabela_nqa` pelo tamanho total do lote** (mesma consulta da 0097: `quantidade_min <= n and (quantidade_max is null or n <= quantidade_max) order by ordem limit 1`; valor nulo ou ≤ 0 → recusa `amostra_nqa_invalida`). Mesmo SN repetido conta **uma** vez; SN de fora do lote **recusa**.
5. **Sem desconto:** se **algum** SN do lote já tiver entrada no Almoxarifado, **recusar** com mensagem clara (nunca descontar em silêncio).
6. **Efeito da confirmação (numa transação, sob trava):** grava **uma linha em `sf_registros` por SN do lote** no posto Almoxarifado (mesmo molde da entrada de caixa da 0129: colaborador, cliente, `numero_caixa` vazio, `envio_id` apontando para o envio) e **uma linha em `sf_estoque_envios`** com `tipo = 'lote'`, `bipe = 'LOTE[<8 primeiros hex do nqa_lote_id>][<N>]'`, `serie_norm = ''`, `alvo = bipe`, `quantidade = N`, `lote_id`, `sns` (lista de todos os SNs do lote), chave idempotente pelo `sf_estoque_chave`. **Uma linha no Compels por lote.**
7. **Cancelar:** sempre o **lote inteiro**, em **Registros**, com a **mesma permissão de hoje (`shopfloor.administrar`)**; o botão aparece como **"Cancelar o lote inteiro (N peças)"** em qualquer linha do lote (mesmo molde de "Cancelar a caixa inteira" da 0131). Apaga todas as linhas do lote (para a auditoria, como a 0131) e chama `sf_estoque_reverter` (cancela o envio pendente ou gera estorno; **estorno no Compels continua manual**).
8. **Bipe avulso bloqueado:** em OP individual com posto anterior NQA, `sf_almoxarifado_entrada` com `p_tipo = 'serie'` recusa com o motivo `serie_exige_lote` e a frase "Esta peça faz parte de um lote do NQA: confirme o lote inteiro."

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/0156_sf_almox_lote.sql` | criar: índice parcial `sf_registros(pmo, op, posto, nqa_lote_id) where nqa_lote_id is not null`; colunas `sf_estoque_envios.lote_id uuid` e `.sns text[]`; `sf_registros.envio_id uuid` (+ índice parcial); CHECK de `tipo` aceitando `'lote'` (ver o CHECK atual na 0132: `drop constraint if exists` + `add`, **conferindo contra as linhas existentes**); função `sf_almox_lotes(p_pmo, p_op)` (necessidades de lote); RPC `sf_almoxarifado_lote(...)`; RPC `sf_cancelar_lote_almoxarifado(p_id uuid, p_motivo text)`; recusa `serie_exige_lote` em `sf_almoxarifado_entrada` (recriada: corpo da versão vigente **da 0155** + só o bloco novo) |
| `supabase/tests/almoxarifado_lote_test.sql` + acréscimo em `rodar-almoxarifado-test.sh` | testes novos e a 0156 aplicada duas vezes |
| `src/modules/shopfloor/domain/almoxarifado.ts` | tipos `NecessidadeLote`; frases (`serie_exige_lote` e as recusas do lote); regra do botão de cancelar lote |
| `src/modules/shopfloor/application/almoxarifado-actions.ts` | `listarNecessidadesAlmoxarifado` passa a devolver caixas **e** lotes; `confirmarLoteAlmoxarifado`; tradução dos motivos novos |
| `src/modules/shopfloor/application/cancelamento-actions.ts` + `infra/cancelamento-repository.ts` | `cancelarLoteAlmoxarifado` (permissão `shopfloor.administrar`); `cancelavelInfo` devolve `lote` quando for entrada de lote |
| `src/app/(app)/shopfloor/registros/registros-tabela.tsx` | botão e diálogo "Cancelar o lote inteiro (N peças)" (molde da caixa); o select de registros precisa trazer `envio_id` |
| `src/app/(app)/shopfloor/operar/lancamento/almoxarifado-panel.tsx` | OP individual com NQA: lista de lotes, abrir um lote mostra **todos os SNs**, bipar K amostras, **Confirmar lote** |
| `src/modules/shopfloor/domain/estoque-pendente.ts` e a tela de pendências | rótulo do envio de tipo `lote` ("Lote … · N peças") |
| testes novos ao lado de cada arquivo TS | domínio, actions, painel, Registros |

## Tarefa 1: SQL

- [ ] **1.1** Ler **inteiros**: `0097_sf_nqa_individual.sql`, `0132_sf_estoque_envios.sql` (tabela, CHECKs, `sf_estoque_chave/reservar/reverter`), `0129`, `0131`, `0133`, a **0155** (fase 1) e o `almoxarifado_necessidade_test.sql`/`almoxarifado_test.sql` (helpers `teste_*`).
- [ ] **1.2 Rede de segurança:** rodar `rodar-almoxarifado-test.sh`, `rodar-estoque-envios-test.sh` e `rodar-estoque-enviado-test.sh` **antes de mudar qualquer coisa**; só avançar se estiverem verdes.
- [ ] **1.3 Testes novos primeiro (vermelhos)** em `almoxarifado_lote_test.sql`: lote aprovado aparece em `sf_almox_lotes` com todos os SNs; lote reprovado ou com um SN não aprovado **não** aparece; OP coletiva e individual sem NQA devolvem vazio; confirmar com a amostra certa → N linhas em `sf_registros` (todas com `envio_id`) e **um** envio `tipo = 'lote'` com `quantidade = N` e `sns` completo; amostra de tamanho errado, SN de fora do lote, SN repetido (conta uma vez, então falta amostra) e `amostra_nqa_invalida` recusam **sem gravar nada** (nenhum rastro em registros nem na fila); lote já confirmado recusa; SN do lote já lançado recusa; sem permissão recusa; **duas confirmações simultâneas do mesmo lote: só uma vence** (use o padrão das corridas em bash do runner); `serie_exige_lote` no bipe avulso (e que coletiva e individual-sem-NQA **não** são afetadas); cancelar o lote inteiro: apaga todas as linhas, cancela o envio pendente ou gera estorno se já enviado, só `shopfloor.administrar`, e depois o lote volta a ser necessidade.
- [ ] **1.4** Migração `0156` (cabeçalho no estilo da 0129/0155: o quê, por quê, regras 1 a 8, decisões "sem tabela nova" e "sem desconto").
- [ ] **1.5** Rodar os **três runners** (mais o novo bloco, a 0156 aplicada **duas vezes** com `psql -1`): tudo verde. Cada ajuste de massa em teste antigo vai listado no relatório.
- [ ] **1.6** Medir (modelo do passo 1.8 do plano do Dashboard): `sf_almox_lotes` com ~300 mil linhas em `sf_registros` e muitos lotes, como `authenticated`, mediana de 3, em OP ativa. Anotar o número no cabeçalho da migração; **não** criar `sf_nqa_lotes` sem medir.
- [ ] **1.7** Commit.

## Tarefa 2: TypeScript

- [ ] **2.1** Ler os arquivos do mapa e seus testes. Testes primeiro: frases, actions (permissões, erro do banco vira estado de erro, **nunca lista vazia no lugar de falha**), painel (lista de lotes, abrir lote mostra todos os SNs, aceita só SN do lote, repetido não conta, só habilita "Confirmar lote" ao completar K, o bipe avulso mostra a frase do `serie_exige_lote`), Registros ("Cancelar o lote inteiro (N peças)", diálogo com motivo), pendências (rótulo do lote).
- [ ] **2.2** Implementar; **o painel de OP coletiva e o de individual sem NQA não podem mudar de comportamento** (testes existentes verdes).
- [ ] **2.3** Commit por arquivo lógico.

## Tarefa 3: verificação (antes de reportar)

- [ ] `npx tsc --noEmit` limpo; `npx vitest run --maxWorkers=2` inteiro verde; os três runners SQL verdes; `NODE_OPTIONS="--max-old-space-size=4096" npx next build` sem erro (com variáveis falsas de Supabase na linha de comando, sem gravar arquivo).
- [ ] Relatório: hashes, números de tsc/testes/runners/build, a lista **completa** de qualquer mudança em teste antigo (idealmente só massa), a medição, as ambiguidades resolvidas e como.

## Fora do escopo

Sorteio de amostra e contagem física; desconto de SNs já lançados; `sf_nqa_lotes`; mudanças em `sf_nqa_individual`; estorno automático no Compels; card único; qualquer mudança no Dashboard.
