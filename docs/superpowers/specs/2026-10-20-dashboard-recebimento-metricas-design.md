# Dashboard do Recebimento: mais métricas (rascunho para aprovação)

Estado: **rascunho de 20/10/2026**, sem código. Estende `2026-10-14-dashboard-recebimento-design.md` (a tela de divergências, migração 0152, já em produção).
Pedido do usuário: o dashboard está "muito ruim e com pouca informação/métrica". Os cinco blocos abaixo foram escolhidos por ele.

## O que existe hoje (não muda)

`/recebimento/dashboard`: filtros (fornecedor, comprador, EMB, código, De/Até), três números (Itens, Com divergência, Sem justificativa), ranking de fornecedores, itens divergentes por semana de
chegada e positivas × negativas. Tudo vem de **uma chamada**, `rec_dashboard` (agregada no banco; régua = `data_chegada`; cancelado fora). **Ela não é alterada.** O que for novo vem de uma função nova.

## Decisões do usuário

1. **Taxa de reprovação por item** (a quantidade fica na dica).
2. **"Parado há mais de X dias":** X é um seletor (3, 7, 15, 30), padrão **7**.
3. **Pendências contadas pelo atraso** da data prevista, não por "há quanto tempo abriu".

## Os cinco blocos (todos obedecem aos filtros de fornecedor, comprador, EMB e código)

Item = uma linha de `processos_recebimento`; `cancelado` fica de fora (mesma régua da 0152). Datas: `data_prevista`, `data_chegada`, `finalizado_em`.

| Bloco | O que mostra | Definição |
|---|---|---|
| **Volume** | EMBs e itens **por semana e por mês** (alternar) | por `data_chegada`; EMB = número de EMB distinto |
| **Qualidade** | **Taxa de reprovação por item**, por fornecedor e por material (top 10), e os motivos mais comuns | reprovado = `resultado` "Reprovado" (a mesma regra do Fluxo); taxa = reprovados ÷ itens **com resultado**; material = `codigo_material`; motivos = `motivo_reprovacao` (top 5); na dica: peças reprovadas ÷ peças recebidas |
| **Atraso** | % que chegou atrasado, média de dias de atraso, por fornecedor (top 10) | só itens com `data_prevista` e `data_chegada`; dias = `data_chegada − data_prevista`; atrasado = dias > 0. A coluna de texto `atraso` não é usada |
| **Tempo** | Tempo médio e mediano em cada etapa e quantos itens estão **parados há mais de X dias** | etapa Recebimento = `data_chegada` até a primeira conferência salva; etapa Qualidade = primeira conferência até `finalizado_em`; **parados** = itens que estão agora na etapa há mais de X dias |
| **Pendências** | Itens **ainda não chegados**, por faixa de atraso e por fornecedor | status `aberto` **sem `data_chegada`**; atraso = hoje − `data_prevista`; faixas: no prazo, 1 a 7, 8 a 30, mais de 30 dias; "sem data prevista" à parte |

Regras de recorte:
- De/Até valem para Volume, Qualidade, Atraso e Tempo (pela `data_chegada`). **Pendências ignoram De/Até**, porque por definição não têm `data_chegada`.
- **Tempo no Recebimento** só conta itens com `data_chegada`; o item aberto sem chegada não está "parado no Recebimento", está em Pendências.
- Item sem histórico que permita saber o tempo (processos antigos) entra em "sem tempo", e a tela mostra "—", nunca zero (mesma convenção do Fluxo).

## Como calcular (banco)

- **Função nova** `rec_dashboard_metricas(p_fornecedor, p_comprador, p_emb, p_codigo, p_de, p_ate, p_parado_dias int default 7) returns jsonb`, **uma chamada só** com os cinco blocos, no molde da
  `rec_dashboard` (mesmos filtros e a mesma `rec_norm_texto`). Migração nova (a próxima livre depois da 0153; conferir lacunas), aditiva e idempotente, `$func$`, `tem_permissao('recebimento','visualizar')` com **dois argumentos**.
- **Tempo:** a hora da primeira conferência vem do log `mudar_status` de `aberto → em_conferencia` (um por item). É a parte cara: medir com `set role anon` no harness (lição da 0096) e criar índice em `logs`
  se preciso. Para os itens que **estão agora** em conferência, o "desde" é o do log; o tempo dos finalizados usa `finalizado_em`.
- Mês e semana: semana segunda a domingo (como a série atual); mês pelo primeiro dia. Teto de eixo igual ao da 0152 (dados com data suja não podem criar anos vazios).

## Tela

Os cinco blocos entram **abaixo** do que existe, na mesma página e com os mesmos filtros (o seletor de X fica no bloco Tempo). Uma fileira nova de números no topo dos blocos: **% atrasados**, **taxa de reprovação**,
**mediana na Qualidade** e **parados há mais de X dias**. Clicar num fornecedor ou material filtra a página inteira, como já acontece. Os gráficos usam os mesmos componentes de `graficos-dashboard.tsx`; o tema claro e o escuro
valem como no resto.

## Testes

Harness SQL (`supabase/tests/`, cada migração duas vezes) com fixtures de cada bloco: reprovado, atrasado, aberto sem chegada, item sem histórico, filtros, `cancelado` fora, mês × semana, X diferentes. Domínio (formatação, "—",
faixas) e componentes (cartões e gráficos novos). Medir o tempo da função com volume grande antes de propor produção.

## Riscos

- O cálculo do Tempo depende do histórico em `logs`; processos antigos sem log ficam "sem tempo".
- A taxa por item esconde o tamanho do problema (um item com 100.000 peças vale o mesmo que um com 10): por isso a quantidade vai na dica.
- A lista "Resultado" é configurável: um valor novo de reprovação, diferente de "Reprovado", não entraria na taxa (mesma limitação aceita no Fluxo).
- Mais uma consulta ao abrir a página: ela roda em paralelo com a atual, e deve ficar abaixo do teto de 150 ms da 0152 no recorte padrão (a medir).

## Em aberto (pequenos; assumi o que está em itálico)

1. Reprovado = `resultado` "Reprovado" e o denominador só conta itens **com resultado** (*sim*).
2. Pendências ignoram De/Até (*sim*).
3. Mês no eixo do Volume em ordem cronológica, mais antigo à esquerda (*sim*).
