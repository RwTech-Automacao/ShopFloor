# Card único Almoxarifado + Concluído no Fluxo da OP (rascunho para aprovação)

Estado: **rascunho de 20/10/2026**, sem código. Só começa **depois** do teste do Compels em produção. Restrição dura do usuário:
**não pode afetar nada que já foi criado.** Estudo anterior: memória `unificar-card-almoxarifado-concluido`.

## Objetivo

No Fluxo da OP existem dois cards no fim da rota: o do posto Almoxarifado (peças, caixas, "Disponível Produção") e o **Concluído** (nó `SAIDA`, contagem de
peças que concluíram a rota, com a faixa do estoque do Compels). Quando o Almoxarifado é o último posto, os dois mostram quase o mesmo número. Unificar
num card só, e deixar o posto Almoxarifado **pré-definido nas OPs novas**.

## Decisões do usuário

1. Card único ao fim da rota, **sem mudar rota de OP existente** e sem backfill; OPs antigas entram à mão, como hoje.
2. O card único vale **também no Fluxo embutido no Dashboard Enterplak**.
3. Nas OPs novas a **finalização automática passa a esperar a entrada no estoque** (o Almoxarifado, como último posto, manda no 100%).
4. **OPs de placa intermediária:** em aberto de propósito (elas deveriam entrar no estoque, mas não entram; o processo não está definido). Só prever um ponto de extensão.

## Achado central do mapeamento

A finalização automática e o % de conclusão **já usam o último posto da rota** (`sf_ordem_postos ... order by ordem desc limit 1`, `0121:25`; a 0145 e a 0148 só
chamam `sf_ops_com_bipes` e fecham com `pct >= 100`). Se uma OP nova nascer com o Almoxarifado no fim, ela só chega a 100% quando as peças derem entrada no estoque.
**A etapa 2 se resolve com dado (a rota), sem mudar o código da finalização.** O Fluxo embutido (`/embed/fluxo/[pmo]/[op]`) usa o **mesmo** `FluxoForm`, então a mudança vale lá sozinha.

## Desenho em duas etapas

### Etapa 1: só apresentação (sem banco, reversível)

- Função pura nova no domínio (por exemplo `ultimoEhAlmoxarifado(postos, recursoDe)`) usada em `construirFluxo` (`domain/fluxo-op.ts`). Parâmetro opcional, para os testes antigos seguirem iguais.
- **Último posto com recurso `almoxarifado`:** não cria o nó `SAIDA` nem a aresta `->Saída`. O nó do Almoxarifado recebe `pmo` e a contagem `finalizadas` e ganha a faixa **Estoque no Compels** embaixo
  (extrair a condição `ehSaida` do `EstoqueCompelsCard` para `ehSaida || mostrarEstoque`). Mantém as métricas atuais (aprovadas ÷ (passou+wip), caixas, Disponível Produção).
- **Último posto de outro tipo:** Concluído **exatamente como hoje**.
- Layout: a serpentina termina no Almoxarifado (um slot a menos). A Manutenção não muda de lugar (depende só do número de postos). O estoque do Compels é `absolute` e não altera a altura do nó.
- Busca de SN em `fluxo-form.tsx:802`: sem `SAIDA`, o "atual" cai no último posto, que é o Almoxarifado. Comportamento já certo; ajustar comentário e teste.

### Etapa 2: posto automático só nas OPs novas

- `ordens/ordem-form.tsx`: hoje `fluxo` começa com `ordem?.postos ?? []` (criar e editar são a mesma tela). Em **OP nova**, oferecer o Almoxarifado como último passo (caixa de seleção marcada), sempre **fixo no fim**; na edição não aparece.
- **Padrões** (`sf_padroes_fluxo`): padrões novos já salvam com o Almoxarifado; ao puxar um padrão **antigo** numa OP nova, acrescentar o Almoxarifado, visível e removível, **nunca por banco**. Sem migração.
- Ponto de extensão para as placas: uma função `almoxarifadoPadrao(contexto)` que hoje devolve sempre `true`; trocar por uma flag em `sf_ordens` ou uma regra por tipo quando o processo estiver definido.

## Como provar que nada mudou

- Etapa 1 não toca em SQL. Mesmo assim, comparar antes e depois a saída de `sf_fluxo_op` e os `finalizadas`/`wip` de várias OPs antigas, e um teste de contrato: `construirFluxo` sobre cada OP **sem** Almoxarifado em último produz o **mesmo grafo** (nós, arestas, posições) da versão atual (snapshot).
- Etapa 2: `select pmo, op, array_agg(posto order by ordem) from sf_ordem_postos group by 1,2` antes e depois, **idêntico** para as OPs existentes.

## Arquivos e testes

Código: `domain/fluxo-op.ts`, `fluxo-node.tsx`, `fluxo-form.tsx` (`:860` repassa `pmo`), e na etapa 2 `ordens/ordem-form.tsx`. Testes: `fluxo-op.test.ts` (novo caso almoxarifado-último; manter os
casos de Saída intactos), `fluxo-node.test.tsx`, `fluxo-node-estoque.test.tsx`, `fluxo-form-embed-enquadrar.test.tsx`, `fluxo-embed.test.tsx` e um teste novo do form de OP.

## Riscos

- OP com Almoxarifado **no meio** da rota deve manter o Concluído (a regra olha só o último). Testar.
- Almoxarifado em último, mas sem `qtd` ou com `finalizadas` nulo: o card único tem de tolerar `concluidas` ausente.
- OP nova com Almoxarifado em último muda o significado de "finalizada": peça embalada e não bipada deixa a OP ativa (era a intenção, mas gera OPs que "não fecham" até alguém bipar). Afeta o Dashboard e os alertas de OPs ativas.
- Embed e Modo TV: reenquadrar (uma coluna a menos).
- Padrão antigo puxado ganha o Almoxarifado sem o usuário notar: tem de ficar visível.
- Enquanto `COMPELS_OPS_LIBERADAS` existir, ela é só uma trava extra; quando o posto virar automático, passa a ser a única (decidir então se mantém ou muda para `*`).

## Perguntas em aberto (com a minha sugestão)

1. O número "Concluído" aparece no card do Almoxarifado ou basta o estoque do Compels e as métricas atuais (porque ≈ aprovadas)? *Sugestão: só o estoque e as métricas.*
2. OP com Almoxarifado em último e **sem caixas** (embalagem individual) usa o mesmo card único? *Sugestão: sim.*
3. O Almoxarifado automático nas OPs novas é uma **caixa marcada por padrão** ou um **botão explícito**? *Sugestão: caixa marcada.*
4. Padrões antigos puxados numa OP nova: acrescentar automaticamente ou só sugerir? *Sugestão: acrescentar, visível e removível.*
5. Placas intermediárias: **flag por OP** ou **regra por tipo/PMO**? *Em aberto até o processo ser definido; hoje não existe campo que as distinga.*
6. OP nova **sem `qtd`** ainda mostra o Concluído antigo? *Hoje o nó Saída some sem `qtd`; sugestão: manter.*
