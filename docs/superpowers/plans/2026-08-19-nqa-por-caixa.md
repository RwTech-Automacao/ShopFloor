# NQA por caixa — Plano de implementação

**Spec:** `docs/superpowers/specs/2026-08-19-nqa-por-caixa-design.md`
**Branch:** `feat/shopfloor-nqa-caixa` (da main) · **Migração:** 0080 (Dev já em 0079/EMB)

## Constraints globais
- Escopo: **só embalagem coletiva** (`embalagem_individual=false`). Individual/por-lote = depois.
- Amostra = `buscarNqa(qtdDaCaixa, tabela_nqa)` (reuso do Recebimento).
- Grava **1 registro NQA por SN** da caixa (aprovar/reprovar afeta todas).
- Reprova → `posto_retorno` (nova coluna) roteia a caixa toda pro posto escolhido.
- ⚠️ Ordem de migração no Prod: **EMB 0079 antes** do NQA 0080. No Dev, aplicar 0080 (Dev já tem 0079); se `db push` reclamar de 0079 ausente na branch, aplicar via psql direto (precedente da embalagem 0078).

## Tarefa 1 — Migração 0080 (`0080_sf_nqa_caixa.sql`)
- `alter table sf_registros add column posto_retorno text` (posto p/ onde a caixa reprovada volta).
- **RPC `sf_nqa_caixa(p_pmo, p_op, p_posto, p_numero_caixa, p_resultado text, p_posto_retorno text, p_amostras jsonb)`** — `security definer`, gate `tem_permissao('lancar')`:
  - `p_amostras` = `[{sn, visual, funcional, observacao}]` (as N inspecionadas).
  - Busca todos os SNs da caixa (registros com `numero_caixa=p_numero_caixa` no `p_posto` de embalagem — na verdade a caixa é do posto de Embalagem; ver Tarefa 3 pra a chave).
  - Bloqueia se a caixa já tem registro NQA (reinspeção).
  - **Aprovar:** insere `status='Aprovado', posto=NQA` p/ cada SN (amostradas com nqa_visual/funcional/observacao; demais "por amostragem").
  - **Reprovar:** insere `status='Reprovado', posto=NQA, posto_retorno=p_posto_retorno` p/ cada SN (amostra(s) reprovada(s) com visual/funcional/observacao; demais "por amostragem").
  - Atômico.
- **Ajuste RPC `sf_fluxo_op`** (recriar): no `wip_t`, o CASE de reprova passa a considerar `posto_retorno`:
  `case when lower(status)='reprovado' and posto_retorno is not null then posto_retorno when lower(status)='reprovado' then 'Manutenção' else posto end` (e trazer `posto_retorno` do último registro no CTE).
- `notify pgrst, 'reload schema';`

## Tarefa 2 — Domínio JS (pendências)
- `fluxo-op.ts`: `BipePeca` ganha `postoRetorno?: string`. Em `postoPendenteDePeca`, no ramo reprovado: `if (ultimo.postoRetorno) return ultimo.postoRetorno` antes do Manutenção/mesmo-posto.
- `fluxo-repository.ts` `carregarDetalhePosto`: carregar `posto_retorno` no select dos registros e passar no `regs.push({posto,status,postoRetorno})`.
- **Testes** (`fluxo-op.test.ts`): reprovado com postoRetorno → pendente no posto escolhido.

## Tarefa 3 — Repo: resolver caixa + tabela NQA
- `caixa-repository.ts` (ou fluxo-repo): `resolverCaixaPorSn(pmo, op, sn)` → `{ postoEmbalagem, numeroCaixa, qtd, snsNorm: string[] }` (acha o registro do SN com `numero_caixa` não-vazio; agrupa por `posto||numero_caixa`; molde do `carregarCaixasDaOp`).
- `carregarTabelaNqa()` — reusar `src/modules/recebimento/infra/referencias-repository.ts` + `buscarNqa` (calculos.ts). (Verificar RLS: `tabela_nqa` select=authenticated → ok pro ShopFloor.)

## Tarefa 4 — Actions (`nqa-caixa-actions.ts`)
- `carregarNqaCaixa(pmo, op, posto, sn)` → `{ numeroCaixa, qtd, amostra, snsDaCaixa, jaInspecionada }` (resolve caixa + `buscarNqa(qtd)` + checa registro NQA existente). Gate `lancar`.
- `finalizarNqaCaixa({pmo, op, posto, numeroCaixa, resultado, postoRetorno?, amostras[]})` → chama `sf_nqa_caixa`. Gate `lancar`.
- `listarPostosDaOp(pmo, op)` (p/ o picker de retorno) — reusa ordem dos postos.

## Tarefa 5 — Painel + wiring
- `nqa-caixa-panel.tsx` (client, molde do `embalagem-panel`): bipe carrega caixa → mostra amostra N → bipa cada amostra (valida da caixa + sem repetir) → Visual/Funcional por amostra → 1ª reprova abre picker de posto → "Aprovar caixa" quando N aprovadas.
- Modal de escolha de **posto de retorno** (novo, simples — lista os postos da OP).
- `lancamento-form.tsx`: montar `<NqaCaixaPanel>` quando `recurso==='nqa'` **e** `!ordemSel.embalagem_individual` (coletiva). Individual segue os selects inline atuais (por ora).

## Tarefa 6 — Fechar
- build (`NODE_OPTIONS=--max-old-space-size=6144`) + lint + vitest. Smoke prep (aplicar 0080 no Dev).

## Ordem de execução
1 → 2 → 3 → 4 → 5 → 6. Checkpoint após cada tarefa (build/test quando fizer sentido).
