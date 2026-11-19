# Receita da Integração com PRT da estrutura

Data: 19/11/2026 · Branch: `feat/receita-integracao-prt` (a partir de `feat/editar-op-trechos`) · Desenho aprovado
pelo usuário em 19/11.

## Problema

A receita de um posto de Integração (`sf_ordem_componentes`: `ordem_id`, `posto`, `pmo_componente`) só aceita códigos
de PMO, e o bipe (`sf_integrar`) confere a placa pela PMO da OP de onde ela veio. Com a OP em trechos (0184), uma PRT
tem OP própria no Compels, mas no ShopFloor ela fica **dentro** da OP da PMO, como trecho. A placa dela leva a PMO da
OP, e não o código da PRT, por isso pôr a PRT na receita não tem efeito.

## Decisões (19/11)

1. A receita de um posto de Integração pode ter:
   - **qualquer PMO, menos a da própria OP** (como hoje);
   - **PRTs da estrutura da própria OP** (trechos `tipo = 'prt'`), mas só as cadastradas com **série própria**
     (`sn_modo = 'proprio'`). Com a mesma série, a placa da PRT e o produto teriam o mesmo SN.
2. Regra do bipe, para cada placa:
   - **PMO na receita:** aceita a placa de uma OP daquela PMO (como hoje). Isso já cobre a PRT cadastrada como OP
     separada (ex.: 8683 PRT706), porque a placa dessa OP leva o código da PRT.
   - **PRT na receita:** aceita a placa **da própria OP** que já **terminou o trecho daquela PRT**, ou seja, tem
     registro **aprovado** no último posto do trecho (`posto_conclui` derivado da 0184/0194, o último posto do
     trecho na rota). Se o último posto for de passagem (sem status), basta ter o registro.
   - Uma placa que não atende nenhum item da receita é barrada. Receita vazia aceita qualquer placa, como hoje.
3. Mensagens em PT-BR:
   - **PRT não concluída:** "A placa {sn} ainda não terminou a {PRT} (falta o posto {posto})."
   - **Fora da receita:** a mensagem atual de placa fora da receita continua valendo.
4. Os dois casos físicos (a mesma placa ou outra peça) ficam cobertos sem cadastro novo: o primeiro pela regra da PRT,
   o segundo pela regra da PMO.

## Banco: migração `0195_receita_integracao_prt.sql`

- **Tabela:** `sf_ordem_componentes` não muda. O valor gravado em `pmo_componente` passa a poder ser um código de PRT
  da própria OP.
- **Função de bipe:** redefine a função de bipe da Integração, na versão vigente (0065 ou posterior; confira qual é a
  última), mudando **só** a conferência da receita. Assinatura, permissão, travas, sequência, duplicidade e gravação
  continuam idênticas. Para identificar a placa, os itens da receita que são PRT da própria OP (trecho `prt` da
  `ordem_id`) usam a regra 2 e o resto usa a regra da PMO.
- **Gravação da receita:** `sf_ordem_regravar_trechos` (0194) e `sf_cadastrar_op` (0184) recusam PRT na receita que
  não seja trecho `prt` com série própria da mesma OP. Código: `RECEITA_PRT_INVALIDA:<codigo>`, com tradução em PT-BR.
  O modal antigo continua gravando só PMO.
- **Forma da migração:** idempotente, numa transação, termina com `notify pgrst, 'reload schema';`. Inclui o rollback
  `docs/operacao/estrutura-op/rollback-0195.sql`.

## Tela

O editor de receita (`ordens/editores-posto.tsx`), na Nova OP e na edição de OP com trechos, mostra as PMOs como hoje
e um grupo **"PRTs desta OP"** com os trechos PRT de série própria. Uma PRT que deixa de ter série própria, ou sai da
estrutura, sai da receita ao salvar, com aviso na tela.

## Fora desta fase

- Ligar a placa da PRT ao produto em outro posto que não a Integração.
- Mudar o lançamento comum dos postos da PRT. Os bipes de série própria já funcionam pela faixa do trecho (0194).

## Testes

- **SQL (harness):**
  - PMO na receita aceita, como antes;
  - PRT na receita aceita a placa que terminou o trecho e recusa a que não terminou, com a mensagem;
  - placa de outra OP com a mesma PRT não vale pela regra da PRT;
  - receita mista (PMO + PRT);
  - receita vazia;
  - gravação recusa PRT inválida;
  - idempotência e rollback.
- **TS:**
  - o editor oferece só as PRTs de série própria;
  - o payload sai com a PRT;
  - a mensagem nova é traduzida;
  - a OP sem trechos não muda.
