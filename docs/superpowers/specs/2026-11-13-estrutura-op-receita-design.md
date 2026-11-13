# Estrutura da OP (receita por PMO) — apontar as PRTs no Compels pelo ShopFloor

Data: 13/11/2026 · Status: desenho aprovado em conversa, aguardando revisão deste documento · Branch: `feat/estrutura-op-receita`

## 1. Problema

No Compels, uma placa ou produto é uma **cadeia de OPs** com números seguidos. A OP da PMO (nível N) consome a PRT da OP filha (N+1), que consome a da neta:

```
8498 PMOC14 (placa)  ← 8499 PRT420 (partes PTH)  ← 8500 PRT410 (partes SMD)
8682 PMOF52 (fonte)  ← 8683 PRT706 (PTH)         ← 8684 PRT705 (SMD)      [família 8681, coletor Focus]
```

No ShopFloor, a mesma produção é **uma OP só**, com a rota inteira (Printer/SPI/AOI → Montagem/Inspeção PTH → Teste → Embalagem → Almoxarifado). Hoje o ShopFloor só aponta a PMO, no Almoxarifado (`docs/superpowers/specs/2026-10-16-integracao-compels-apontamento-design.md`). As PRTs são apontadas **à mão**, em lotes, quase sempre pela mesma pessoa, com a SMD e a PTH no mesmo minuto e no tamanho da caixa que precisa entrar. O resultado:

- **Atraso.** A SMD da 8684 terminou no ShopFloor em 30/10 e só foi apontada entre 05/11 e 09/11.
- **Trava a integração.** O Compels recusa apontar a PMO sem saldo requisitado da PRT. A OP 8691 tem 4 caixas paradas na fila por isso.

Estudo que embasa este documento (13/11/2026): `tools/compels/mapa-ops.mjs` e `docs/operacao/estudo-op-mae-filhas/` (branch `estudo/op-mae-filhas-compels`). Foram cruzadas 46 OPs do ShopFloor com 32 famílias do Compels.

## 2. Objetivo

O ShopFloor aponta **cada PRT no Compels quando as peças passam pelo posto que conclui aquele trecho da rota**, pelo mesmo mecanismo que já aponta a PMO: a fila `sf_estoque_envios`, o cron, a espera por requisição, o pagamento de pendência e o motivo visível no Fluxo.

**Fora do escopo desta versão:**
- o produto final que não passa pelo ShopFloor (ex.: 8681, coletor Focus);
- OPs antigas: a estrutura vale só para OP nova;
- a frequência de apontamento das PRTs, que ainda está em decisão interna (ver §8).

## 3. Decisões tomadas (13/11/2026)

| # | Decisão |
|---|---|
| D1 | **Receita por PMO**, sem ajuste por OP. Cadastra uma vez os trechos, os postos e o tipo de SN. Toda OP nova daquela PMO nasce com a estrutura. |
| D2 | A estrutura fica numa **tela própria**: Ordens → Estruturas. A OP **puxa sozinha** a receita da PMO, sem nada para escolher. |
| D3 | Tipo de SN **por trecho**: *o mesmo da PMO* (a maioria das placas: a mesma peça e a mesma etiqueta na rota inteira) ou *próprio* (a PRT tem faixa própria e se liga à PMO num posto, com bipe dos dois). |
| D4 | O bipe duplo do SN próprio **reaproveita o perfil Integração**, sem perfil novo. |
| D5 | A OP guarda uma **cópia da receita** no momento da criação. Editar a receita não altera OP em andamento. |
| D6 | Cada peça conta **uma vez por trecho**. Reaprovação depois da Manutenção não gera outro apontamento. |
| D7 | O apontamento das PRTs nasce **desligado por uma chave** até a frequência ser decidida. |
| D8 | Uma PMO **sem receita** gera OP como hoje, com um aviso discreto e um link para cadastrar a estrutura. |

## 4. Modelo de dados (migrações novas)

**`sf_estruturas`**: a receita, uma por PMO.
- `pmo text primary key`
- `criado_em`, `criado_por`, `alterado_em`, `alterado_por`

**`sf_estrutura_trechos`**: os trechos da receita, na ordem da rota.
- `pmo text references sf_estruturas`
- `seq int`
- `codigo text`: o código da PRT no Compels (ex.: `PRT410`)
- `posto_conclui text references sf_postos(chave)`
- `sn_modo text check in ('mesmo','proprio')`
- `posto_vinculo text null references sf_postos(chave)`: obrigatório quando `sn_modo = 'proprio'`
- `primary key (pmo, seq)`

**`sf_ordem_trechos`**: a cópia por OP (D5), mais o que foi achado no Compels.
- `ordem_id uuid references sf_ordens on delete cascade`
- `seq`, `codigo`, `posto_conclui`, `sn_modo`, `posto_vinculo`
- `compels_op text null`: o número da OP filha (ex.: `8499`). Fica vazio se não foi achada.
- `sn_ini`, `sn_fim`: a faixa própria, só quando `sn_modo = 'proprio'`

**Fila: `sf_estoque_envios`** recebe as entradas das PRTs com `pmo = codigo da PRT` e `op = número da OP filha`. Com isso o adaptador atual (`criarPortaCompels` → `enviarEntrada`) resolve a OP no Compels, confere o código e guarda o ponto de partida (`sf_compels_op_base`, 0168) **sem mudança**.
- **Coluna nova `ordem_id`**, que liga a linha à OP do ShopFloor. É ela que permite a liberação (§6) e o Fluxo/Almoxarifado mostrarem a linha junto da OP.
- **Chave de idempotência:** passa a incluir o trecho, pelo prefixo `trecho:<seq>`, para a mesma série gerar uma linha por trecho e nunca duas (D6).

## 5. Fluxo de dados

1. **Criação da OP:**
   - se a PMO tem receita, os trechos são copiados para `sf_ordem_trechos`;
   - o servidor lê a árvore da OP no Compels (busca da OP + filhas pelo `ordemProducaoMaeNumero` e pela sequência de números, como no `mapa-ops.mjs`);
   - cada trecho é casado com a filha **pelo código**, e o número da filha é guardado;
   - Compels fora do ar ou filha não achada: a OP é criada assim mesmo, com aviso, e o casamento é refeito no primeiro envio.
2. **Bipe aprovado no `posto_conclui` de um trecho:**
   - a RPC do lançamento enfileira uma `entrada` daquele trecho;
   - `quantidade` = placas por painel (1 em OP comum);
   - a chave é por trecho + série, então reaprovação não duplica.
3. **SN próprio:**
   - até o `posto_vinculo`, a peça anda com o SN da PRT, dentro da faixa do trecho;
   - no `posto_vinculo` o operador bipa a PRT e depois a PMO, pela mesma regra da Integração (`sf_integracoes`);
   - daí em diante vale o SN da PMO.
4. **Cron do estoque:** processa as linhas das PRTs como as da PMO. A ordem SMD → PTH → PMO se resolve sozinha: a PTH espera ("Aguardando requisição… PRT410") até a SMD entrar.
5. **Cancelar lançamento:** reaproveita `sf_estoque_reverter` (0132). A linha pendente é cancelada; a já enviada vira estorno manual, como na PMO.

## 6. Liberação e chave

- **Linha de PRT só é enviada com as duas condições:**
  - a OP do ShopFloor (`ordem_id`) está liberada, pela mesma regra de hoje (`integrar_compels` ou `COMPELS_OPS_LIBERADAS`);
  - a chave nova **`COMPELS_PRT_LIGADO=1`** está ligada.
- **Com a chave desligada**, as linhas são criadas e aparecem no Fluxo com o motivo "Apontamento das PRTs desligado", mas não vão ao Compels.
- A **frequência** (§8) entra como configuração dessa mesma chave quando for decidida.

## 7. Telas

**A. Ordens → Estruturas (nova)**
- Lista das PMOs com receita.
- Editor de trechos: código, posto que conclui (lista de postos da rota padrão da PMO), SN *o mesmo / próprio* e, se próprio, o posto de ligação.
- **Botão "Ler do Compels"**: recebe o número de uma OP da PMO, preenche os códigos das PRTs e sugere os postos (último posto de inspeção SMD para a SMD, Inspeção PTH para a PTH).
- **Validações ao salvar:**
  - o posto existe na rota padrão;
  - os trechos seguem a ordem da rota;
  - não há dois trechos no mesmo posto;
  - trecho com SN próprio tem posto de ligação.
- Permissão: a mesma de editar padrões de fluxo e OPs.

**B. Formulário da OP**
- PMO com receita: bloco **Estrutura**, só de leitura, com o trecho, o código, a OP filha achada no Compels (✓ ou aviso) e o campo de faixa de SN de cada trecho com SN próprio.
- PMO sem receita: aviso discreto "Esta PMO não tem estrutura — as PRTs não serão apontadas pelo ShopFloor", com link para Estruturas já com a PMO preenchida (D8).

**C. Lançamento**
- SN o mesmo: nada muda.
- SN próprio: no posto de ligação, dois bipes, como na Integração, com as mesmas recusas legíveis: PRT já ligada, PRT que não concluiu o trecho dela, PMO já ligada.

**D. Fluxo**
- O card do posto que conclui um trecho ganha uma linha, no estilo do card Finalizadas: `└ PRT420 → Compels 8499: apontadas N · na fila M ⚠ <motivo>`.

**E. Almoxarifado / Estoque pendente**
- As linhas das PRTs aparecem na mesma lista, identificadas como `8499 · PRT420`.

## 8. Em aberto

- **Frequência do apontamento das PRTs:** por hora (recomendado: perto do tempo real, no máximo uns 10 lotes por dia), a cada N peças, no fim do turno ou peça a peça (um lote por peça no Compels). Depende de conversa interna. Até lá, a chave fica desligada (D7).
- **Regra de transição:** com a OP liberada, as PRTs dela **não podem mais ser apontadas à mão**. A proteção do ponto de partida (0168) evita contar em dobro, parando com aviso, mas a regra precisa ser combinada com quem aponta hoje.

## 9. Erros e casos de borda

| Situação | Comportamento |
|---|---|
| Compels fora do ar na criação da OP | OP criada sem as filhas, com aviso; casamento refeito no 1º envio |
| OP filha cancelada ou trocada depois | O envio confere sempre; a linha para com "OP 8499 cancelada no Compels" |
| Reaprovação depois da Manutenção | Não duplica (chave por trecho + série) |
| Lançamento cancelado | Pendente é cancelado; enviado vira estorno manual |
| Painel | Quantidade = N |
| Requisição faltando na filha | Espera, sem gastar tentativa; paga pendência se existir uma |
| PTH antes da SMD | PTH espera a SMD entrar |
| Apontamento manual na mesma filha | O ponto de partida detecta a diferença e para com aviso |
| Receita editada | Só vale para OP nova (D5) |
| Bipe duplo errado | Recusa com o motivo |

## 10. Testes

1. **Testes de domínio (vitest):**
   - validação da receita;
   - árvore do Compels virando filhas pelo código;
   - trecho da peça pelo posto;
   - uma vez por trecho;
   - painel;
   - ligação do SN próprio.
2. **Harness SQL** (`supabase/tests/`): cada migração roda 2×; a RPC do lançamento enfileira no posto certo e não duplica; o cancelamento cancela a linha da PRT.
3. **Smoke local:**
   - OP igual à 8498 (PMOC14, SN o mesmo) e OP igual à fonte 8682/8683 (SN próprio);
   - Compels simulado (o mesmo do Almoxarifado) e Chrome automatizado;
   - bipes, reprova e Manutenção, cancelamento e bipe duplo errado, conferindo o banco em cada passo.
4. **Produção:** uma OP piloto liberada e acompanhada; as demais continuam como hoje até a aprovação.
