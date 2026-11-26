# SAT — ordem de serviço, etapas, manutenção, qualidade e expedição (desenho)

Data: 26/11/2026 · Branch: `feat/sat-ordem-servico` · Desenho combinado com o usuário em partes, em 25–26/11/2026.
Continua `2026-11-17-sat-entrada-design.md` (entrada, já em produção) e `2026-11-18-sat-alerta-entrada-design.md`.

## Objetivo

O SAT passa a acompanhar cada relógio da entrada à saída **só pelo ShopFloor**, sem papel e sem planilha de expedição.
A ordem de serviço (OS) deixa de existir no Compels: passa a existir só no ShopFloor. O Compels continua com o **pedido
de venda** e a **NF**.

## O que os dados do Compels mostraram (só leitura, 26/11)

- Módulo SAT do Compels (`sat/ordemServico`): **3.227 OS** desde 2022 (2022: 827, 2023: 871, 2024: 637, 2025: 496,
  2026: 396 até 26/11), numeradas `NNNN/AA`. Tipos: fora de garantia 1.741, em garantia 1.270, remanufatura 153,
  retorno de peça/matéria-prima 35.
- As **situações** da OS já funcionam como etapas (Aguardando Análise do SAT, Em manutenção, Teste de Qualidade,
  Envio de Orçamento/Relatório, Aguardando aprovação do Orçamento, Orçamento Reprovado, Aguardando Remanufatura,
  Remanufatura OK, Expedição, Finalizada). 525 OS estão "Finalizada" mas com status Aberto: ninguém fecha à mão.
- O responsável é texto livre ("RITA", "Rita Souza", "carina"…): não serve para indicador.
- A OS **não nasce da NF de entrada** (0 de 40 OS com nota; itens digitados à mão: código do produto + NS).
- **Nenhuma OS está vinculada a pedido de venda** (0 de 3.227; o botão "Importar Ordem de Serviço" do pedido não é usado).
- A manutenção **lança defeito/solução e peças** na OS (55 de 60 e 48 de 50 OS recentes; 103 peças), mas **nenhuma
  peça é requisitada pela OS** (0 de 103). **91 das 103 peças aparecem no pedido de venda** do mesmo cliente, feito
  até 45 dias depois: a baixa das peças é pelo pedido de venda / NF de saída, digitado à mão.
- Defeitos cadastrados: 88 (`sat/defeito/findAll`). Técnicos: 9. Não existe lista de motivos de reprovação da qualidade.
- Estrutura do produto (`composicaoProduto`): a do PMOC31 tem 247 itens (árvore inteira de fabricação). Os **kits de
  reposição** (ex.: PMOE74 módulo Camabio com cabo, 102 OPs em 3 anos; PMOE12 kit sensor de papel, 36 OPs) não entram
  em nenhuma estrutura: são fabricados só para reposição.

## Decisões

1. **A OS existe só no ShopFloor.** Uma OS por relógio, criada na entrada (cada relógio da NF de entrada vira uma OS).
   O ticket do suporte (coluna "OS" da planilha, hoje `sat_os`) fica como referência dentro da OS. Numeração própria
   `NNNN/AA`, **continuando a sequência do Compels no ano** (a primeira OS do ShopFloor em 2026 é a seguinte à última
   do Compels), para a equipe não estranhar. *(a confirmar com o SAT)*
2. **Manutenção é o próprio SAT.** Não há setor de manutenção separado.
3. **Garantia vem da planilha**, como hoje. Quem decide é o suporte, ao mandar o relógio para a fábrica (ordem:
   repinmetro → NF da revenda para o cliente final → AFD). O ShopFloor não recalcula. O **tipo** da OS nasce da
   garantia (em garantia / fora de garantia) e pode ser mudado para **remanufatura** ou **retorno de peça** na entrada.
4. **Qualidade primeiro, orçamento em paralelo.** Fora da garantia, depois da manutenção a OS vai para a **qualidade**
   exatamente como em garantia; o **orçamento corre em paralelo** (o SAT gera e envia enquanto a OS está na qualidade).
   Se o cliente reprovar o orçamento, o SAT **desfaz o conserto** e a OS vai para pronto para expedição (a partir da
   qualidade ou depois de aprovada nela). Só "garantia a definir" (tipo vazio) impede o envio para a qualidade.
5. **Peças trocadas** são registradas na OS com o código do item do Compels. A baixa de estoque **continua pelo pedido
   de venda** no Compels (como hoje). Peças trocadas e depois devolvidas (orçamento reprovado) **ficam no histórico**
   como "devolvida".
6. **Lista de peças da manutenção**, em 4 camadas:
   1. as mais usadas nesse modelo (histórico das OS, inclusive as importadas do Compels);
   2. os kits de reposição que servem ao modelo — um kit serve quando todos os componentes dele estão na estrutura do
      produto (calculado, ninguém cadastra);
   3. as peças trocáveis da estrutura do produto (placas, fonte, módulos, gabinete; sem as partes SMD/PTH, serviços
      de injeção `RWSV*` e embalagem);
   4. busca no cadastro inteiro de itens do Compels.
7. **Defeitos:** uma lista só, importada uma vez do Compels (88) e mantida no ShopFloor. A manutenção usa para o defeito
   encontrado (+ solução em texto) e a qualidade usa para reprovar.
8. **Pagamento (fora da garantia):** o cliente responde por e-mail aprovando ou reprovando, com o print do pagamento.
   O SAT registra a resposta e **anexa o comprovante** na OS. O **fiscal/expedição confirma o pagamento** no ShopFloor.
   **Fora da garantia só sai com orçamento aprovado e pagamento confirmado.** "Aguardando aprovação/pagamento" não é
   mais uma etapa: é o **status do orçamento** mostrado na OS.
9. **Valor da manutenção** vem do orçamento lançado pelo SAT no ShopFloor, disponível desde o fim da manutenção
   *(usuário: "eu acho" — a confirmar)*. **Frete** é cotado pelo SAT no site dos Correios e lançado no orçamento.
10. **Troca de número de série** fica registrada (NS antigo → NS novo) em **qualquer** OS (remanufatura e também
    manutenção). A busca acha o relógio pelos dois.
11. **Nota pendente** é só uma marcação: o SAT pede a nota nova ao cliente; não se registra o contato.
12. **Remanufatura vai para o estoque** *(usuário: "eu acho" — a confirmar)*. **Retorno de peça** (raro) vai para o
    estoque depois da análise; a peça é registrada pelo código do item, NS opcional.
13. **Formulário do suporte** continua gravando na planilha; o ShopFloor segue lendo de 10 em 10 minutos. Gravar direto
    no ShopFloor fica para depois (mexe no n8n).
14. **Histórico do Compels:** as 3.227 OS (com tipo, situação, datas, técnico, laudo, defeitos/soluções e peças) são
    importadas **só para consulta e indicadores**, marcadas como "importada do Compels". Não se copia
    `negociante.observacao` (pode ter senha de cliente).
15. **Nada é gravado no Compels** neste módulo (só leitura: defeitos, estrutura, itens, histórico). Mandar a lista de
    peças para o pedido de venda fica para depois.

## Etapas

### Manutenção (em garantia e fora de garantia)

```
Recebido ─┬─ NF aprovada ─────────────────────────────┐
          └─ NF reprovada → Nota pendente ─(NF corrigida/trocada)─┤
                                                                   ▼
                                              Disponível para manutenção
                                                                   ▼
                                                           Em manutenção ◄──────────────┐
                                                                   ▼ (garantia ou não)  │
                                                               Qualidade ── reprova ────┘
                                                                   │ aprova
                                                                   ▼
                                                        Pronto para expedição
                                                (fora da garantia: só com orçamento aprovado
                                                 e pagamento confirmado)
                                                                   ▼
                                                          Enviado  → OS fechada

Orçamento (só fora da garantia), em paralelo desde o fim da manutenção:
  gerado/enviado pelo SAT (OS na qualidade) → aprovado + comprovante → pagamento confirmado → libera a expedição
                                            └→ reprovado → SAT desfaz o conserto → Pronto para expedição
                                               (de dentro da qualidade ou depois de aprovada nela)
```

### Remanufatura
Recebido → Disponível para manutenção → Aguardando remanufatura → Remanufatura OK (troca de NS, se houver) →
Qualidade → **Estoque** (OS fechada).

### Retorno de peça
Recebido → Análise → **Estoque** (OS fechada).

### Quem muda cada etapa

| De → para | Quem (permissão) | O que registra |
|---|---|---|
| Recebido → Nota pendente / Disponível | automático na entrada | situação da NF (já existe) |
| Nota pendente → Disponível | `sat.aprovar_nf` (corrigir/trocar NF, já existe) | — |
| Disponível → Em manutenção | `sat.manutencao` | técnico = usuário logado |
| Em manutenção → Qualidade | `sat.manutencao` | defeitos + solução, peças, laudo (igual em garantia e fora; bloqueia só se a garantia está a definir) |
| Orçamento (paralelo): gerar/enviar, aprovado / reprovado | `sat.manutencao` | valor da manutenção e do frete; resposta do cliente + comprovante (aprovado) / reprovado: desfaz o conserto, peças voltam a "devolvida" e a OS vai para Pronto |
| Qualidade → Pronto / Em manutenção | `sat.qualidade` (tela de tablet) | aprova, ou reprova com 1+ defeitos |
| (pagamento) | `sat.confirmar_pagamento` (fiscal/expedição) | confirmado por/em |
| Pronto → Enviado | `sat.expedicao` | código de rastreio, data de saída |
| Remanufatura OK / Análise → Estoque | `sat.manutencao` | — |

Toda mudança grava histórico (de, para, quem, quando, dados). Ninguém pula etapa pela tela; o administrador
(`sat.administrar`) pode corrigir a etapa com motivo, que fica no histórico.

## Telas

- **Fila do SAT** — quadro por etapa (contagem + lista), filtros por tipo, cliente, NS, período; busca por NS (antigo ou
  novo) mostra em que etapa o relógio está.
- **Ficha da OS** — cabeçalho (número, tipo, cliente, NS, garantia, ticket do suporte, NF de entrada), linha do tempo
  das etapas, defeitos, peças, laudo, orçamento, pagamento/comprovante, expedição, trocas de NS. A ação disponível
  depende da etapa e da permissão.
- **Manutenção** (dentro da ficha) — defeito (lista) + solução, peças (lista em 4 camadas), laudo, troca de NS,
  orçamento (fora da garantia).
- **Qualidade (tablet)** — lista do que está em "Qualidade"; abrir pelo NS (bipe); aprovar ou reprovar com defeitos.
  Botões grandes, funciona em 1024×768.
- **Expedição** — lista do que está pronto: cliente, relógio, garantia, valor da manutenção, frete, pago/não pago;
  registrar rastreio e data de saída (bloqueado se fora da garantia e não pago). Substitui a planilha de expedição.
- **Pagamentos** (fiscal) — lista do que aguarda confirmação, com o comprovante; confirmar.
- **Indicadores** — relógios por etapa; em garantia × fora; tempo médio em cada etapa; principais defeitos; índice de
  retorno por componente (inclui o histórico importado).
- **Administração** — lista de defeitos.

## Avisos (Discord, pelos Alertas)

Novo tipo de regra nos Alertas: **"Mudança de etapa no SAT"**, com escolha das etapas que disparam e do canal. Regras
iniciais sugeridas: todas as mudanças → canal do SAT; "comprovante anexado" → fiscal; "pronto para expedição" →
expedição. O aviso de chegada (regra "Entrada no SAT") continua como está.

## Banco (migrações novas; numerar a partir da próxima livre na main)

- `sat_defeitos` (código do Compels, descrição, ativo) — carga inicial dos 88.
- `sat_ordens` (número `NNNN/AA`, entrada_id único, tipo, etapa, cliente/cnpj, produto, NS atual, garantia, ticket,
  laudo, valor da manutenção, valor do frete, resposta do orçamento + quando, pagamento confirmado por/em,
  rastreio, data de saída, fechada_em, origem `shopfloor`/`compels`, id no Compels para as importadas).
- `sat_ordem_defeitos` (ordem, defeito, origem `manutencao`/`qualidade`, solução, quem, quando).
- `sat_ordem_pecas` (ordem, código e descrição do item do Compels, quantidade, situação `trocada`/`devolvida`, quem,
  quando).
- `sat_ordem_ns` (ordem, NS antigo, NS novo — modelo/sequência normalizados como na entrada —, quem, quando).
- `sat_ordem_historico` (ordem, etapa de/para, quem, quando, dados).
- Anexos (comprovante) pelo mesmo mecanismo de anexos já usado no ShopFloor.
- RLS no padrão `(select tem_permissao('sat', ...))`; escrita só por funções security definer que validam a transição
  de etapa; permissões novas `manutencao`, `qualidade`, `confirmar_pagamento`, `expedicao`.

## Leituras do Compels (só leitura, pela integração existente)

- Defeitos: `POST sat/defeito/findAll` (carga inicial).
- Estrutura: `POST composicaoProduto/findByCodigoItem` {codigoItem} → `POST composicaoProduto/findComposicaoByIdEntireTree` {id};
  pais de um item: `GET composicaoProduto/findParentsByItemId/<itemId>`. Guardar em cache por produto (a estrutura muda pouco).
- Busca de itens: cadastro de itens do Compels.
- Importação do histórico: `POST sat/ordemServico/findAll` (paginado), `sat/ordemServico/findById`,
  `sat/itemOrdemServico/findAllByOrdemServicoId`, `sat/defeitoSolucao/findByOrdemServicoId`,
  `sat/componente/findByOrdemServicoId` — todos POST form; filtros com `sortFilter: 'null'`.

## Entregas (cada uma testável sozinha)

1. **OS + etapas + fila + ficha + manutenção** (defeitos, peças em 4 camadas, laudo, troca de NS), em garantia.
2. **Fora da garantia — orçamento paralelo + pagamento:** orçamento gerado/enviado enquanto a OS está na qualidade, resposta do cliente com comprovante, confirmação do pagamento, reprovado desfaz o conserto.
3. **Qualidade (tablet) + Expedição** (fecha a OS).
4. **Remanufatura e retorno de peça.**
5. **Avisos por etapa** (novo tipo de regra nos Alertas).
6. **Importação do histórico do Compels + indicadores.**

## Fora do escopo

- Gravar qualquer coisa no Compels (OS, pedido de venda, requisição de material).
- Formulário do suporte gravando direto no ShopFloor.
- Registro de contato com o cliente na nota pendente.

## A confirmar com o SAT

- Numeração continuando a do Compels.
- Valor da manutenção vem do orçamento (decisão 9).
- Remanufatura termina no estoque (decisão 12).
- Retorno de peça: a peça tem número de série?
- Definição do índice de retorno por componente (proposta: OS com a peça trocada ÷ relógios produzidos do modelo,
  por período).
