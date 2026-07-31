# Integração vira posto (por bipe) — Design

> **Data:** 2026-07-30 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-ondas`
> **Tipo:** feature grande (redesenho da Integração). **Precisa de migração no Dev.** Fluxo Dev × Prod.
> Onda da reunião: *"Integração vira um posto junto aos outros, não uma aba separada + mudança grande."*

## Contexto

Hoje a **Integração** é uma **aba separada** em Operação (`Lançamento | Integração | Manutenção`), com tela
própria (`operar/integracao`). Nela o operador escolhe o produto (OP com Integração no fluxo) e **adiciona
cada placa manualmente** (escolhe PMO + OP + bipa o SN), valida contra a **receita da OP**
(`sf_ordem_componentes`), e registra o vínculo produto↔placas (`sf_integrar` → `sf_integracoes` +
`sf_integracao_itens` + linhas em `sf_registros` com `posto='Integração'` fixo + `id_integracao`).

Pontos name-tied de hoje: `integracao-actions.ts` casa `'Integração'` (linhas 51, 76); o RPC `sf_integrar`
grava `sf_registros` com `posto='Integração'` literal (0032, linhas 102/105).

Pedido (usuário, 2026-07-30):
1. **Integração sai da aba e vira posto no Lançamento** — ao escolher o posto Integração na lista suspensa do
   Lançamento, abre o painel de Integração ali mesmo; a aba some.
2. **Bipe automático:** a receita já vem listada (1 linha por PMO); o operador **só bipa SNs de placa** num
   campo só, e o **sistema descobre a OP/PMO de cada SN** (pela faixa) e encaixa na linha certa.

Decisões (usuário): **1 placa por PMO**; placa **não-aprovada passa** (por ora); **receita por OP** (não por
posto — cobre 1 Integração por OP; per-posto = Fase 2).

## Objetivo

Integração deixa de ser aba e vira posto do Lançamento, com registro **por bipe** (matching SN→OP→PMO
automático), e o comportamento dirigido por **perfil** (recurso integracao) em vez do nome fixo.

## Escopo

**Dentro:**
- Remover a **aba Integração** (`operar/layout.tsx`); a rota `operar/integracao` redireciona pro Lançamento.
- **Lançamento:** ao selecionar um posto de recurso `integracao`, renderizar o **painel de Integração por
  bipe** (componente próprio) no lugar do painel de "Peça/Nº de Série".
- **Matching por bipe** (server): `resolverPlacaIntegracao(pmoProduto, opProduto, sn)` acha a OP/PMO da placa
  pela faixa, restrito à receita do produto.
- **Perfil-driven:** `integrar` action e RPC `sf_integrar` operam no **posto integracao do fluxo** (não
  'Integração' fixo). RPC ganha `p_posto`.
- **Reabilitar** o perfil Integração no "Novo posto" (sai de `RECURSOS_NAO_ATRIBUIVEIS`) — agora funciona.

**Fora (confirmado):**
- **Receita por posto** / múltiplos Integração por OP (Fase 2). Receita segue **por OP**.
- **Quantidade > 1 placa por PMO** (Fase 2).
- **Bloquear** placa não-aprovada no fluxo dela (por ora passa; N1 de faixa continua).
- **Burn-in por posto** (feature separada — esta é só Integração).
- A "Busca por Nº de Série" da tela antiga: **sai do painel** (a Pesquisa já busca por SN) — alinha com o
  backlog "consolidar busca por SN".

## Design

### 1. Migração — `supabase/migrations/0064_sf_integrar_por_posto.sql`
Redefinir `sf_integrar` pra receber `p_posto text` e usar nas inserções de `sf_registros` (em vez de
`'Integração'` literal). Como muda a aridade, **dropar a assinatura antiga** primeiro (precedente da 0033/0035).
```sql
drop function if exists public.sf_integrar(<assinatura atual>);
create or replace function public.sf_integrar(..., p_posto text) ...
  -- nas 2 inserções em sf_registros, trocar 'Integração' por p_posto.
```
(Sem mudança na receita/tabelas. Só o RPC.) Aplicada **só no Dev** nesta etapa. **0064.**

### 2. Domínio — `src/modules/shopfloor/domain/integracao-matching.ts` (novo, testável)
- `interface FaixaOp { pmo: string; op: string; sn_ini: string; sn_fim: string }`.
- `resolverPlaca(receita: string[], faixas: FaixaOp[], sn: string): { ok: true; pmo: string; op: string } | { ok: false; erro: 'SEM_OP' | 'FORA_RECEITA' | 'AMBIGUO' }`:
  - candidatos = faixas cujo `serieDentroDaFaixa(sn_ini, sn_fim, sn)` **e** `receitaPermite(receita, pmo)`.
  - 0 candidatos → se existe faixa que contém o SN mas fora da receita → `FORA_RECEITA`; senão `SEM_OP`.
  - 1 candidato → `{ ok, pmo, op }`. >1 → `AMBIGUO`.
  - Testes cobrindo cada caso (usa `serieDentroDaFaixa`/`receitaPermite` já existentes).

### 3. Application
- **`resolverPlacaIntegracaoAction(pmoProduto, opProduto, sn)`** (nova, em `integracao-actions.ts`):
  - guard `lancar`; carrega a OP do produto (`carregarOrdem`) → `receita = ordem.componentes`; `faixas =
    listarFaixasOrdens()`; chama `resolverPlaca(receita, faixas, sn)`; retorna `{ pmo, op, descricao? }` ou erro
    amigável (SN não é de nenhuma placa / PMO fora da receita / ambíguo). (descricao = da OP resolvida, opcional.)
- **`integrar` action:** trocar os pontos name-tied:
  - `ordem.postos.includes('Integração')` → achar o **posto integracao** do fluxo: `const mapa = await
    mapaPostoPerfil(); const postoIntegr = ordem.postos.find((p) => mapa[p]?.recurso === 'integracao')`; se não
    houver → erro "OP não tem posto de Integração".
  - `postoAnteriorNaSequencia('Integração', ...)` → `postoAnteriorNaSequencia(postoIntegr, ordem.postos)`.
  - passar `p_posto: postoIntegr` no `chamarSfIntegrar`.
  - resto igual (faixa do produto, N1 das placas, receita via RPC).
- `chamarSfIntegrar` (infra) ganha `p_posto: string` no tipo dos args.

### 4. UI
- **`operar/layout.tsx`:** remover a aba `Integração` (fica `Lançamento | Manutenção`).
- **`operar/integracao/page.tsx`:** virar `redirect('/shopfloor/operar/lancamento')` (ou remover a pasta e a
  rota; redirect é mais seguro p/ links salvos).
- **`lancamento-form.tsx`:** quando `perfilDo(posto).recurso === 'integracao'`, em vez do bloco de Peça,
  renderizar `<IntegracaoPanel produto={{pmo, op, cliente, descricao}} colaborador={...} />`. (O contexto
  Colaborador/Cliente/PMO/OP/Posto do Lançamento já é o produto.)
- **`operar/lancamento/integracao-panel.tsx`** (novo, client) — reusa a lógica da `integracao-form` + o
  mockup validado:
  - Lista a **receita** (PMOs de `ordemSel.componentes`), 1 linha por PMO (PMO · descrição · SN · status).
  - **Campo de bipe** único: ao bipar, chama `resolverPlacaIntegracaoAction` → encaixa na linha da PMO
    (verde "encaixada", mostra SN + OP). Erros: SN sem OP / fora da receita / PMO já preenchida.
  - **Produto Final (Nº de Série):** reusa o campo de SN do Lançamento (ou um campo próprio no painel).
  - Botão **Registrar Integração** (habilita quando todas as PMOs preenchidas + produto final) → chama
    `integrar({ colaborador, pmo, op, produtoSN, placas })` (placas montadas a partir das linhas resolvidas).
  - **Sem** a "Busca por Nº de Série" (Pesquisa cobre).

### 5. Reabilitar o perfil
- `perfil-posto.ts`: tirar `'integracao'` de `RECURSOS_NAO_ATRIBUIVEIS` (fica só `['burnin','manutencao']`) —
  agora um posto novo de perfil Integração funciona (usa a receita da OP dele).

## Critérios de sucesso
- A aba Integração some; a Integração é registrada **no Lançamento** ao escolher o posto.
- Bipar SN de placa → sistema encaixa na PMO certa (via faixa/receita); SN sem OP/fora da receita → erro claro;
  placa não-aprovada passa.
- Registrar integração grava igual a hoje (produto + placas em `sf_registros` com `posto` = o posto integracao,
  `id_integracao`, `sf_integracoes`/`_itens`) — **gate do Lançamento e cancelamento seguem funcionando**.
- Um **posto novo** de perfil Integração (na OP dele, com receita) funciona igual.
- Perfil Integração volta ao "Novo posto". Build/testes verdes; migração `0064` só no Dev.

## Riscos / considerações
- **Redefinir `sf_integrar`** (novo `p_posto`): dropar assinatura antiga; smoke pesado da Integração
  (registrar + gate no Lançamento + cancelar).
- **Matching ambíguo:** se duas OPs de placa (mesma ou PMOs diferentes) têm faixas que contêm o mesmo SN e
  ambas na receita → `AMBIGUO` (raro; a receita costuma ter 1 OP ativa por PMO). Reportar erro claro; refinar
  na Fase 2 se aparecer.
- **Painel dentro do Lançamento:** extrair `<IntegracaoPanel>` como componente próprio p/ não inchar o
  `lancamento-form`. A troca peça↔integração é por `recurso`.
- **Rota antiga:** redirect evita link quebrado.
- Receita por OP: 2 postos Integração na mesma OP compartilhariam a receita (fora de escopo; per-posto = Fase 2).
