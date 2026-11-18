# Cadastro de OP integrado ao Compels (PMO + PRTs num processo só)

Data: 18/11/2026 · Branch: `feat/cadastro-op-compels` (a partir de `feat/estrutura-op-receita` + main) · Desenho aprovado
pelo usuário em 18/11. Substitui a "receita por PMO" de `2026-11-13-estrutura-op-receita-design.md` (decisões D1, D2,
D8, D9 e D10 de lá deixam de valer); o resto da branch de 13/11 (trechos por OP, fila das PRTs atrás da chave
`COMPELS_PRT_LIGADO`, leitura da árvore da OP no Compels) é reaproveitado.

## Problema

No Compels uma produção é uma **cadeia de OPs** (ex.: 8498 PMOC14 ← 8499 PRT420 PTH ← 8500 PRT410 SMD). No ShopFloor
é **um processo só**: hoje a pessoa cadastra a OP à mão, sem saber das PRTs, e as PRTs ficam fora do ShopFloor.

## Decisões (18/11)

1. **Um processo, um desenho.** As três OPs do Compels viram **uma OP do ShopFloor** com a rota inteira, dividida em
   **trechos**: cada trecho é uma OP do Compels (as PRTs e a PMO) e é **dono de um pedaço dos postos** da rota. O
   Fluxo continua um desenho só; ao escolher um trecho, o desenho destaca os postos dele.
2. **Espelho das OPs ativas do Compels** (só leitura), atualizado de 10 em 10 minutos pelo cron da instância.
3. **Cadastro numa tela só, em passos:** PMO (da lista do espelho) → OP aberta daquela PMO → as OPs filhas (PRTs)
   aparecem já ligadas → postos de cada trecho → faixas por trecho e, nas PRTs, o modo de série → salvar.
4. **Postos copiados da última OP da PMO** (a pessoa confere e ajusta). Primeira OP da PMO: monta do zero.
5. **Séries — vários casos:** cada OP (PMO ou PRT) tem **uma ou mais faixas**; em cada PRT a pessoa escolhe **mesma
   série da PMO** (a etiqueta segue a rota toda) ou **série própria**.
6. **PMO que não existe no Compels:** a **mesma tela** passa para o modo manual (OP, descrição, cliente, quantidade
   digitados, como o cadastro de hoje), com um trecho só (a PMO): postos e faixas.
7. **Só OP nova.** As OPs em andamento não mudam.

## Fora desta fase

- **Série própria no bipe** (a placa anda com a série da PRT e se liga à da PMO num posto, com bipe dos dois): o
  modo fica gravado na Fase 1, mas ainda não muda o lançamento.
- **Apontamento das PRTs no Compels:** já implementado na branch de 13/11, continua atrás da chave desligada até a
  frequência ser decidida.
- Edição da estrutura de uma OP já criada (trocar trecho/OP filha): fica como hoje (recusa trocar a PMO com trechos).

## Banco (migração nova, número definido no plano)

- **`sf_compels_ops`** (espelho): `numero` (pk), `id_compels`, `codigo` (PMO/PRT), `descricao`, `situacao`, `nivel`,
  `quantidade`, `quantidade_produzida`, `mae_numero`, `principal_numero`, `cliente`, `lido_em`. O cron faz upsert das
  OPs ativas e marca as que sumiram (não apaga: `ativa = false`). Leitura com `shopfloor.administrar`.
- **Trechos da OP** (`sf_ordem_trechos`, da 0184): continua uma linha por OP do Compels (`seq`, `codigo`,
  `compels_op`, `sn_modo` = `mesmo`/`proprio`); a PMO passa a ser o **último trecho** (hoje só as PRTs). O
  `posto_conclui` passa a ser derivado: o último posto do trecho.
- **Postos por trecho:** `sf_ordem_postos` ganha `trecho_seq` (a qual trecho o posto pertence; nulo em OP antiga).
- **Faixas por trecho:** as faixas por OP (0181) ganham `trecho_seq` (nulo = da OP inteira, como hoje).
- **Sai a receita:** `sf_estruturas`/`sf_estrutura_trechos`, a tela Ordens → Estruturas, a importação em lote e o
  aviso "PMO sem receita" (nada disso foi para produção).
- Gravação da OP nova por uma função security definer (`shopfloor.administrar`), numa transação: OP + postos com
  trecho + trechos + faixas.

## Compels (só leitura)

- Lista de OPs ativas: `POST ordemProducaoSimples/findAllFilter` (form: `sortFilter=null`, `filtro=<json>`, `page`,
  `start`, `limit`), o mesmo filtro da busca de OP com `"statusList":["Aberta","Planejada","Empenhada","Em Processo"]`
  (HAR de 18/11; as outras situações são "Produzida" e "Cancelada") e a janela de datas da tela (último ano). Resposta
  `{success, totalCount, data:[…]}`: pagina até `totalCount`. Campos usados por linha: `numero`, `id`, `status`, `nivel`,
  `ordemProducaoMaeNumero`, `ordemProducaoPrincipalNumero`, `quantidade`, `quantidadeProduzida`, `dataDocumento`,
  `composicaoProduto.item.codigo`/`descricao`, `negociante.codigo`.
- Árvore: `ordemProducaoMaeNumero`/`ordemProducaoPrincipalNumero`/`nivel` da lista (já lidos por `lerNoOp`).
- Compels fora: o cadastro usa o último espelho e mostra a hora da última leitura.

## Tela — Ordens → Nova OP

1. **PMO:** campo com busca no espelho ("PMOC14 — PLACA X · 2 OPs abertas"). PMO fora do espelho → aviso "Não está no
   Compels — cadastro manual" e os campos manuais.
2. **OP:** lista das OPs abertas daquela PMO (número, quantidade, cliente, data). Escolhida, aparecem os trechos na
   ordem da rota: `8500 PRT410 (SMD) · 8499 PRT420 (PTH) · 8498 PMOC14`, com quantidade e situação de cada.
3. **Postos por trecho:** uma coluna por trecho; cada coluna é a lista de postos daquele trecho (mesma escolha de
   postos do cadastro atual). Vem da última OP da PMO, com o aviso "copiado da OP 8476".
4. **Por trecho:** faixa(s) de série (mesmo componente de faixas de hoje) e, nas PRTs, "Mesma série da PMO" /
   "Série própria".
5. **Salvar:** cria a OP. Erros em PT-BR (posto repetido entre trechos, trecho sem posto, faixa inválida/sobreposta,
   OP já cadastrada).

## Fluxo

Seletor "Trecho: Todos / PRT410 (8500) / PRT420 (8499) / PMOC14 (8498)" acima do desenho. Trecho escolhido: os postos
dele em destaque, os outros apagados. OP sem trechos: sem seletor.

## Testes

SQL (harness): espelho (upsert, some → inativa), gravação da OP nova (postos com trecho, faixas por trecho, PMO como
último trecho, transação), cópia dos postos da última OP, OP antiga intacta. TS: montagem dos trechos a partir da
árvore do espelho, validações da tela, modo manual, seletor de trecho no Fluxo.
