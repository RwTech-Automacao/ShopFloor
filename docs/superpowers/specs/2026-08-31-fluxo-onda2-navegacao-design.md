# Fluxo de Processos — Onda 2 (navegação/escala) — Design

**Data:** 2026-08-31
**Branch:** `feat/shopfloor-fluxo-processos`
**Escopo:** 4 melhorias de navegação/escala no Fluxo. Sem migração (só leitura de `sf_ordens.created_at`).

## Itens

1. **Transição entre fluxos (loading/blur).** Ao trocar de OP (`carregando` = transition do `carregarFluxo`),
   o canvas atual fica **borrado** com um overlay central (spinner + "Carregando fluxo…") por cima, em vez
   do texto "Carregando…". Some ao terminar. Só na área do canvas. *(fluxo-form)*

2. **Limite 100 + lazy load no detalhe do posto.** As listas do painel de detalhe (Peças travadas /
   Pendentes no posto / Histórico do posto / Burn-in) renderizam **100 itens** e revelam **+100 ao rolar**
   até o fim (`onScroll` no container, `useState` de "quantos mostrar" por lista, resetado ao trocar de
   posto/lista). Windowing **client-side** — `detalhePosto` já traz a lista inteira num fetch; sem
   round-trips extras. *(componentes de lista + fluxo-form)*

3. **Busca de SN → realce da rota no canvas (estilo n8n).** Caixa de busca de SN na barra do Fluxo
   (input + Enter). Ao buscar: reusa `buscarHistoricoSN(sn)`, **filtra os registros pra OP atual**, deriva
   a **rota** (postos por onde a peça passou, em ordem cronológica, sem repetir) + a **posição atual**
   (último posto pendente via `postoPendenteDePeca`, ou o último posto registrado). No canvas:
   - nós da rota ganham realce (anel/glow);
   - as arestas entre postos consecutivos da rota ficam **"executando"** (animação de preenchimento —
     reusa `EdgeAtivo` + `.fluxo-preenche`);
   - o nó da posição atual em destaque mais forte.
   Botão **limpar** (X) remove o realce. SN não encontrado nesta OP → aviso (toast). *(fluxo-form + fluxo-node + edge)*

4. **Filtro por data de criação da OP.** `listarOrdens` passa a selecionar `created_at` → `OpItem.criadoEm`.
   No dropdown de OP, junto do filtro de texto, um filtro por **data de criação**: presets **Hoje · 7 dias ·
   30 dias · Tudo** (+ intervalo opcional com 2 date inputs). Reduz a lista grande (OP>2000). *(listarOrdens + OpItem + fluxo-form)*

## Fora de escopo

Métricas/tempo e filtros temporais internos (Onda 3), páginas novas (Onda 4). Sem migração.
