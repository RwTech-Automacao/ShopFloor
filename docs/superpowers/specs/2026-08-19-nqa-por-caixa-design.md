# NQA por caixa (amostragem) — Design

**Data:** 2026-08-19 · **Módulo:** ShopFloor Processo · **Status:** design aprovado (aguarda review do spec)

## Contexto e objetivo
O posto **NQA** é uma inspeção **por amostragem** — não passa 100% dos SN. Hoje o fluxo é
linear (peça aprovada → pendente no próximo posto), então as peças não amostradas ficariam
**presas no NQA pra sempre**. Este design faz o NQA inspecionar **por caixa**, usando a
**Tabela NQA** já existente para dimensionar a amostra, e liberar/reprovar a caixa inteira.

## Escopo
- **AGORA:** OPs de **embalagem coletiva** (`sf_ordens.embalagem_individual = false`) → NQA **por caixa**.
- **DEPOIS (fora deste escopo):** OPs de **embalagem individual** → NQA **por lote** (a definir).

## Pré-requisito
A rota da OP inclui o posto **NQA depois da Embalagem** (`… Teste → Embalagem → NQA`). A caixa
precisa estar **fechada** na Embalagem para o NQA inspecioná-la.

## Fluxo do usuário (painel novo `nqa-caixa-panel.tsx`, no molde do `embalagem-panel`)
1. **Carregar caixa:** a pessoa **bipa 1 SN** → o painel resolve a **caixa** daquele SN (pela
   `sf_registros.numero_caixa`) + a **quantidade** → calcula o **tamanho da amostra N** via
   **Tabela NQA** (`carregarTabelaNqa` + `buscarNqa(qtd)`). Mostra: *"Caixa CX[3]100OP-PMO —
   qtd 100 — amostra: 20"*.
2. **Inspecionar as N amostras:** a pessoa **bipa N SNs** da caixa (quaisquer N, pega aleatório
   na mão). Para **cada** amostra:
   - Valida que o SN **pertence à caixa** (senão **rejeita**) e **não repete**.
   - Preenche **Visual + Funcional** (`Aprovado` / `Reprovado` / `Não aplicável`).
   - Se **Reprovado** (Visual OU Funcional): pode preencher **observação** daquela amostra → a
     **caixa é reprovada** (curto-circuito: não precisa terminar as N).
   - Contador "3/20".
3. **Todas as N aprovadas** → botão **"Aprovar caixa"**.
4. **1 reprovada** → **"Caixa reprovada"** → a pessoa **escolhe o posto de retorno** (ex.: Teste).

## Regras
- **Amostra:** N = `buscarNqa(qtdDaCaixa, tabelaNqa)` (faixas lote→amostra, padrão ANSI/ASQ Z1.4,
  já cadastradas em `tabela_nqa`). Ex.: qtd 100 → faixa 91-150 → **20**.
- **Aprovar caixa:** grava **`NQA Aprovado` para TODAS as peças da caixa** (por SN):
  - As **N amostradas** com seu `nqa_visual`/`nqa_funcional` reais.
  - As **demais** como *aprovado por amostragem* (`status=Aprovado`, sem visual/funcional, nota).
  - Resultado: no Fluxo, todas viram **finalizadas** (NQA é o último posto → caixa Saída).
- **Reprovar caixa:** grava **`NQA Reprovado` para TODAS as peças da caixa** (por SN), cada uma
  com **`posto_retorno`** = posto escolhido:
  - A(s) amostra(s) reprovada(s) com `nqa_visual`/`nqa_funcional`/`observacao` reais.
  - As demais como *reprovado por amostragem* (colateral — a caixa falhou, todas voltam).
  - Resultado: no Fluxo, todas ficam **pendentes no posto de retorno**.

## Modelo de dados (o que muda)
- **Migração:**
  - `alter table sf_registros add column posto_retorno text` — o posto p/ onde a caixa reprovada volta.
  - Nova RPC **`sf_nqa_caixa(p_pmo, p_op, p_posto, p_numero_caixa, p_resultado, p_posto_retorno, p_amostras jsonb)`**
    — `security definer`, gate `tem_permissao('lancar')`. Faz o insert em lote (todas as peças da
    caixa) atomicamente. `p_amostras` = `[{sn, visual, funcional, observacao}]` (as N inspecionadas);
    o resto da caixa é derivado no servidor (busca os SNs pela `numero_caixa`).
- **Domínio:** `postoPendenteDePeca` (`fluxo-op.ts`): se a última = **Reprovado no NQA** e há
  `posto_retorno` → a peça fica **pendente no `posto_retorno`** (em vez do mesmo posto/Manutenção).
- **Repo:** nova fn `resolverCaixaPorSn(pmo, op, sn)` → `{ posto, numeroCaixa, qtd, sns[] }`
  (modelada em `carregarCaixasDaOp`; agrupa `sf_registros` por `posto||numero_caixa`).
- **Config:** o perfil `nqa` (`sf_posto_perfis`) já existe; o painel é acionado por
  `recurso === 'nqa'` **+ OP coletiva**. Reprova do NQA passa a permitir **escolher posto**
  (novo — hoje é `reprova='nenhum'`).

## Arquivos
- `nqa-caixa-panel.tsx` (novo, client) — o painel por bipe.
- Modal de **escolha de posto de retorno** (novo, ou reuso adaptado do `reprovar-modal`).
- `nqa-caixa-actions.ts` (novo) — `carregarNqaCaixa`, `aprovarCaixaNqa`, `reprovarCaixaNqa`.
- `lancamento-form.tsx` — montar `<NqaCaixaPanel>` quando `recurso==='nqa'` e OP coletiva
  (hoje o NQA usa selects inline; passa a usar o painel).
- Migração `00XX_sf_nqa_caixa.sql`.
- Domínio `fluxo-op.ts` + testes.

## Casos de borda
- Bipe de SN **fora da caixa** → rejeita com aviso.
- Bipe **repetido** da mesma amostra → ignora/avisa.
- Caixa **não encontrada** (SN sem caixa / caixa não fechada) → aviso "embale/feche a caixa primeiro".
- Caixa **já inspecionada** no NQA (já tem registro NQA) → avisa/bloqueia reinspeção.
- `buscarNqa` retorna **0** (qtd 0) ou **null** (tabela sem valor) → tratar (amostra 0 = aprova direto? avisar config).
- Tentar "Aprovar caixa" com **menos de N** amostras → bloqueia.

## Fora de escopo
- NQA **individual / por lote** (embalagem individual) — próxima etapa.
- Catálogo de defeitos no NQA (NQA usa `reprova='nenhum'` — só Visual/Funcional + observação).
