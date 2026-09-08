# Fluxo — Modo Apresentação (playlist / "Data Studio") — Design

**Data:** 2026-09-01
**Branch:** `feat/shopfloor-fluxo-perf` (empilhado com Onda 4 / correções)
**Escopo:** modo apresentação dentro do Fluxo — uma playlist de slides que roda em tela cheia.
**Migração:** nenhuma (só UI; reusa dados já existentes).

## Ideia

Um **modo apresentação** (tipo Data Studio) dentro da tela de Fluxo: o usuário monta uma **playlist
manual** de slides e roda em **tela cheia**, avançando **automático** (tempo ajustável) **+ setas**.
Serve pra TV do chão de fábrica rodando OPs/telas em rotação.

- **Slide** = `{ pmo, op, view }`, onde `view ∈ { fluxo, defeitos, dashboard }` (todas por OP).
- **Playlist manual**: o usuário adiciona slides (escolhe OP + view; atalho "adicionar as 3 views desta OP"),
  reordena (↑/↓) e remove. Persistida em **localStorage** (por máquina) pra reusar.
- **Avanço**: automático a cada **N segundos** (ajustável, ex.: 10/20/30s) **+ setas ← →** (manual) + **Esc** sai.
  Indicador do slide atual (ex.: "3/8") + barra de progresso do tempo.

## Onde / como (reuso, sem refatorar tudo)

O modo roda **na própria tela de Fluxo** (que já tem o canvas + Modo TV em tela cheia):
- **Slide `fluxo`**: reusa o **canvas do Fluxo** da própria página — o controlador seleciona a OP do slide
  (`sel`) e mostra em tela cheia (o Modo TV que já existe). Sem refatorar o canvas.
- **Slide `defeitos`**: renderiza a **DefeitosForm** (Onda 4) num overlay em tela cheia, com a OP do slide
  pré-carregada. → `DefeitosForm` ganha prop opcional `opInicial` (pré-seleciona + carrega).
- **Slide `dashboard`**: idem com a **DashboardForm** (por OP) → prop `opInicial`.

## UI

- Botão **"Apresentação"** na barra do Fluxo (perto de Redefinir/Modo TV) → abre um **painel da playlist**
  (lista de slides + adicionar/reordenar/remover + tempo por slide + botão **Iniciar**).
- Ao iniciar: entra em **tela cheia** (mesmo container do Modo TV, `containerTv`), mostra o slide atual,
  cabeçalho discreto com OP/view + "3/8" + controles (◀ ▮▶ tempo ▶ Sair). Auto-avança; setas do teclado
  e botões na tela; Esc/"Sair" encerra.
- Loop: ao chegar no fim, volta ao 1º (rotação contínua pra TV).

## Fora de escopo / notas

- Sem migração; reusa `carregarFluxo`, `carregarDefeitosDaOp`, `carregarDashboard`.
- Auto-refresh (15/20s) do fluxo continua valendo pro slide de fluxo visível (dado ao vivo).
- Performance: o slide de fluxo carrega a OP ao entrar; playlists grandes = muitas cargas — pausar/soltar
  cargas do slide anterior ao trocar. (2ª leva de perf trata o fluxo-load pesado.)
