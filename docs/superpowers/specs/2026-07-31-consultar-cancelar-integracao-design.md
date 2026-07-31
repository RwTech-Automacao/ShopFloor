# Consultar / Cancelar Integração — Design

> **Data:** 2026-07-31 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-consulta-cabecalho`
> **Tipo:** trazer de volta a consulta/cancelamento de Integração (perdeu a UI quando a aba virou posto).
> **Sem migração.** Reusa RPC/actions existentes. Corrige um buraco vivo em Prod (cancelamento sem tela).

## Contexto

Quando a Integração virou posto (0064, e66d848), a **aba de Integração em Operar** foi removida (vira redirect
pro Lançamento). Com ela sumiu a parte de **consultar/cancelar**: hoje, em Prod, se alguém integra errado **não
há como cancelar pela interface** nem liberar os SNs presos (o usuário bateu nisso no smoke — precisei limpar
integrações de teste direto no banco). O backend está **órfão mas pronto**:
- `buscarIntegracaoPorSn(snNorm)` — acha a integração ATIVA em que o SN aparece como **produto OU placa**,
  devolvendo `IntegracaoDetalhe` (código, cliente, PMO/OP, colaborador, qtd, itens[Produto+Placas]).
- `cancelarIntegracao(codigo)` (action, exige `administrar`) → RPC `sf_cancelar_integracao` (marca CANCELADA +
  apaga os `sf_registros`, liberando produto e placas).

**Problema novo (da Integração por posto, 0066):** um mesmo **produto** pode estar em **várias integrações
ATIVAS** (uma por posto de Integração no fluxo). O `buscarIntegracaoPorSn` usa `.maybeSingle()` no produto →
**estoura** com "multiple rows" nesse caso. Precisa devolver **todas** e mostrar o **posto** de cada.

## Objetivo

Reconstruir a **consulta/cancelamento** como aba própria em **Operar** (`Lançamento | Manutenção | Consultar
Integração`), fiel à antiga, com: busca por SN (produto ou placa) → mostra **todas** as integrações ativas
daquele SN (com o **posto**) → **cancelar** (só admin). Duas modernizações: diálogo de confirmação do sistema
(não `window.confirm`) e campo bipe-friendly.

## Escopo

**Dentro:**
- Aba "Consultar Integração" em Operar; a rota `operar/integracao` deixa de ser redirect e vira a tela.
- `buscarIntegracaoPorSn` → devolve **lista** (`IntegracaoDetalhe[]`) e `IntegracaoDetalhe` ganha `posto`.
- Tela: busca por SN → N blocos (um por integração ativa), cada um com código, resumo, posto, tabela
  Produto+Placas, e botão **Cancelar integração** (só `administrar`).
- Cancelar usa `useConfirmacao`; após cancelar, re-busca (o bloco cancelado some).

**Fora:**
- Registrar integração (já é no Lançamento por bipe).
- Lista/navegação de integrações sem SN (a antiga não tinha; YAGNI).
- Motivo de cancelamento / ver canceladas (a antiga não tinha; se quiserem, onda futura).

## Design

### 1. Infra — `integracao-repository.ts`
- `IntegracaoDetalhe` ganha `posto: string` (a coluna `sf_integracoes.posto` existe desde 0066).
- `montarDetalhe` inclui `posto: row.posto` (e o `IntegracaoRow` + `CAMPOS_HDR` passam a selecionar `posto`).
- Trocar `buscarIntegracaoPorSn(snNorm): IntegracaoDetalhe | null` por:
  ```ts
  /** TODAS as integrações ATIVAS em que o SN aparece como produto OU placa (produto pode
   *  estar em várias — uma por posto). Ordenadas por data desc. */
  export async function buscarIntegracoesPorSn(snNorm: string): Promise<IntegracaoDetalhe[]>
  ```
  Implementação: (a) como **produto** — `select ... where produto_sn_norm = snNorm and status='ATIVA'`
  (SEM `maybeSingle`, pode ter N); (b) como **placa** — join `sf_integracao_itens` → `sf_integracoes` ATIVA
  `where placa_sn_norm = snNorm`; combinar as duas, **dedup por `codigo`**, montar `IntegracaoDetalhe` de cada,
  ordenar por `dataHora` desc.

### 2. Application — `integracao-actions.ts`
- `buscarIntegracao(sn)` passa a devolver a **lista**:
  ```ts
  { ok: true; detalhes: IntegracaoDetalhe[] } | { ok: false; erro: string }
  ```
  (normaliza o SN, chama `buscarIntegracoesPorSn`; `[]` = nenhuma ativa; permissão `lancar`.)
- **`resolverPlacaIntegracaoAction` (2º consumidor, ~linha 153)** também chama `buscarIntegracaoPorSn` (o aviso
  "placa já vinculada" no bipe). Ajustar pra nova assinatura em lista: `const vinc = await
  buscarIntegracoesPorSn(normalizarSerie(sn)); if (vinc.length > 0) return { ok:false, erro: \`Placa já vinculada
  à integração ${vinc[0]!.codigo}.\` }`. (Placa é única global → 0 ou 1; comportamento idêntico.)
- `cancelarIntegracao(codigo)` — **inalterada** (exige `administrar`, chama a RPC, loga).

### 3. Rota + aba
- **`operar/layout.tsx`:** `ABAS` += `{ rotulo: 'Consultar Integração', href: '/shopfloor/operar/integracao' }`.
- **`operar/integracao/page.tsx`:** deixa de ser `redirect`; vira server component: `getSessao`, calcula
  `podeCancelar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')`, guarda de acesso (precisa `lancar`
  pra ver — senão redireciona/lança), e renderiza `<ConsultaIntegracaoForm podeCancelar={podeCancelar} />`.

### 4. Client — `operar/integracao/consulta-integracao-form.tsx` (novo)
- Estado: `buscaSN`, `detalhes: IntegracaoDetalhe[]`, `buscou: boolean`, transições `buscando`/`cancelando`.
- Card "Buscar por Nº de Série": `<Input>` (autoFocus, `onKeyDown` Enter → `onBuscar`, refoca depois) + botão Buscar.
- `onBuscar`: chama `buscarIntegracao(buscaSN)`; ok → `setDetalhes(r.detalhes); setBuscou(true)`; erro → toast.
- Vazio: `buscou && detalhes.length === 0` → "Nenhuma integração ativa encontrada para esse SN."
- Para cada `detalhe`: bloco com `codigo`, resumo (`cliente · PMO/OP · **posto** · N placa(s) · por colaborador`),
  tabela (Tipo[Produto/Placa] · PMO · OP · SN; Produto destacado), e — se `podeCancelar` — botão
  **"Cancelar integração"** (destructive).
- `onCancelar(codigo)`: `useConfirmacao` ("Cancelar a integração {codigo}? Produto e placas ficam livres pra
  re-integrar."); confirmado → `cancelarIntegracao(codigo)`; ok → toast + **re-busca** (`onBuscar` no mesmo SN)
  pra atualizar a lista; erro → toast. (`dialog` do hook renderizado uma vez.)

## Critérios de sucesso
- Bipar/digitar o SN de um **produto** ou de uma **placa** mostra a(s) integração(ões) ativa(s) daquele SN.
- Produto integrado em **2 postos** aparece como **2 blocos** (com o posto de cada) — sem erro "multiple rows".
- Admin cancela → some da lista, produto/placas liberados (a re-integração deixa de barrar). Não-admin não vê o botão.
- Build/lint/test verdes. Sem migração.

## Riscos / considerações
- **Mudança de contrato** de `buscarIntegracaoPorSn` (single → lista, renomeado `buscarIntegracoesPorSn`): dois
  consumidores — `buscarIntegracao` (action órfã, sendo reintroduzida) e `resolverPlacaIntegracaoAction` (aviso
  no bipe, **ativo** — ajustar junto, ver §2). `IntegracaoDetalhe` ganhar `posto` é aditivo.
- **Dead code:** `listarOrdensParaIntegracao`/`OrdemIntegracao` continuam sem uso (a nova tela não precisa deles);
  limpeza segue no backlog, fora desta feature.
- Sem teste unitário novo (infra/DB + client); verificação por build + smoke (produto 1-posto, produto 2-postos,
  placa, cancelar como admin e como não-admin).
