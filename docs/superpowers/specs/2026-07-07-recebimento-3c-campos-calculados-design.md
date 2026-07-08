# Design — ShopFloor Enterplak: Recebimento 3C — Campos Calculados

**Data:** 2026-07-07
**Status:** Aprovado para planejamento
**Relaciona-se com:** 3A/3B (concluídos), spec macro (`configuracao_campos`, tipo "calculado" previsto como tipo futuro).

Adiciona **campos calculados** (fórmulas) ao Processo de Recebimento: 5 campos deixam de
ser preenchidos à mão e passam a ser derivados automaticamente, mais duas tabelas de
referência configuráveis pelo Admin.

---

## 1. Campos calculados

| Campo | Fórmula | Entrada(s) |
|---|---|---|
| **atraso** | Data Chegada − Data Prevista (nº de dias, com sinal) | `data_chegada`, `data_prevista` |
| **divergencia** | Quantidade Recebida − Quantidade no Pedido | `quantidade_recebida`, `quantidade_pedido` |
| **critico** | Busca `fornecedor` na tabela *Criticidade por Fornecedor* → Sim/Não | `fornecedor` + tabela |
| **amostral** | Busca `quantidade_recebida` na tabela *NQA* → tamanho da amostra | `quantidade_recebida` + tabela |
| **responsavel_contagem** | Nome do usuário do **1º preenchimento** (write-once) | sessão |

No formulário, esses campos ficam **somente-leitura** e se recalculam ao vivo conforme as
entradas mudam. O valor **oficial** é recalculado e gravado no servidor ao salvar.

## 2. Decisões
- **Atraso:** número de dias com sinal (positivo = atrasou; negativo = adiantou).
- **Amostral:** base = **Quantidade Recebida**.
- **Crítico:** valores **Sim/Não**.
- **Responsável:** fixado no **1º salvamento** (não muda depois).
- Tabelas *Criticidade por Fornecedor* e *NQA* são **configuráveis** (Admin popula); não
  hardcoded. As faixas padrão da NQA já vêm cadastradas (tamanho de amostra em branco).
- Import: no 3C, os calculados são preenchidos **ao abrir/salvar** o processo (não na
  importação). Compute-na-importação fica como melhoria futura.

## 3. Modelo de dados

### 3.1 `configuracao_campos` (estende)
Novas colunas: `calculado boolean default false`, `formula text` (nulo; ∈
`diferenca_dias` / `diferenca_numerica` / `lookup_fornecedor_critico` / `tabela_nqa` /
`usuario_primeiro`), `formula_config jsonb default '{}'`. Migration semeia os 5 campos
acima como `calculado=true` com sua `formula` e `formula_config` (nomes dos campos de
entrada).

### 3.2 `criticidade_fornecedor` (nova)
`id`, `fornecedor text unique`, `critico text` (Sim/Não), `created_at`. RLS: leitura para
autenticados; escrita para `administrar`.

### 3.3 `tabela_nqa` (nova)
`id`, `quantidade_min int`, `quantidade_max int` (nulo = faixa aberta, "500001+"),
`tamanho_amostra numeric` (nulo até o Admin preencher), `ordem int`, `created_at`. RLS
igual. Seed das faixas AQL padrão: 0–0, 1–1, 2–8, 9–15, 16–25, 26–50, 51–90, 91–150,
151–280, 281–500, 501–1200, 1201–3200, 3201–10000, 10001–35000, 35001–150000,
150001–500000, 500001–(aberta) — todas com `tamanho_amostra` nulo.

## 4. Domínio de cálculo (TS puro, testado)
Módulo `modules/recebimento/domain/calculos.ts`:
- `diferencaDias(chegadaISO, previstaISO): number | null`
- `diferencaNumerica(a, b): number | null`
- `buscarCriticidade(fornecedor, tabela): string | null`
- `buscarNqa(quantidade, tabela): number | null` (linha onde `min ≤ q ≤ (max ?? ∞)`)
- `calcularCamposCalculados(valores, campos, contexto): Record<campo, string|number|null>`
  — orquestra por `formula`. `usuario_primeiro`: se o valor atual estiver vazio →
  `contexto.usuarioAtual`; senão mantém (write-once). `contexto` traz
  `criticidadePorFornecedor`, `tabelaNqa`, `usuarioAtual`.

Compartilhado entre cliente (exibição ao vivo) e servidor (valor oficial).

## 5. Gravação (servidor autoritativo)
`salvarProcesso` passa a: aplicar as edições do usuário nos campos **não-calculados**;
carregar as tabelas de referência; chamar `calcularCamposCalculados` sobre os valores
resultantes (usando o valor atual do processo para `responsavel_contagem`); **sobrescrever
as colunas calculadas** no patch com o resultado (o cliente não define esses valores).
Loga normalmente (as mudanças de calculados aparecem no diff).

## 6. Formulário (UI)
- Campos com `calculado=true` renderizam **somente-leitura**, exibindo o valor calculado ao
  vivo (recalcula no cliente a partir dos valores atuais + tabelas passadas como props).
- `responsavel_contagem` mostra o valor atual ou "(será você ao salvar)" quando vazio.

## 7. Telas de configuração (Admin)
- **Criticidade por Fornecedor** (`/configuracoes/criticidade`): CRUD (fornecedor, Sim/Não).
- **Tabela NQA** (`/configuracoes/nqa`): editar `tamanho_amostra` por faixa; adicionar/remover
  faixas. Adicionadas ao `CONFIG_NAV`.

## 8. Tratamento de erros
- Entradas faltando → calculado fica **nulo** (ex.: sem data prevista → atraso vazio; sem
  match na tabela → vazio). Não bloqueia salvar.
- `buscarNqa` sem faixa correspondente ou `tamanho_amostra` nulo → amostral vazio.

## 9. Testes (Vitest)
- `diferencaDias` (sinais, datas faltando), `diferencaNumerica`, `buscarCriticidade`
  (achou/não achou), `buscarNqa` (faixas, limite aberto, 0 e 1), `calcularCamposCalculados`
  (write-once do responsável, sobrescrita).

## 10. Fora de escopo
- Compute na importação (melhoria futura, se solicitado).
- Múltiplos níveis/colunas de NQA (hoje uma coluna de tamanho de amostra).
- Etiquetas (Incremento 2).
