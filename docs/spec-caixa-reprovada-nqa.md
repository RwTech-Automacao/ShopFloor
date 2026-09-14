# Caixa reprovada no NQA — remontagem na Embalagem

**Branch:** `feat/shopfloor-fix-embalagem-nqa` (parte da main em `77e3ced`)
**Origem:** bug em Prod na OP PMOC14·8498 — a CX[7] foi reprovada no NQA e as peças, ao voltarem
para a Embalagem, abriram a CX[10] em vez de refazer a CX[7].

## O problema

Três defeitos somados:

1. **A caixa reprovada continua fechada.** `sf_nqa_caixa` grava a reprova e a rota de retorno, mas
   não toca em `sf_caixas`. A caixa segue com `fechada = true` e código final, como se estivesse
   pronta para expedição.

2. **A Embalagem escolhe a caixa pelo maior `seq`, sem olhar a peça.**
   `carregarEstadoEmbalagem`: `seq = ultima.fechada ? ultima.seq + 1 : ultima.seq`. O painel não tem
   nenhuma noção de reteste ou `posto_retorno`.

3. **A caixa conta registros, não peças.** `sf_fechar_caixa` e a trava `CAIXA_CHEIA` do `sf_lancar`
   usam `count(*)`. Isso também quebra a **embalagem individual**: a caixa é o próprio SN com limite
   1, então uma peça que volta do NQA encontra `1 >= 1` e nunca consegue ser reembalada.

### Consequência observada em Prod

As peças ficaram em duas caixas ao mesmo tempo (`331001347` e `331001348` estão na CX[7] fechada e
na CX10 aberta). Como `resolverCaixaPorSn` usa o registro `CX%` mais recente, o NQA passou a
enxergar uma "caixa de 2 peças" no lugar da CX[7] de 14.

## O modelo escolhido

A montagem reprovada vira **histórico** e a remontagem nasce como **caixa nova com o mesmo número**:

```
antes da reprova    CX[7][14]8498-PMOC14    fechada
depois da reprova   CX[7]R[14]8498-PMOC14   reprovada (revisao=1) — nunca mais muda
remontada           CX[7][14]8498-PMOC14    fechada (revisao=0)
```

Por que caixa nova em vez de reabrir a antiga: reabrir faria a mesma peça ganhar um segundo registro
com o **mesmo** `numero_caixa`, e toda contagem da caixa passaria a contar a peça duas vezes. Com
caixa nova cada montagem tem seu marcador, sem colisão — e o NQA passa a resolver a remontagem
sozinho, porque já procura o registro de caixa mais recente da peça.

`sf_caixas.revisao`: `0` = montagem vigente daquele `seq`; `1, 2, …` = montagens reprovadas.

## Comportamento

### Na reprova do NQA
A montagem é aposentada **apenas quando a rota de retorno passa pelo posto da caixa**. Se a caixa
volta para o Teste e não pela Embalagem, ninguém a remontaria e o `seq` ficaria órfão.

### No bipe da Embalagem
O servidor decide, não a tela — o painel pode estar com estado de segundos atrás e a reprova
acontece em outra tela, em outro posto.

```
bipa uma peça
   ├── pertence a uma caixa reprovada ainda não remontada?
   │     ├── não → caixa da tela, fluxo normal (nada muda)
   │     └── sim → puxa a caixa dela, painel entra em modo remontagem
   └── com a remontagem na tela:
         ├── SN estava na montagem original → entra direto
         └── SN não estava → aviso com o motivo + botão "Incluir mesmo assim"
```

O aviso não bloqueia — informa. A checagem de postos anteriores **já é feita** pelo `sf_lancar`
(trava de sequência) e não precisa de código novo.

### No fechamento
Se faltar peça da montagem original, o diálogo lista quais faltaram e deixa fechar assim mesmo.

### Na aba de caixas
A montagem reprovada continua listada, com os mesmos SNs, mas: código com `R`, sem a pílula
"fechada", e **Imprimir/PDF desabilitado** — o conteúdo dela não vale mais como folha de caixa.

## Migração

**Uma só: `0100_caixa_reprovada_revisao.sql`** (0098 e 0099 estão reservadas em branches não
mergeadas — `cancelar-embalagem` e `tela-defeitos`).

| Objeto | Mudança |
|---|---|
| `sf_caixas` | nova coluna `revisao int not null default 0` |
| `sf_caixas` | unicidade sai de `(pmo,op,posto,seq)` para `(pmo,op,posto,seq,revisao)` |
| `sf_aposentar_caixa` | **nova** — sobe a revisão, carimba o `R` no código em `sf_caixas` e nos registros |
| `sf_nqa_caixa` | recriada: na reprova, chama a aposentadoria quando a rota passa pelo posto da caixa |
| `sf_fechar_caixa` | recriada: opera em `revisao = 0` e conta `distinct numero_serie_norm` |
| `sf_lancar` | recriada: `CAIXA_CHEIA` conta as **outras** peças (`<> p_numero_serie_norm`), o que cura a embalagem individual |

Aditiva e retrocompatível: caixas existentes ficam em `revisao = 0` e nada muda para elas.

## Aplicação

| Arquivo | Mudança |
|---|---|
| `caixa-repository.ts` | `carregarEstadoEmbalagem` ganha `seqEmFoco` e devolve `remontagem`; `resolverCaixaDeRetorno`, `montagemAnterior`, `outrasCaixasDoSn` (novas); dedupe de SN em todas as contagens; `revisao` em `CaixaConsulta` e `aposentada` em `CaixaDoSn` |
| `embalagem-actions.ts` | `embalarPeca` resolve a caixa pelo SN no servidor, devolve o `seq` usado e o pedido de confirmação |
| `embalagem-panel.tsx` | faixa de remontagem, troca de caixa quando o servidor devolve outro `seq`, botão "Incluir mesmo assim", aviso de peças faltantes no fechamento |
| `consultar-caixa` | pílula "reprovada", PDF desabilitado nas montagens aposentadas |
| `nqa-caixa-actions.ts` | mensagem própria quando o SN cai numa montagem já aposentada |

## Teste no Dev

Cenário completo: embalar 14 → fechar → NQA reprovar com rota pela Embalagem → conferir que virou
`CX[7]R` sem PDF → bipar as 14 de volta → conferir que puxou a CX[7] → bipar uma peça de fora e
confirmar o aviso → fechar → NQA aprovar.

Mais: embalagem **individual** com peça voltando do NQA (o `CAIXA_CHEIA` que travava); caixa
reprovada com rota que **não** passa pela Embalagem (não pode aposentar).

## Estimativa

| Etapa | Tempo |
|---|---|
| Migração 0100 | 1h ✅ feito |
| Repositório + actions | 1h30 ✅ feito |
| Painel de Embalagem (remontagem, confirmação, fechamento) | 1h30 |
| Aba de caixas (pílula e PDF) | 30min |
| Testes automatizados do domínio | 30min |
| Smoke no Dev (cenário completo) | 1h |
| **Total** | **6h — restam 3h30** |

## Conflito previsto

Sobrepõe com `feat/shopfloor-cancelar-embalagem` (0098), que tem sua própria reabertura de caixa
inline para o caso de cancelamento. Na hora de mergear as duas, apontar a 0098 para
`sf_aposentar_caixa` em vez de duplicar a lógica.
