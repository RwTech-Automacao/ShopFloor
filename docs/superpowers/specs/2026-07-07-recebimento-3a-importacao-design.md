# Design — ShopFloor Enterplak: Recebimento 3A — Importação

**Data:** 2026-07-07
**Status:** Aprovado para planejamento
**Relaciona-se com:** `2026-07-07-fundacao-recebimento-design.md` (spec macro, Seção 5) e os Planos 1–2 (concluídos).

Primeiro sub-plano do módulo de **Recebimento**. Entrega o wizard de importação de
planilhas (o coração do fluxo: planilha do Comercial → Processos de Recebimento), o
histórico de importações e uma lista básica de processos. O formulário completo e o
ciclo de vida ficam para o 3B.

---

## 1. Escopo

**Dentro:**
- Wizard de importação `.xlsx`/`.csv` em `/recebimento/importar` (4 passos).
- Importação transacional (RPC) que cria a `importacao` + N `processos_recebimento`
  (status `aberto`) + 1 log `importar`.
- Histórico de importações em `/recebimento/importacoes` (menu Recebimento).
- Lista básica de processos em `/recebimento/processos` (número, NF, fornecedor,
  material, status) — só leitura por enquanto.

**Fora (3B):** formulário completo do processo, ciclo de vida (Em Conferência →
Finalizado/Cancelado, Reabrir), log de alterações de campo, filtros avançados.

---

## 2. Decisões desta rodada
- **Um log `importar` por importação** (arquivo, totais, mapeamento) — não um log por
  processo (evita explosão de milhares de linhas de log). A criação de cada processo
  fica rastreável por `importacao_id` + `created_at`.
- **Aberto → Em Conferência automático** no primeiro salvamento do processo (efeito no 3B).
- **Histórico de importações no menu Recebimento** (acessível a quem tem `importar`/
  `visualizar`), não em Configurações.
- Linhas chegam à RPC **já mapeadas e validadas** no cliente; RPC + RLS + constraints
  do banco são a rede de segurança final.

---

## 3. Arquitetura

Segue as camadas dos planos anteriores (`app/` fino → `modules/recebimento/{domain,
application,infra}`; domínio TS puro).

### 3.1 Parsing no navegador (SheetJS)
- Dependência nova: `xlsx`. O arquivo é lido **no cliente**; só os dados estruturados
  (colunas + linhas) e o mapeamento seguem ao servidor. Arquivo bruto não trafega.

### 3.2 Domínio (TS puro, testável)
- `sugerirMapeamento(colunasPlanilha: string[], campos: CampoComercial[]): Record<string,string>`
  — casa coluna→campo por nome normalizado (minúsculas, sem acento/pontuação);
  sugestão, não fixação.
- `converterValor(valor: unknown, tipo: 'texto'|'lista'|'numero'|'data'): { ok: true; valor: unknown } | { ok: false; erro: string }`
  — numérico/data/texto; valida valor de lista contra itens ativos (recebe a lista).
- `validarLinha(linha, campos, itensPorLista): { erros: { campo; erro }[]; convertida: Record<string,unknown> }`
  — aplica `converterValor` e checa `obrigatorio_importacao`.

### 3.3 Importação transacional (migration 0008 — RPC)
`importar_processos(p_arquivo_nome text, p_formato text, p_mapeamento jsonb, p_linhas jsonb) returns jsonb`
- **SECURITY INVOKER** → RLS aplica (o usuário precisa de `importar`). Numa transação:
  1. `insert into importacoes(...)` → `v_id`;
  2. `insert into processos_recebimento (importacao_id, status='aberto', criado_por=auth.uid(), <colunas comerciais>) select ... from jsonb_populate_recordset(null::processos_recebimento, p_linhas)`;
  3. `update importacoes set total_processos_criados` = nº inserido;
  4. `insert into logs (...) values ('importacao', v_id, 'importar', resumo, {arquivo,formato,total,mapeamento}, auth.uid(), nome)`.
- Retorna `{ importacao_id, total }`. Tudo entra ou nada.

### 3.4 Camada de aplicação/infra
- `modules/recebimento/infra/importacao-repository.ts`: `importar(payload)` chama a RPC
  (`supabase.rpc('importar_processos', {...})`); `listarImportacoes()`.
- `modules/recebimento/infra/processo-repository.ts`: `listarProcessos({pagina,tamanho})`
  (colunas básicas), read-only no 3A.
- `modules/recebimento/application/*`: casos de uso finos (validar payload de importação
  + `podeFazer('importar')`, chamar a RPC).

---

## 4. Telas
- **`/recebimento/importar`** — wizard (Selecionar → Mapear → Preview → Importar),
  com botão "Histórico de Importações". Requer `importar`.
- **`/recebimento/importacoes`** — histórico (arquivo, data/hora, usuário, nº de
  processos). Requer `visualizar`.
- **`/recebimento/processos`** — lista básica (número, NF, fornecedor, código+descrição
  do material, status), paginada. Requer `visualizar`.
- Guard: um layout `(app)/recebimento/layout.tsx` que exige `visualizar`; a rota
  `importar` valida `importar` adicionalmente.

---

## 5. Tratamento de erros
- Erros de parsing (arquivo inválido/corrompido) → mensagem clara no passo 1.
- Erros de validação por linha/campo → destacados no preview; importação só habilita
  quando não há erros bloqueantes.
- Falha da RPC → toast com mensagem; nada é gravado (transação).

## 6. Testes
- Vitest no domínio: `sugerirMapeamento`, `converterValor` (numérico/data/lista/texto),
  `validarLinha` (obrigatórios + erros).
- RPC verificada por uma importação real de poucas linhas via `supabase db query`
  (confere importacao + processos + 1 log criados; e rollback em erro).

## 7. Fora de escopo
- Formulário e ciclo de vida do processo (3B).
- Salvar/reutilizar templates de mapeamento (spec macro: mapeamento é manual a cada vez).
- Geração de etiquetas (Incremento 2).
