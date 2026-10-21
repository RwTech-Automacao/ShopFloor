# Tela do Almoxarifado: cartões de pendência (desenho aprovado em 21/10/2026)

Estado: **desenho aprovado pelo usuário em 21/10**, spec para revisão. Sem código. Branch `feat/almoxarifado-necessidade` (worktree `ShopFloor-necessidade`).
Estende `2026-10-20-almoxarifado-por-necessidade-design.md` (a regra de negócio não muda; muda só a tela e uma consulta de detalhe).

## Problema

A tela Recebimento → Almoxarifado é o `LancamentoForm` do ShopFloor em "modo Almoxarifado": exige carregar a OP por um bipe de cabeçalho, tem Contexto, Peça, OP e posto, que são conceitos do Lançamento
e não do Almoxarifado. O usuário quer uma tela própria, que não imite o Lançamento.

## Decisões do usuário (20 e 21/10)

1. Cada **cartão é uma pendência**: uma **caixa** (OP coletiva) ou um **lote** do NQA (OP individual). Não há cartão por OP e não há barra de andamento por OP.
2. A tela mostra **só o que está pendente**, com **filtro por OP**. A pessoa escolhe um cartão, **confere os detalhes** e depois **bipa**.
3. O bipe **confere o item físico**: coletivo = bipa o **código da caixa**; individual = bipa **N números de série quaisquer do lote** (a amostra do NQA, hoje K da `tabela_nqa`).
4. Informação principal em destaque: coletivo = o **código da caixa**; individual = os **números de série do lote**. Os demais detalhes aparecem em segundo plano.
5. Sem campo de bipe na lista: para bipar é preciso abrir o cartão (o desenho aprovado não tem atalho de bipe na lista).

## A tela

Rota e permissões não mudam: `/recebimento/almoxarifado`, `recebimento.lancar` + `shopfloor.visualizar`, posto fixo (o único posto de perfil `almoxarifado`), colaborador = usuário logado.

**1. Lista (estado inicial).** Cabeçalho "Esperando confirmação (N)", filtro de OP (padrão "Todas as OPs"; as opções são as OPs que têm pendência) e botão Atualizar. Os cartões ficam em grade que quebra linha:
- caixa: etiqueta "CAIXA · OP x · PMO", **código da caixa** em destaque, "N peças · fechada hoje HH:MM";
- lote: etiqueta "LOTE · OP x · PMO", **rótulo do lote** em destaque, "N peças · bipar K · aprovado HH:MM".
Lista vazia: "Nada esperando confirmação no Almoxarifado agora." Falha de leitura é um estado de erro próprio, **nunca** lista vazia.

**2. Caixa aberta.** Linha de contexto (OP, PMO, coletiva, fechada em tal hora por tal pessoa), o **código da caixa em letra grande**, "Bipe este código para confirmar a entrada de N peças", o campo de bipe (foco automático)
e, em segundo plano: os números de série dentro da caixa, o posto anterior e seu estado, quanto a OP já recebeu ("80 de 200 peças já no Almoxarifado"). Botão "Voltar à lista".

**3. Lote aberto.** Linha de contexto (OP, PMO, individual, aprovado no NQA em tal hora), "Lote xxxx · N peças", "Bipe K números de série quaisquer deste lote (amostra do NQA)", os **números de série do lote como etiquetas**
(as bipadas marcadas; com muitos, mostra parte e "+N"), campo de bipe, "Bipadas: X de K", **Confirmar lote** (habilitado só com exatamente K distintos) e "Voltar à lista".

Ao confirmar com sucesso: painel de resultado (o `PainelResultado` das telas de bipe), o cartão some e volta para a lista atualizada. Recusa do banco (posto anterior não concluído, peça já lançada etc.) aparece no mesmo painel, com a frase em
PT-BR que as actions já devolvem, e o cartão **permanece**.

## O que reaproveita (nada de regra nova)

- `sf_almox_pendencias()` (0158): a lista já existe; o filtro por OP é no cliente.
- `registrarEntradaAlmoxarifado` (bipe da caixa) e `confirmarLoteAlmoxarifado`: as mesmas actions, as mesmas recusas.
- Regras da 0155/0156 (posto anterior, existe Aprovado, caixa fechada, amostra K, um envio `tipo='lote'`): inalteradas.
- `almoxarifado-panel.tsx` e `lancamento-form.tsx` **não são mexidos** para o Almoxarifado de OP coletiva/individual além de deixar de ser usados por essa rota; o modo Almoxarifado do `LancamentoForm` pode ser removido numa limpeza depois, não nesta entrega.

## O que precisa de dado novo (uma consulta de detalhe)

Os detalhes do cartão aberto não vêm da 0158. Uma função nova, `sf_almox_detalhe(p_pmo, p_op, p_codigo)` (migração **0159**, aditiva e idempotente, `$func$`, mesmos dois gates de permissão):
- **caixa:** números de série (de `sf_registros` com `numero_caixa = código` no posto da caixa), `fechada_em` (de `sf_caixas`), posto anterior e seu estado (via `sf_almox_posto_anterior`), peças da OP já recebidas e quantidade da OP (`sf_ordens.qtd`);
- **lote:** números de série (`sns` da `sf_almox_lotes`), `aprovado_em`, K da amostra, peças já lançadas.
`sf_caixas` não guarda **quem** fechou. Pelo desenho, "por Maria" usa o `colaborador` do último registro da Embalagem daquela caixa (a melhor aproximação disponível). Se o usuário preferir não mostrar "quem", o campo sai sem custo.

## Erros e bordas

- Cartão que sumiu entre abrir e bipar (outra pessoa confirmou): o banco recusa; a tela mostra a frase e volta para a lista atualizada.
- Duas pessoas na tela ao mesmo tempo: a regra do banco impede entrada dupla; a lista só se atualiza no Atualizar e ao confirmar/voltar.
- Perfil sem permissão: a mesma tela "sem permissão" de hoje. Sem posto Almoxarifado cadastrado: a mesma mensagem de hoje.
- Bipe de código que não é o do cartão aberto: recusa com "este não é o código desta caixa" (ou "este número de série não é deste lote"), sem gravar nada.

## Testes

- Domínio: filtro por OP e agrupamento dos cartões; contagem e estado do botão Confirmar lote (já coberto em `conferirBipeAmostra`/`amostraCompleta`, reaproveitar).
- Componentes: lista (cartões, filtro, vazio, erro), caixa aberta (bipe certo confirma, bipe errado recusa, recusa do banco mantém o cartão), lote aberto (progresso, confirmar só com K, SN fora do lote).
- SQL: `sf_almox_detalhe` no harness (`rodar-almoxarifado-test.sh`): caixa e lote, permissão negada é erro, OP/código inexistente. A `sf_almox_pendencias` (0158) ganha teste no harness nesta entrega (hoje só tem conferência manual).

## Fora do escopo

Atalho de bipe na lista; barra de andamento por OP; mudar a regra do Almoxarifado ou o Compels; remover o modo Almoxarifado do `LancamentoForm`; as placas intermediárias.

## Para o deploy

Esta tela depende das migrações **0155, 0156, 0158 e 0159** em produção (e o código antes ou junto da 0156, por causa do tipo `lote` na fila do Compels).
