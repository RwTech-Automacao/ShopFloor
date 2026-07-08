# Design — ShopFloor Enterplak: Recebimento 3B — Processos

**Data:** 2026-07-07
**Status:** Aprovado para planejamento
**Relaciona-se com:** spec macro (Seção 5), 3A (Importação, concluído) e Planos 1–2.

Segundo sub-plano do Recebimento. Entrega o **formulário completo** de cada Processo
(montado dinamicamente a partir de `configuracao_campos`), o **ciclo de vida**
(Aberto → Em Conferência → Finalizado/Cancelado, Reabrir) com auditoria, e a
**busca/filtros** na lista de processos.

---

## 1. Escopo
**Dentro:** tela de detalhe do processo com formulário dinâmico; salvamento com log de
alterações; transições de status (Finalizar/Cancelar/Reabrir) com regras de permissão;
busca e filtros na lista de processos.
**Fora:** geração de etiquetas (Incremento 2).

## 2. Decisões
- **Aberto → Em Conferência automático** no primeiro salvamento.
- **Finalizar:** perfis com `finalizar` (Recebimento, Supervisor, Admin); exige todos os
  campos `obrigatorio_finalizacao` preenchidos; grava `finalizado_por`/`finalizado_em` e
  bloqueia edição.
- **Cancelar:** apenas Supervisor/Admin (gate `excluir`); exige **justificativa**
  (`motivo_cancelamento`).
- **Reabrir:** apenas Supervisor/Admin (gate `editar_finalizado`); Finalizado →
  Em Conferência.
- **Consulta:** vê tudo, somente leitura.
- Campos de lista guardam **valor-texto** (snapshot); ao editar, o select mostra os itens
  ativos e preserva um valor atual que não esteja mais na lista.

## 3. Arquitetura

### 3.1 Máquina de estados (domínio, TS puro, testado)
- `TRANSICOES: Record<Status, Status[]>` — aberto→[em_conferencia,cancelado];
  em_conferencia→[finalizado,cancelado]; finalizado→[em_conferencia]; cancelado→[].
- `podeTransicionar(de, para): boolean`.
- `camposFaltantesFinalizacao(processo, campos): string[]` — lista os
  `obrigatorio_finalizacao` vazios (bloqueiam finalizar).

### 3.2 Permissões por transição (reforçadas por RLS + checadas na ação)
| Ação | Permissão | Perfis |
|---|---|---|
| Editar (aberto/em conf.) | `editar` | Recebimento, Supervisor, Admin |
| Finalizar | `finalizar` | Recebimento, Supervisor, Admin |
| Cancelar | `excluir` | Supervisor, Admin |
| Reabrir / editar finalizado | `editar_finalizado` | Supervisor, Admin |
| Visualizar | `visualizar` | todos |

### 3.3 Reforço no banco (migration 0009)
Refina a policy `processos_update` para exigir `excluir` ao mudar o status para
`cancelado` (hoje um usuário com só `editar` conseguiria cancelar via update). Reabrir já
é barrado para não-Supervisor pela cláusula `USING` (editar de finalizado exige
`editar_finalizado`); finalizar já exige `finalizar` (migration 0007). O banco continua
sendo o portão real; as Server Actions são o portão de UX + validação.

### 3.4 Server Actions (finas, checam permissão + logam)
- `salvarProcesso(id, valores)`: checa `editar` (ou `editar_finalizado` se finalizado);
  valida/converte por tipo; calcula **diff**; atualiza; se status=`aberto` → `em_conferencia`;
  grava `atualizado_por`; loga `alterar_campo` (diff). Loga `mudar_status` se houve a
  transição automática.
- `finalizarProcesso(id)`: checa `finalizar`; valida `camposFaltantesFinalizacao` (se
  houver, retorna erro); seta `finalizado`, `finalizado_por/em`; loga `mudar_status`.
- `cancelarProcesso(id, motivo)`: checa `excluir`; exige `motivo`; seta `cancelado`,
  `cancelado_por`, `motivo_cancelamento`; loga `mudar_status`.
- `reabrirProcesso(id)`: checa `editar_finalizado`; exige status atual `finalizado`; seta
  `em_conferencia`, limpa `finalizado_em`; loga `mudar_status`.

### 3.5 Formulário dinâmico
- Renderizado a partir de `configuracao_campos` (ativo), agrupado por `grupo` (Comercial,
  Material, Recebimento, Qualidade) e ordenado por `ordem`.
- Por `tipo`: `texto`→input; `numero`→input numérico; `data`→input de data;
  `lista`→select dos `lista_itens` ativos da `lista_chave`.
- Comercial já preenchido (importação); Recebimento completa. Somente-leitura quando
  `finalizado` (exceto Supervisor/Admin) ou `cancelado`.
- Ações contextuais no topo: Salvar, Finalizar, Cancelar (Sup/Admin), Reabrir (Sup/Admin),
  conforme status e permissão.

### 3.6 Lista de processos (evolui a do 3A)
- Busca por texto (Nº NF, Nº Pedido, fornecedor, código/descrição do material) + filtro por
  status; paginação server-side; cada linha abre o detalhe.

## 4. Tratamento de erros
- Transições inválidas (ex.: finalizar sem obrigatórios) → mensagem clara, nada gravado.
- Server Actions retornam `{ok}|{erro}`; toasts na UI.
- RLS + máquina de estados como redes de segurança independentes da UI.

## 5. Testes (Vitest)
- Máquina de estados: `podeTransicionar` (todas as combinações válidas/inválidas),
  `camposFaltantesFinalizacao`.
- Regras de permissão por transição (funções puras onde houver).
- Migration 0009 verificada estruturalmente (policy contém `excluir` para cancelado).

## 6. Fora de escopo
- Etiquetas (Incremento 2).
- Edição em massa / histórico visual de versões do processo (futuro).
- Anexos/arquivos no processo (futuro).
