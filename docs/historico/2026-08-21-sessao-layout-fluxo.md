# Sessão 2026-08-21 — Layout do Lançamento, Fluxo e layout configurável

Dia grande, tocando o **bloco da reunião** (features A e D) + uma feature nova (layout
configurável). Estratégia de merge definida pelo usuário: **D → main direto**, **A → Prod
após o expediente**, **configurável empilha na A**. Nada mergeado ainda (branches + previews).

## 🟦 A — Layout 2×2 do Lançamento (`feat/shopfloor-lancamento-2x2`) → Prod após expediente

Reorganiza a tela de Lançamento (bipe normal) num **2×2**: Peça(topo-esq) · Contexto(topo-dir)
· Histórico(base-esq) · Último lançamento(base-dir). **Só rearranjo** (lógica/automação do bipe
intocadas). Iterações do smoke:
- 4 quadrantes viraram **cards uniformes** (alinhamento).
- **Última peça agora aparece no Último E no Histórico** (removeu o `slice`).
- **Telas especiais** (Integração/Embalagem/NQA-caixa) em **[Painel | Contexto]** (Contexto à
  direita; elas têm bipe/resultado próprios, sem Histórico/Último).
- 🔴 **Bug de produção corrigido:** durante a gravação, um bipe podia **trocar o Posto**. Fix =
  **trava total** (overlay cobre a tela + input-sumidouro engole o bipe + Posto desabilitado).
- **Resize mini PC:** página `h-full` + form `flex-1` → a grade preenche a altura.

Escopo: só o bipe normal; especiais mantêm painel próprio (a "fase 2 do layout" virou a feature
configurável, abaixo). Sem migração.

## 🟪 D — Fluxo: card + métricas (`feat/shopfloor-fluxo-card`) → main direto

Redesenho do card do canvas de Fluxo + ajustes no Modo TV:
- **Card:** WIP vira **mini-card na entrada** (esquerda, metade fora); ícone à direita;
  **"já passaram / devem passar"** acima (fora do card); **barra de progresso** abaixo (fora).
  `passou`/`devemPassar` já existiam no domínio.
- **Manutenção** usa o mesmo card (sem número/barra — é ramo).
- **Modo TV:** removido o **cliente**; **% agora é do processo inteiro** (Σ passagens ÷
  qtd×postos), não só as prontas do último posto.
- **Dropdown de OP:** mais largo (não corta) + **filtro** de busca.
- **Floating edges:** a linha conecta na borda do card que aponta pro outro → **se ajusta a
  qualquer arranjo** (arrastar/serpente). Descoberta: as arestas já seguiam o nó; o problema era
  o roteamento por handles fixos esq/dir.
- **Barra verde** com **% dinâmica**: preta seguindo o preenchimento pela direita; entra branca
  na barra perto de 100%.
- Uma **banda de status** no TV foi criada e depois **revertida** (usuário pediu "tirar os dados
  de cima por enquanto"; volta com o "aproveitar a tela").

Sem migração.

## 🆕 Layout configurável do Lançamento (`feat/shopfloor-layout-configuravel`, da A)

Brainstorm → spec → plano → implementação. **Admin define, central (vale pra todos), a ORDEM
dos painéis; arrastar pra TROCAR (swap na grade); v1 só reordenar (sem ocultar); cobre normal(4)
+ especiais(2).** Substitui o 2×2 fixo. Tem migração.

- **T1** domínio `layout-lancamento.ts` (`normalizarOrdem`, `slot2x2`) + testes.
- **T2** migração **`0082_sf_config_layout.sql`** (`sf_config` chave→jsonb + seed + RPC
  `sf_salvar_layout` gate `tem_permissao('shopfloor','administrar')` valida permutação).
- **T3/T4** infra `config-repository.ts` + action `layout-actions.ts`.
- **T5** Lançamento renderiza pela ordem (`cloneElement` + grid inline) — automação do bipe
  intocada (revisado).
- **T6** tela `configuracoes/sf-layout-lancamento` (DnD nativo, swap) + item no menu (`administrar`).
- Verificação integrada: tsc + **1146 testes** + lint + build ok.
- **Falta T7 (usuário):** aplicar `0082` no Dev → smoke → /code-review → promover Prod.
- Permissão de admin = **`administrar`**. Telas de config do ShopFloor ficam em
  `src/app/(app)/configuracoes/sf-*` (flat).

## Bugs/aprendizados

- Bipe trocando Posto durante gravação (produção) → trava total na gravação.
- Height chain quebrada (main não-flex-col + page sem altura) → page `h-full` + form `flex-1`.
- Floating edges = solução pro "arrastar e a linha se ajustar".
- Numeração de migração tem gaps (0079/EMB fora do Prod, 0081/NQA-followup) → `0082` a
  reconciliar; SQL idempotente.

## Próximo (planejado)

- **Branch a partir da D:** (1) **tempo entre as linhas dos postos** (D2; puxa jornada de
  trabalho) e (2) **postos de teste: "aprovados de primeira" + "reprovados sem reteste"**.
- Merges: D→main; A→Prod após expediente; configurável T7.

Ver [[backlog-pendencias]] pro quadro vivo.
