# Card único Almoxarifado no Fluxo da OP (plano de implementação)

> **Para quem executa:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com `- [ ]`.

**Meta:** quando o **último posto da rota** da OP tem perfil Almoxarifado, o Fluxo mostra **um card só**, chamado "Almoxarifado", com a faixa do estoque do Compels; senão, o card **Concluído** fica **exatamente como hoje**. Além disso, deixar **pronta e DESLIGADA** a etapa 2 (posto Almoxarifado automático em OP nova).
**Spec:** `docs/superpowers/specs/2026-10-20-card-unico-almoxarifado-concluido-design.md` (branch `feat/card-unico-almoxarifado`, worktree `ShopFloor-card`).
**Restrição dura do usuário:** **não pode afetar nada que já foi criado.** OPs antigas continuam com o Concluído, com o mesmo grafo, as mesmas arestas e as mesmas posições.
**Pilha:** Next.js 16 (**ler `AGENTS.md` e `node_modules/next/dist/docs/` antes de mexer em rota/página**), React 19, TypeScript, Vitest, Tailwind v4, React Flow (`@xyflow/react`).

## Restrições globais

- PT-BR na interface e nos comentários. Perfil do posto decide (campo `recurso` do perfil), **nunca o nome do posto**.
- **Nenhuma migração, nenhum SQL, nenhuma mudança em `sf_fluxo_op`, na finalização automática ou no % de conclusão.** Só apresentação (e, na etapa 2, a criação da rota de OP nova, desligada).
- Parâmetro novo em função existente = **opcional**, para os testes antigos seguirem iguais. **Não alterar o sentido de nenhum teste existente**; se algum teste antigo falhar, é regressão: parar e corrigir o código, não o teste.
- Tema claro e escuro; a faixa do estoque é `absolute` e não altera a altura do nó nem o enquadramento do Fluxo embutido.
- Commits pequenos, PT-BR, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Não fazer push, não trocar de branch.

## Decisões do usuário que valem aqui (20/10)

Nome do card: **Almoxarifado** (sem linha "Concluído" extra). OP individual usa o mesmo card. OP **sem quantidade**: o card do Almoxarifado aparece sempre, só sem porcentagem. OPs **antigas ficam como estão** (card Concluído, sem receber o posto sozinhas, nem na edição). **Padrões** antigos não mudam; o posto entra sozinho na OP nova quando a etapa 2 estiver ligada. Placas intermediárias: **em aberto** (por isso a etapa 2 nasce desligada).

## Mapa de arquivos (conforme o mapeamento de 20/10; confirme os números de linha lendo o código)

| Arquivo | Ação |
|---|---|
| `src/modules/shopfloor/domain/fluxo-op.ts` | regra pura + omitir `SAIDA` e a aresta + repassar dados ao nó do último posto |
| `src/app/(app)/shopfloor/fluxo/fluxo-node.tsx` | mostrar a faixa do estoque do Compels no card do Almoxarifado |
| `src/app/(app)/shopfloor/fluxo/fluxo-form.tsx` | repassar `pmo` ao nó do último posto (hoje só o nó `SAIDA` recebe, ~linha 860); ajustar a busca de SN (~linhas 802-803) e comentários |
| `src/modules/shopfloor/domain/__tests__/fluxo-op.test.ts` | casos novos + **snapshot de contrato** |
| `src/app/(app)/shopfloor/fluxo/__tests__/fluxo-node.test.tsx`, `fluxo-node-estoque.test.tsx` | casos novos (não mudar os existentes) |
| `src/app/(app)/shopfloor/fluxo/__tests__/fluxo-form-embed-enquadrar.test.tsx`, `src/app/embed/__tests__/fluxo-embed.test.tsx` | conferir/ajustar só se o enquadramento mudar de fato |
| etapa 2: `src/app/(app)/shopfloor/ordens/ordem-form.tsx`, `src/modules/shopfloor/application/ordens-actions.ts`, `src/app/(app)/shopfloor/ordens/page.tsx` (passar a flag), testes novos ao lado | desligada por padrão |

## Tarefa 1: regra de apresentação no domínio

- [ ] **1.1 Snapshot primeiro (rede de segurança).** Ler `fluxo-op.ts` e `fluxo-op.test.ts`. Antes de mudar código, escrever um teste de contrato que chama `construirFluxo` para um conjunto de rotas **sem** Almoxarifado em último (rota de 1 posto; de 3; de 7 (mais de uma linha da serpentina); com Manutenção; com Burn-in; sem `finalizadas`) e compara com `toMatchInlineSnapshot`/objetos esperados **gerados da versão atual**. Deve passar **antes** de qualquer mudança. Commit.
- [ ] **1.2** Função pura `ultimoPostoEhAlmoxarifado(postosOrdenados: string[], recursoDe: (posto: string) => string | undefined): boolean` (true só se o último posto tem recurso `'almoxarifado'`). Teste: lista vazia, um posto, almoxarifado no meio (false), no fim (true), recurso desconhecido (false).
- [ ] **1.3** Em `construirFluxo`: se `ultimoPostoEhAlmoxarifado(...)`, **não criar o nó `SAIDA`** nem a aresta `f:<ultimo>->Saída`; o nó do último posto passa a levar `pmo` e `finalizadas` (campos opcionais novos em `FluxoNodeData`, por exemplo `mostrarEstoque?: boolean`, `concluidas?: number`). Se **não** for, o resultado tem de ser **idêntico** ao do snapshot da 1.1. Casos novos: almoxarifado em último (sem Saída, sem aresta, `mostrarEstoque` true); almoxarifado no **meio** (mantém Saída); OP **sem `finalizadas`/sem quantidade** (o card do Almoxarifado ainda existe, sem porcentagem, sem quebrar). Manutenção não muda de lugar.
- [ ] **1.4** Rodar `npx vitest run src/modules/shopfloor/domain` e `npx tsc --noEmit`. Commit.

## Tarefa 2: o card do Almoxarifado mostra o estoque do Compels

- [ ] **2.1** Ler `fluxo-node.tsx` (o `EstoqueCompelsCard`, o ramo `ehSaida`, o card de posto com `ehAlmox`). Testes primeiro (`fluxo-node.test.tsx`, `fluxo-node-estoque.test.tsx`): o card do posto com `mostrarEstoque` renderiza a faixa "Estoque no Compels · PMO" **abaixo**; sem `mostrarEstoque` **não** renderiza; o nó `Concluído` continua renderizando a faixa como hoje; o título do card continua "Almoxarifado" e **não** aparece a palavra "Concluído" nele.
- [ ] **2.2** Implementar extraindo a condição para `(d.ehSaida || d.mostrarEstoque) && d.pmo`. A faixa continua `absolute top-full`, com cache de 1 minuto por PMO e `nao_configurado` → não mostra nada.
- [ ] **2.3** Rodar `npx vitest run "src/app/(app)/shopfloor/fluxo"`; commit.

## Tarefa 3: fluxo-form, busca de SN e Fluxo embutido

- [ ] **3.1** Em `fluxo-form.tsx`: o `pmo` deve ir também ao nó do último posto quando `mostrarEstoque`; a busca por SN (peça concluída) deve apontar para o **Almoxarifado** quando não há nó `SAIDA` (hoje cai em `r.postos[último]`, que já é o certo: apenas ajustar o comentário e cobrir com teste).
- [ ] **3.2** O Fluxo embutido (`/embed/fluxo/[pmo]/[op]`) usa o **mesmo** `FluxoForm`; escrever/ajustar testes para provar que, **sem** nó `Saída`, o enquadramento (`enquadrar`) funciona e **com** nó `Saída` (OP antiga) é o de sempre.
- [ ] **3.3** Rodar `npx vitest run src/app/embed "src/app/(app)/shopfloor/fluxo"`; commit.

## Tarefa 4: etapa 2 pronta e DESLIGADA (posto automático em OP nova)

**Interruptor:** variável de ambiente de servidor `ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS`; ligada só se valer exatamente `1`. **Ausente = desligada**, e desligada tem de ser **100% idêntica ao comportamento de hoje** (testar). Liberar depois da decisão das placas = pôr a variável e reiniciar, sem novo deploy.

- [ ] **4.1** Ler `ordens-actions.ts` (criar e editar OP; `lerPostos`), `ordem-form.tsx` (estado `fluxo`, `adicionar`, `mover`, reset ao abrir) e `ordens/page.tsx`. Função pura `postoAlmoxarifadoDaOp(postosPerfil)` (a chave do **único** posto com perfil de recurso `almoxarifado`, ou `null` se não existe, ou erro `VARIOS_ALMOXARIFADOS` se houver mais de um). Testes primeiro.
- [ ] **4.2** `ordens-actions.ts`, **só em criar** (nunca em editar): com o interruptor ligado e o posto existente, acrescentar esse posto como **último** da rota (sem duplicar se já estiver); com `VARIOS_ALMOXARIFADOS`, recusar com a mensagem "Há mais de um posto com perfil Almoxarifado; mantenha só um." Sem o posto, criar sem ele. Testes: ligado/desligado, OP existente na edição **não** muda, padrão antigo vira rota com o Almoxarifado no fim, já presente não duplica.
- [ ] **4.3** `ordem-form.tsx`: com a flag (vinda do servidor por prop) e **OP nova**, mostrar o Almoxarifado como linha **fixa no fim, sem botão de remover**, e manter `mover`/`adicionar` sem deslocá-lo; na **edição** nada muda. Teste ao lado de `aviso-reativacao.test.tsx`: flag desligada = formulário idêntico ao de hoje.
- [ ] **4.4** `ordens/page.tsx` lê a variável **no servidor** e a passa por prop. Commit.

## Tarefa 5: verificação (feita por quem executa, antes de reportar)

- [ ] `npx tsc --noEmit` limpo; `npx vitest run --maxWorkers=2` **inteiro** verde (a suíte da `main` tem 241 arquivos e 2.672 testes); `NODE_OPTIONS="--max-old-space-size=4096" npx next build` sem erro.
- [ ] Relatório: hashes dos commits, o que foi testado, e **a prova de que OP sem Almoxarifado em último produz o mesmo grafo** (o snapshot da 1.1 passando, intacto, no fim).

## Fora do escopo

Backfill de rotas, qualquer SQL ou migração, mudar a finalização automática, decidir as placas, mudar o nome do card Concluído nas OPs antigas.
