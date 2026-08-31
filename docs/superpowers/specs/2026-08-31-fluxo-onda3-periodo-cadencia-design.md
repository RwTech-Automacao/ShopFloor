# Fluxo de Processos — Onda 3 (período + cadência) — Design

**Data:** 2026-08-31
**Branch:** `feat/shopfloor-fluxo-processos`
**Escopo:** filtro por período (turno/dia/hora) + nova métrica de tempo = **cadência** (min/peça).
**Migração:** **0090** (nova RPC `sf_fluxo_periodo`).

## Ideia central

Hoje o Fluxo mostra métricas de TODO o período e o tempo entre postos (mediana, na aresta). A Onda 3
troca isso por uma visão **por período de trabalho**: escolhe-se um **dia** + uma **janela** (turno ou
faixa de horário) e cada posto passa a mostrar a **produção** e a **cadência** daquela janela.

**Cadência** (substitui o "tempo entre postos"): `minutos_da_janela ÷ peças_bipadas_no_posto` = min/peça.
Ex.: janela 07:00–10:00 (180 min), 20 peças bipadas no posto → **9 min/peça**. Mostrada na **linha que
SAI do posto** (a informação é da peça saindo daquele posto). Postos sintéticos (Entrada) não têm cadência.

## Filtro de período (barra do Fluxo)

1. **Data** (date input; padrão = hoje).
2. **Janela** (botões): **Dia** (padrão — matutino + vespertino somados) · **Matutino** (07:00–12:00) ·
   **Vespertino** (13:30–17:20) · **Personalizado** (2 inputs de horário início/fim; cobre também
   "uma hora específica"). Turnos vêm do usuário: matutino 07:00–12:00, vespertino 13:30–17:20.
3. Botão **"Produção total"** (toggle): quando ligado, as CONTAGENS do card mostram o total (todo o
   período), mas a **cadência continua da janela do filtro**.

### Minutos efetivos da janela

`minutos_efetivos = (min(fim_da_janela, agora) − início_da_janela)` — janela em andamento hoje conta só
até agora (não subestima a cadência). Para **Dia**, soma matutino + vespertino (exclui o almoço):
`min_efetivos(matutino) + min_efetivos(vespertino)`, e as peças = bipes nas DUAS faixas.

## Backend

**Migração 0090 — `sf_fluxo_periodo(p_pmo text, p_op text, p_ini timestamptz, p_fim timestamptz)`**
`returns table(posto text, registros int, aprovadas int, reprovadas int)` — bipes em `sf_registros`
com `data_hora` em `[p_ini, p_fim)`, agrupados por posto. `security definer`, gate
`tem_permissao('visualizar')`, `grant execute ... to authenticated`. (Mesmo padrão de 0088/0089.)

- Para **Dia**, o cliente chama a RPC 2× (matutino e vespertino) e **soma** registros/aprovadas/reprovadas
  por posto (mantém a RPC simples, 1 faixa por chamada).
- `sf_fluxo_op` (total, all-time) segue igual → alimenta **WIP** (sempre "agora"), **aprovados de 1ª** e as
  contagens do modo "Produção total". `sf_fluxo_tempos` (0089) deixa de ser usado no card (a cadência
  substitui); mantido no banco por ora (sem drop).

**Action** `carregarPeriodo(pmo, op, faixas: {ini,fim}[])` em fluxo-actions → soma as faixas → devolve
`{ registros, aprovadas, reprovadas } por posto` + `minutosEfetivos` (calculado no cliente).

## Frontend (fluxo-form + fluxo-node + floating-edge)

- **Estado**: `dataFiltro` (YYYY-MM-DD, hoje), `janela` ('dia'|'matutino'|'vespertino'|'custom'),
  `custom {ini,fim}`, `producaoTotal` (bool). Deriva as faixas `{ini,fim}[]` (1 ou 2) e os `minutosEfetivos`.
- Ao mudar filtro → chama `carregarPeriodo` → guarda `periodo` (map posto→{registros,aprovadas,reprovadas}).
- **Cadência por posto** = `minutosEfetivos / periodo[posto].registros` (— se 0). Passada às arestas: a
  aresta cuja ORIGEM é o posto recebe `data.cadencia` (segundos) → FloatingEdge mostra o rótulo (relógio
  MM:SS ou HH:MM:SS), substituindo o `segundos` (tempo entre postos). Entrada→1º posto: sem cadência.
- **Card do posto** (fluxo-node): quando há período e `producaoTotal` está DESligado, as contagens
  (aprovadas/devem-passar, reprovados) vêm de `periodo`; ligado → vêm do total (`dom`). O **WIP** e o
  **aprovados de 1ª (%)** seguem do total sempre (WIP é "agora"; 1ª-passagem é histórico). Um selo
  discreto no card/barra indica "período" vs "total".
- **Botão "Filtro" + MODAL** (não inline): um botão "Filtro" fica acima/ao lado do canvas (na barra de
  ações, junto de Redefinir/Modo TV) e **também dentro do Modo TV** (no cabeçalho do TV). Clicar abre um
  **modal** com todos os controles do período (data + botões de janela + inputs do personalizado + toggle
  "Produção total"). O modal usa portal com `container={containerTv}` (igual ao HistoricoSnDialog) pra
  aparecer por cima do canvas **em tela cheia** no Modo TV. Um resumo curto do filtro ativo (ex.: "Hoje ·
  Matutino") fica visível no botão/etiqueta pra saber o que está aplicado sem abrir o modal.
- Atualização ao vivo (15s): revalida também o período (a janela de hoje muda com o tempo).

## Fora de escopo / notas

- Não dropar `sf_fluxo_tempos`. Sem mudar `sf_fluxo_op`.
- "Hora específica" = Personalizado com faixa de 1h (sem preset dedicado).
- Ao mergear: promover **0090** no Prod/Dev/AWS-RDS (junto de 0088/0089 que ainda não subiram).
