# Almoxarifado por necessidade (rascunho para aprovação)

Estado: **rascunho de 20/10/2026**, sem código. Só começa **depois** do teste do Compels em produção
(`2026-10-16-integracao-compels-apontamento-design.md`). Mapeamento feito lendo o código; as consultas SQL abaixo são esboço, não foram aplicadas.

## Objetivo

Hoje o posto Almoxarifado recebe um bipe por peça (OP individual) ou por caixa (OP coletiva) e cria uma linha de envio ao Compels por bipe. O
desenho novo troca isso por uma **necessidade**: o posto anterior da rota gera o que o Almoxarifado deve confirmar, a pessoa só confirma, e o
Compels recebe **uma linha por caixa ou por lote**. Isso tira o bipe a mais do chão de fábrica e a entrada pingada no ERP (os dois maiores riscos
anotados na spec do posto) e fecha o buraco de hoje: a entrada **não olha o posto anterior** (só confere que a peça passou por um posto de perfil
Embalagem).

## Decisões já tomadas (usuário, 20/10/2026)

1. **Decide-se sempre pelo perfil do posto** (recurso e `gate`), nunca pelo nome.
2. A necessidade nasce quando o **posto anterior ao Almoxarifado na rota** é **concluído** pela regra do perfil: posto com status (gate `aprovado`)
   precisa estar **Aprovado**; posto sem status (gate `registrado`) basta o registro. É a mesma regra dos outros postos.
3. **Coletiva:** a unidade é a **caixa**; a pessoa bipa o código da caixa para confirmar. Se o posto anterior não é Embalagem nem NQA, a necessidade
   nasce quando **todas as peças da caixa** cumprirem o gate desse posto.
4. **Individual com NQA no posto anterior:** o **lote aprovado** no NQA individual (`nqa_lote_id`) gera a necessidade citando todos os SNs. A pessoa
   bipa uma **amostra** (tamanho da Tabela NQA pelo tamanho do lote). A amostra é **conferência física**: só aceita SNs do lote; SN repetido conta uma vez.
   **Sem NQA no posto anterior:** continua bipe a bipe, como hoje.
5. **Uma linha no Compels por lote** (e por caixa na coletiva), não por OP.
6. O lote é **um envio** no ShopFloor, que guarda a lista dos SNs; ao Compels vai a quantidade e uma chave. **Cada SN do lote ganha entrada própria
   no histórico**, apontando para o envio (o % de conclusão e a finalização automática contam SN distinto no último posto).
7. **Não há desconto.** Com NQA individual no posto anterior o bipe peça a peça deixa de existir (só pelo lote), então nenhum SN do lote pode ter entrado antes. Como defesa, a RPC do lote **recusa**, com mensagem clara, se achar algum SN do lote já com entrada no Almoxarifado; nunca desconta em silêncio.
8. Cancelar é sempre o **lote ou a caixa inteira**.

## O que já existe e se reaproveita

- RPC `sf_almoxarifado_entrada` (0129): gate `recebimento.lancar`, recusas de posto, trava por bipe, recusas de caixa, uma linha de `sf_registros` por SN.
- Fila `sf_estoque_envios` (0132, 0153): `sf_estoque_chave`, `sf_estoque_reservar`, `sf_estoque_reverter`, `sf_estoque_enviado`, `sf_sn_na_faixa`.
- O lote do NQA individual (`sf_nqa_individual`, 0097) e o painel `nqa-individual-panel.tsx` como modelo da tela de amostra.
- A regra do "posto anterior concluído" já existe, mas em TypeScript: `postoAnteriorNaSequencia` (`domain/postos.ts`), `perfilPrecisaAprovado`
  (`perfil-posto.ts`), enviada ao SQL como `p_prev_posto` (`lancar-action.ts`). Não existe função SQL; é preciso criá-la.

## Desenho

### Necessidade como consulta (sem tabela nova na coletiva)

- **Coletiva:** a unidade já existe (`sf_caixas`, fechada, `revisao = 0`). Prev Embalagem: concluída ao fechar. Prev NQA: o `sf_nqa_caixa` **não grava
  `numero_caixa`** (0130), então liga-se SN → caixa pelas linhas da Embalagem e exige NQA Aprovado em todos os SNs. Prev genérico: não existe SN da caixa sem
  registro que cumpra o gate. Já confirmada = existe `sf_registros` no Almoxarifado com o `numero_caixa` da caixa.
- **Lote individual:** unidade = `nqa_lote_id`. Aprovado = todos os registros do lote com status Aprovado. Resto = SNs do lote sem registro no Almoxarifado.
- **Recomendação:** criar a tabela **`sf_nqa_lotes`** (`id` = `nqa_lote_id`, `pmo`, `op`, `posto`, `n`, `criado_em`), alimentada pela `sf_nqa_individual`.
  Evita agrupar `sf_registros` inteira e dá identidade ao lote. Não existe índice em `nqa_lote_id` hoje; criar índice parcial `where nqa_lote_id is not null`.
  A consulta deve se restringir a OPs ativas com Almoxarifado na rota (medir com `set role anon`, lição da 0096).

### Envio de lote

- `sf_estoque_envios.tipo` ganha `'lote'` (alterar o CHECK); `bipe` = rótulo `LOTE[<id curto>][N]`; `quantidade` = N restante; colunas novas `lote_id uuid` e
  `sns text[]`. A chave idempotente do Compels usa o rótulo do lote como `alvo`.
- Em `sf_registros`, coluna opcional `envio_id` para cada SN apontar para o envio.
- `sf_estoque_enviado` (0153) continua certa, porque N do lote já é a soma. O estorno do lote usa `sf_estoque_reverter` por alvo.
- Sem desconto: `quantidade = |lote|` e `sns` = todos os SNs do lote (a recusa defensiva da decisão 7 cobre o caso impossível de um SN já ter entrado).

### RPCs e telas

- Caixa: `sf_almoxarifado_entrada` continua, mas passa a exigir que a necessidade exista (posto anterior concluído).
- Lote: nova RPC `sf_almoxarifado_lote` (recebe `nqa_lote_id` e a amostra; valida SN ∈ lote, distintos, tamanho = Tabela NQA; grava 1 registro por SN do lote e 1 envio).
- Tela: lista de necessidades por OP (selo pendente ou parcial X de N); coletiva = bipar o código da caixa e Confirmar; lote = "bipe K amostras" e Confirmar lote.
  Proteções recomendadas: **sortear** quais SNs bipar e pedir a **quantidade contada**.

## Migrações, arquivos, testes (estimativa)

Migrações (próxima livre depois da 0153; conferir lacunas do Dev): (1) função das necessidades + índice parcial; (2) `sf_almoxarifado_entrada` exige necessidade;
(3) `sf_estoque_envios` (CHECK + colunas) e `envio_id` em `sf_registros`; (4) `sf_nqa_lotes` + RPC do lote; (5) `sf_estoque_reverter` e `sf_cancelar_lancamento` (0133) para o lote.
Código: `almoxarifado-actions.ts`, `domain/almoxarifado.ts`, `domain/estoque-pendente.ts`, `infra/estoque-envios-repository.ts`, `enviar-estoque.ts`,
`almoxarifado-panel.tsx`, `recebimento/almoxarifado/page.tsx`. Testes: `supabase/tests/{almoxarifado,estoque_envios,estoque_enviado}_test.sql` (cada migração 2 vezes) e os de domínio.

## Ordem de implementação

Primeiro validar o Compels com o fluxo atual. Depois a **coletiva** (RPC + lista, sem schema novo). Por último o **lote individual** (schema + RPC + painel de amostra).

## Riscos

- Paridade do "concluído": a trava de sequência de hoje usa "existe registro Aprovado", não o último status; divergir cria necessidades fantasma.
- Caixa remontada depois de reprova (revisão): o join depende da Embalagem íntegra.
- OP de teste que já tenha entrada bipe a bipe: recusar o lote ou a caixa com mensagem clara; não existe OP real nessa situação, porque nenhuma OP vai rodar antes da mudança.
- Mexer no CHECK e em `sf_estoque_reservar` (retorna tabela) exige cuidado com o worker em produção.
- Cancelar o lote precisa estornar e remover os registros de todos os SNs do envio.

## Respostas do usuário (20/10) — todas fechadas

1. **Bipe peça a peça com NQA individual:** o lote vira necessidade com **todos os SNs listados**, e a pessoa bipa **a quantidade de SNs da amostra do lote**. Não há bipe avulso nesse caso (bloqueado).
2. **SN reprovado e reaprovado:** vale **"existe Aprovado"**, igual ao Lançamento de hoje (paridade na primeira versão).
3. **Amostra pelo tamanho total do lote.** O cenário do desconto não existe (nenhuma OP vai rodar antes da mudança), então não há "restante".
4. **Quem cancela:** os SNs do lote ficam em **Registros** (cada um tem entrada própria, decisão 6). O cancelamento do lote aparece lá como **"Cancelar o lote inteiro (N peças)"**, no mesmo molde do "Cancelar a caixa inteira", com a **mesma permissão de hoje (`shopfloor.administrar`)**. Quem só tem `recebimento.lancar` não cancela. Se já foi ao Compels, gera a linha de estorno (manual até a fase automática).
5. **Caixa aberta:** a necessidade só nasce para **caixa fechada**.
6. **Um posto Almoxarifado por OP:** é **um só e pré-definido para todas as OPs** (ver a spec do card único). Consequência: o **Cadastrar Posto** deve impedir criar um segundo posto com perfil Almoxarifado.
