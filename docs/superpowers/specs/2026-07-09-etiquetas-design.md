# Design — ShopFloor Enterplak: Etiquetas (Part Number)

**Data:** 2026-07-09
**Status:** Aprovado para planejamento
**Relaciona-se com:** spec macro (Incremento 2) e o módulo de Recebimento (concluído).

Substitui o Google Apps Script de geração de etiquetas de Part Number. Lê os processos de
recebimento já no sistema, gera o CSV de etiquetas (uma por volume) com as regras atuais
(validadas empiricamente contra o script), e registra cada geração para auditoria.

---

## 1. Regras do Part Number (validadas)

Por processo, uma etiqueta por volume. Formato:
`CÓDIGO` + `-` + `PEDIDO_FMT` + `DOC` + `SEQ`

- **CÓDIGO** = `codigo_material` sem hífens finais.
- **PEDIDO_FMT** = `numero_pedido` "0529/26" → "052926" (1º bloco com 4 dígitos + ano com 2).
  Fallbacks: sem barra, usa dígitos (4 primeiros + 2 últimos) ou 4 dígitos.
- **DOC** = `di_inpi` (só dígitos) se houver; senão `numero_nf` (só dígitos). Sem padding.
- **SEQ** = sequencial do volume, 2 dígitos (3 se volumes ≥ 100).
- **volumes** = campo `volumes`; inválido/≤0 → 1.

**CSV:** colunas `[PARTNUMBER, CODIGO, VOLUME]`, **sem cabeçalho**, campos entre aspas,
quebra de linha CRLF. `VOLUME` = "01-13" (atual-total, mesmo padding do SEQ). Arquivo
`Etiquetas_partnumber_YYYYMMDD_HHMMSS.csv`.

**Exemplo validado:** RWCN98 / 0529/26 / DI 26BR0000902016-1 / 13 vols →
`RWCN98-052926260000902016101` … `…113`, CODIGO `RWCN98`, VOLUME `01-13`…`13-13`.

Linhas incompletas (sem código, pedido ou documento) são **puladas**.

## 2. Fluxo
1. Tela **Etiquetas** (`/recebimento/etiquetas`, permissão `gerar_etiqueta`): busca por
   **NF / EMB / Fornecedor** (contém, sem case) sobre `processos_recebimento`.
2. Lista os processos encontrados com **prévia** (código, pedido, doc usado, volumes,
   prévia do 1º Part Number). Linhas incompletas ficam marcadas.
3. Usuário **seleciona** itens → **Gerar etiquetas (CSV)**.
4. Server Action gera o CSV (autoritativo), registra a geração + log, e devolve o CSV; o
   navegador **baixa** o arquivo. O CSV **não** é armazenado.
5. Tela **Histórico de Etiquetas** (`/recebimento/etiquetas/historico`): lista as gerações
   (quem, quando, filtro, nº de processos, nº de etiquetas).

## 3. Modelo de dados
**`geracoes_etiquetas`** (nova): `id`, `filtro_tipo` (nf/emb/fornecedor), `filtro_valor`,
`total_processos`, `total_etiquetas`, `processo_ids jsonb`, `usuario_id`, `usuario_nome`,
`created_at`. RLS: `select` = `visualizar`; `insert` = `gerar_etiqueta`. (O CSV em si não é
guardado; guardamos só o resumo de auditoria.)

## 4. Arquitetura
- **Domínio** (`modules/etiquetas/domain/partnumber.ts`, TS puro, TDD travado no exemplo
  validado): `normalizarCodigo`, `formatarPedido`, `resolverDoc`, `padSeq`, `formatarVolume`,
  `montarPartNumber`, `gerarEtiquetasDoProcesso(proc)` → linhas por volume + flag incompleto,
  `gerarCsv(linhas)` (aspas + CRLF, sem cabeçalho).
- **Infra:** `buscarProcessosParaEtiqueta({tipo, termo})` (busca por NF/EMB/Fornecedor);
  `registrarGeracao(...)` (insere em `geracoes_etiquetas`); `listarGeracoes()`.
- **Aplicação (Server Action):** `gerarEtiquetas(processoIds, filtro)` — checa
  `gerar_etiqueta`; carrega os processos; gera as linhas; registra geração +
  `registrarLog('etiqueta', …, 'gerar_etiqueta', …)`; retorna `{ csv, fileName, totalEtiquetas, totalProcessos, ignorados }`.
- **UI:** página de busca/seleção/geração (client faz o download via Blob) + tela de histórico.
  Item **Etiquetas** no menu Recebimento.

## 5. Permissões
- Gerar/baixar etiquetas: `gerar_etiqueta` (Recebimento, Supervisor, Admin já têm).
- Ver histórico: `visualizar`.

## 6. Testes
- Domínio travado no exemplo validado (RWCN98 → os 13 Part Numbers exatos), + casos de
  `formatarPedido` (0654/26, sem barra), `resolverDoc` (DI prioridade / fallback NF),
  `padSeq` (2 vs 3 dígitos ≥100), `gerarCsv` (aspas, CRLF, sem cabeçalho), linha incompleta pulada.

## 7. Fora de escopo
- Armazenar o arquivo CSV permanentemente (só o resumo de auditoria).
- Reimpressão a partir do histórico (poderá ser adicionada depois).
- Layout gráfico da etiqueta (o CSV alimenta o software de impressão existente).
