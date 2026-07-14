# Spec — Trava de geração de etiqueta por elegibilidade (feature #5)

## Contexto
Feature #5 do roadmap (`docs/roadmap-pos-apresentacao.md`): só permitir **gerar etiqueta** para
processos **elegíveis**. Hoje não há trava de status (decisão anterior). O domínio
(`etiquetas/domain/partnumber.ts`) já tem `gerarEtiquetasDoProcesso(p)` que retorna
`{ incompleto: true }` quando faltam código, pedido ou documento (DI/INPI ou NF). A geração é a
Server Action `gerarEtiquetas` (`etiquetas/application/gerar-etiquetas.ts`), que já **ignora**
processos incompletos (contados em `ignorados`). O carregamento (`etiqueta-repository.ts`) traz
`ProcessoEtiqueta = { id, codigoMaterial, numeroPedido, diInpi, numeroNf, volumes }` — **sem status**.

## Objetivo
Gerar etiqueta ⇔ processo **elegível** = **status terminal** (concluído) **E** **campos completos**.
Requisitos aprovados; ambiente Dev não existe (mudanças em produção, sem dados reais).

## Requisitos (confirmados)
1. **Elegível = terminal E completo:**
   - **Terminal** = `ehTerminal(status)` — status **não é** `aberto` nem `em_conferencia`. **Não é
     hardcoded a Aprovado/Reprovado**: qualquer status terminal (inclusive um novo criado pelo
     Admin na lista "Resultado") vale.
   - **Completo** = Item Recebido (`codigo_material`), Nº Pedido (`numero_pedido`), **DI/INPI ou NF**
     (`di_inpi` ou `numero_nf`), e **Volumes ≥ 1** (`volumes`).
2. **UI (opção B):** a busca **mostra todos** os processos com **badge de status**; as linhas **não
   elegíveis não são selecionáveis** (checkbox desabilitado) e exibem o **motivo**:
   - não terminal → **"Aguardando conferência"**;
   - terminal mas faltando campo → **"Campos incompletos para etiqueta"**.
   O botão **Gerar** age só nas selecionadas (elegíveis).
3. **Servidor autoritativo:** `gerarEtiquetas` **pula** os não elegíveis (conta em `ignorados`) — não
   confia na UI. Mensagem clara quando nada sobra.

## Design

### Domínio (`etiquetas/domain/partnumber.ts`) — puro, testável (TDD)
- `ProcessoEtiqueta` ganha `status: string`.
- **Novo** `camposCompletosEtiqueta(p: ProcessoEtiqueta): boolean` — `true` sse
  `normalizarCodigo(codigoMaterial)` ≠ '', `formatarPedido(numeroPedido)` ≠ '',
  `resolverDoc(diInpi, numeroNf)` ≠ '', e `volumes` é número **≥ 1**. Reaproveita os helpers atuais.
- `gerarEtiquetasDoProcesso(p)` passa a usar `camposCompletosEtiqueta` no lugar da checagem inline
  (`if (!camposCompletosEtiqueta(p)) return { incompleto: true, etiquetas: [] }`) — isso **adiciona o
  `volumes ≥ 1`** ao critério de "incompleto" (hoje um processo com volumes 0/nulo gera 0 etiquetas
  sem ser contado).
- **Novo** `type MotivoInelegivel = 'aguardando' | 'incompleto'` e
  `elegivelParaEtiqueta(p: ProcessoEtiqueta): { elegivel: boolean; motivo: MotivoInelegivel | null }`:
  - `!ehTerminal(p.status)` → `{ elegivel: false, motivo: 'aguardando' }`;
  - senão `!camposCompletosEtiqueta(p)` → `{ elegivel: false, motivo: 'incompleto' }`;
  - senão `{ elegivel: true, motivo: null }`.
  - Importa `ehTerminal` de `@/modules/recebimento/domain/ciclo-vida` (predicado puro; fonte única
    do "terminal"). Cross-module domain import é aceitável (ambos TS puro).

### Infra (`etiquetas/infra/etiqueta-repository.ts`)
- `SELECT_CAMPOS` inclui `status`; `ProcessoEtiquetaRow` e `mapRow` ganham `status`. Vale para
  **busca** (`buscarProcessosParaEtiqueta`) e **geração** (`carregarProcessosPorId`).

### Aplicação (`etiquetas/application/gerar-etiquetas.ts`)
- No loop, trocar a checagem de `incompleto` por `elegivelParaEtiqueta`:
  ```ts
  for (const processo of processos) {
    if (!elegivelParaEtiqueta(processo).elegivel) { ignorados += 1; continue }
    linhas.push(...gerarEtiquetasDoProcesso(processo).etiquetas)
  }
  ```
- Mensagem quando `linhas.length === 0`: "Nenhuma etiqueta a gerar (processos não concluídos ou com
  campos incompletos)."

### UI (tela de Etiquetas — `app/(app)/recebimento/etiquetas/`)
- A tabela de resultados da busca passa a exibir uma coluna/badge de **status**
  (`rotuloStatusProcesso` do domínio de recebimento).
- Para cada linha, calcular `elegivelParaEtiqueta(processo)` (domínio puro, no cliente):
  - **elegível** → checkbox normal, selecionável.
  - **não elegível** → checkbox **desabilitado** + texto do **motivo** ("Aguardando conferência" /
    "Campos incompletos para etiqueta"). A linha não entra na seleção.
- O botão **Gerar** continua enviando só os `id`s selecionados (que já são elegíveis). O servidor
  revalida (autoritativo).
- Mapa de rótulo do motivo na UI: `{ aguardando: 'Aguardando conferência', incompleto: 'Campos
  incompletos para etiqueta' }`.

### Tratamento de erros
- Selecionar tudo não elegível é impossível pela UI (desabilitados); ainda assim, o servidor
  retorna a mensagem de "nada a gerar" se, por corrida/bypass, nenhum elegível sobrar.

### Testes
- **Domínio (TDD):** `camposCompletosEtiqueta` (código/pedido/doc/volumes — casos completo,
  faltando cada um, volumes 0/nulo/≥1); `elegivelParaEtiqueta` (aberto→aguardando,
  em_conferencia→aguardando, terminal+incompleto→incompleto, terminal+completo→elegível;
  status terminal "custom" também elegível). Ajustar o teste existente de `gerarEtiquetasDoProcesso`
  se o critério de incompleto mudar (volumes).
- **Infra/UI/aplicação:** build + smoke (padrão do projeto).

## Fora de escopo
- Filtrar a busca por status (opção A) — decidido mostrar todos (opção B).
- Backlog existente: coluna "Nº" da lista de etiquetas mostra índice, não `numero` (não faz parte
  desta feature; anotado em `.superpowers/sdd/progress.md`).

## Relação com outras features
- Depende do `ehTerminal` (#3a — já em produção). Sem migração (usa colunas existentes; só adiciona
  `status` ao SELECT das etiquetas).
