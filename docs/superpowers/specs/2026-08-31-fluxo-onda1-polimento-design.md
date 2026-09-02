# Fluxo de Processos — Onda 1 (polimento visual) — Design

**Data:** 2026-08-31
**Branch:** `feat/shopfloor-fluxo-processos` (da main; Layout B já portado)
**Escopo:** 8 ajustes visuais no card/canvas do Fluxo. Sem migração.

## Contexto

O Fluxo (`/shopfloor/analisar/fluxo`) usa React Flow. O card do posto é o **Layout B**
(`fluxo-node.tsx`): cabeçalho (nome + ícone) em cima e uma subdivisão embaixo (barra de
progressão por APROVADAS + métricas). Há também as caixas de **Entrada** (não iniciadas) e
**Saída** (finalizadas).

## Itens

1. **% da barra acompanha o preenchimento.** Hoje a % fica centralizada em branco sobre a barra
   da subdivisão. Trocar pelo comportamento do Layout A antigo: a % fica **à direita da borda do
   verde** (preta, no trilho) enquanto há espaço; perto de 100% (`pctB >= 85`) **entra pra dentro**
   do verde (branca). Fórmula: `right: calc(${100-pctB}% + 6px)` (dentro) / `left: calc(${pctB}% + 6px)` (fora).

2. **Caixa de Saída → "Concluído".** O rótulo `Saída` da caixa final vira `Concluído`
   (subtítulo "finalizadas" mantido).

3. **Ícone do Burn-in → termômetro.** `Flame` → `Thermometer` (lucide) no `iconeDo`.

4. **Sem pontos pretos de conexão.** Regra CSS `.fluxo-canvas .react-flow__handle { opacity: 0 }`
   em `globals.css` — os handles somem visualmente; arestas continuam conectando.

5. **Contorno do card concluído totalmente arredondado.** Só o contorno: quando o posto está
   concluído (ou é Manutenção), o **cabeçalho** usa `rounded-xl` (em vez de `rounded-t-xl`), então
   a borda de destaque fecha arredondada embaixo também. **Nada mais muda no card** (sem folga, sem
   mexer na subdivisão). Card não-concluído continua `rounded-t-xl` (colado na subdivisão).

6. **Fluxo no menu lateral.** Adicionar item **"Fluxo"** no grupo *Fluxo de Processos*
   (`app-shell.tsx`, array `SHOPFLOOR`): `href: '/shopfloor/analisar/fluxo'`, ícone `Workflow`,
   `modulo: 'shopfloor'`, `perm: 'visualizar'`.

7. **Card de Entrada com PMO + descrição.** A caixa de **Entrada** passa a mostrar a **PMO** e a
   **descrição** (cortada em **≤20 caracteres**), além da contagem. Requer levar `pmo` e `descricao`
   ao node data da Entrada (`FluxoNodeData` + preenchimento no builder/form).

8. **Tooltips em todos os números.** `title` explicativo onde falta: **WIP** (mini-card do posto),
   contagem da **Entrada** (não iniciadas) e da **Saída/Concluído** (finalizadas). Os números da
   subdivisão (aprovadas, % de 1ª, reprovados sem reteste) já têm tooltip.

## Fora de escopo

Nada de backend/RPC/migração. Métricas de tempo, filtros temporais, lazy loading, busca de SN e
páginas novas ficam para as ondas 2–4.
