# Placas por painel (peso do bipe) — design

Data: 27/10/2026 · Branch: `feat/placas-por-painel` (da `main`, `74cd14e`)

## Problema

Há uma placa tão pequena que vem em painel: não cabe uma etiqueta por placa, só uma por painel.
Na OP dessa placa, cada bipe identifica um painel inteiro e deve contar como as N placas dele
(N = 50 nessa OP). Hoje cada bipe é uma linha em `sf_registros` e essa linha vale 1 em toda contagem.

## Decisões (travadas com o usuário em 27/10)

1. **Tudo vale N**: progresso/finalização da OP, caixa, Dashboard/Fluxo/Pesquisa, Almoxarifado/Compels.
2. **Configurável no cadastro da OP**, default 1 (comportamento atual intocado).
3. **Peso gravado em cada bipe** (não multiplicação na leitura): editar o N depois não reescreve o histórico.
4. **Limite da caixa digitado em placas** (ex.: 500 = 10 painéis de 50).
5. **O painel é sempre completo** (N placas). Painel parcial está fora do escopo.

## Modelo de dados

- `sf_ordens.placas_por_painel int not null default 1 check (placas_por_painel >= 1)`.
- `sf_registros.pecas int not null default 1 check (pecas >= 1)`. Linhas existentes ficam 1.
- Trigger `BEFORE INSERT` em `sf_registros`: `new.pecas := coalesce((select placas_por_painel from sf_ordens where pmo = new.pmo and op = new.op), 1)`.
  Cobre todos os caminhos de gravação (Lançamento, Integração, NQA, Embalagem, Almoxarifado)
  sem mexer em cada RPC. Registro sem OP cadastrada fica 1.
- `sf_registros_cancelados` guarda o registro inteiro em `dados jsonb`, então `pecas` acompanha sem mudança.

## Contagens que passam a somar `pecas`

Regra: onde hoje se conta **bipes como quantidade de peças**, passa a `sum(pecas)`.
Onde se conta **eventos/razões** (ex.: % de aprovação, passou/reprovou), segue por bipe.

- **Progresso e finalização da OP**: `sf_ordem_resumo`, `sf_ops_com_bipes` (contagem e % de conclusão),
  finalização automática (`0145`) e reabertura (`0148`): "X de qtd da OP" compara placas com `sf_ordens.qtd`.
- **Caixa/Embalagem**: contador `X/limite`, `qtd` da caixa, `sf_fechar_caixa` (código `CX[seq][qtd]OP-PMO`
  com qtd em placas), regra do limite (bloquear bipe que estoura o limite), `pecasAntesDaCaixa`.
  O tipo/RPC de ajuste de limite (branch `feat/ajustar-limite-caixa`, estacionada) não é tocado aqui.
- **NQA**: contagem da caixa/lote avaliados (quantidade de peças), mantendo a lógica de aprovação por caixa.
- **Dashboard, Fluxo, Pesquisa**: produção por posto/período, cadência, totais de peças (`sf_dashboard`,
  `sf_fluxo_*`, `sf_producao_periodo`, `sf_defeitos_resumo` para volumes). Percentuais continuam por bipe.
- **Almoxarifado / Compels**: quantidade do cartão, da entrada e da fila `sf_estoque_envios`
  (`sf_almoxarifado_entrada`, `0132`, `0153`), e o apontamento ao ERP.

Não muda: lista de SNs, histórico por bipe, cancelamento (cancela o bipe inteiro), telas de rastreio
(1 bipe = 1 painel), unicidade do SN.

## UI

- Cadastro/edição de OP: campo numérico "Placas por painel" (padrão 1, mínimo 1), com dica
  "Use quando a etiqueta é por painel: cada bipe conta como N placas."
- Telas de bipe: o painel de resultado mostra "+N" quando N > 1; contadores já mostram placas.
- Mensagem de limite: "Este painel (N placas) ultrapassa o limite da caixa (X/Y)."

## Erros e bordas

- Mudar `placas_por_painel` com bipes já gravados: permitido; vale só para os próximos (histórico intacto).
- Caixa com limite que não é múltiplo de N: o último bipe que estoura é recusado com a mensagem acima.
- `qtd` da OP continua em placas; N não altera `qtd`.

## Testes

- Harness SQL (`supabase/tests/`, Docker, migração 2×): trigger (OP com N=50, OP sem N, registro sem OP),
  cada função alterada com OP N=1 (idêntico ao atual) e N=50.
- Vitest: domínio da caixa (limite em placas, bloqueio de estouro), campo do cadastro da OP, painel de resultado.
- Regressão: suítes existentes verdes com `--maxWorkers=2`.

## Entrega (uma migração aditiva `0161_placas_por_painel`, em etapas de commit)

1. Colunas, trigger, campo no cadastro da OP, progresso e finalização.
2. Caixa e Embalagem.
3. Dashboard, Fluxo e Pesquisa.
4. Almoxarifado e Compels.

Prod: migração aditiva aplicada uma a uma (`lock_timeout=3s`) + `docker compose restart rest` + `deploy.sh`,
só com aval do usuário. Compels segue desarmado.
Obs.: a numeração `0161` colide com a branch estacionada `feat/ajustar-limite-caixa` (também 0161);
renumerar a que for mergeada depois.
