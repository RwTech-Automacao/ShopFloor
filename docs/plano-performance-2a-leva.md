# Plano de Performance — 2ª leva (ShopFloor)

> Segue o playbook do usuário: **diagnosticar (EXPLAIN) antes de otimizar**. Nada de "otimizar no escuro".
> Contexto: [[escalabilidade-shopfloor]] · 1ª leva já feita (índice `sf_registros(numero_serie_norm)` 0091 = busca de SN; auto-refresh do Fluxo pausa aba oculta + 20s).

## Objetivo

Cortar as **varreduras completas da `sf_registros`** que hoje são feitas puxando linhas pro servidor Next e agregando em JS. Substituir por **agregação no banco (SQL/RPC)** — 1 round-trip, sem trazer milhares de linhas. Foco nos dois caminhos de maior custo × frequência.

## Os 2 hot-paths (medidos no código)

### A) `contarLancadosNoPosto` — **pior ofensor POR BIPE** (frequência altíssima)
`src/modules/shopfloor/infra/lancamento-repository.ts:54`
- Roda em **todo bipe** (contador "nesta OP/posto").
- Puxa **todos** os registros de `(pmo,op,posto)` pro Next (páginas de 1000), monta em JS o "último status por SN" e conta os não-reprovados.
- Custo cresce com registros do posto (OP 5000 + retestes → várias páginas **a cada bipe**). Liga com "1 bipe = ~18 round-trips".
- **Independente da tela de Fluxo** → pode ser feito já, sem esperar o debate do Fluxo.

### B) `contarPendentesPorPosto` — **load do Fluxo** (a cada 20s por aba aberta)
`src/modules/shopfloor/infra/fluxo-repository.ts` (chamado por `carregarFluxoOp`)
- Puxa **todos** os registros da OP pro Next (páginas de 1000) e roda `postoPendenteDePeca` por peça pra achar a fila (WIP) de cada posto.
- A RPC `sf_fluxo_op` **já lê as mesmas linhas** no servidor pra agregar (aprovadas/registros/1ª-passagem/passou_distinto) e **já tem um `wip_t`** — mas o `wip_t` é uma **aproximação** (reprovado→sempre Manutenção; aprovado→fica no próprio posto em vez de avançar), então o JS **sobrescreve** o WIP da RPC.
- Resultado: a OP é **varrida 2×** por load (RPC no banco + scan puxado pro JS).

## Fases (ordem por impacto × risco × independência)

### Fase 0 — MEDIR (baseline, obrigatória antes de mexer)
Rodar `EXPLAIN (ANALYZE, BUFFERS)` nas queries dos 2 hot-paths, na **OP mais pesada** (a de 5000), em Prod (RDS) e/ou Dev. Capturar: tempo, se é Seq Scan ou Index Scan, linhas lidas. Queries prontas na seção "Anexo — queries de medição".
- Também: `select posto, count(*) from sf_registros where pmo=$ and op=$ group by posto` pra ver o volume por posto (dimensiona o A).
- Confirmar índices existentes: `\d sf_registros` (esperado: algo com `(pmo,op)` líder; 0058 criou índices; 0091 = `(numero_serie_norm)`).

### Fase 1 — `contarLancadosNoPosto` vira agregação no banco  ⭐ (começar por aqui)
- **Por quê primeiro:** maior frequência (todo bipe), **independe do debate do Fluxo**, baixo risco.
- **Como:** substituir o scan+JS por **1 query agregada** (ou RPC `sf_contar_lancados(pmo,op,posto)`):
  ```sql
  select count(*) from (
    select distinct on (numero_serie_norm) status
    from sf_registros
    where pmo=$1 and op=$2 and posto=$3 and numero_serie_norm <> ''
    order by numero_serie_norm, data_hora desc, id desc
  ) t
  where lower(trim(status)) <> 'reprovado';
  ```
- **Índice:** garantir que `(pmo,op,posto)` (com `numero_serie_norm` pra o distinct) é servido por índice — checar no EXPLAIN; criar se faltar (`create index concurrently` no Prod).
- **Validação:** o valor tem que bater com a função JS atual em várias OPs/postos (harness de paridade). Migração = só o índice (se preciso) + RPC opcional.

### Fase 2 — Consolidar o WIP do Fluxo na RPC `sf_fluxo_op`  ⭐⭐ (maior lever do Fluxo)
- **Depende do debate do Fluxo** (se a tela mudar, refazer). Fazer **depois** que o usuário definir o Fluxo.
- **Como:** replicar `postoPendenteDePeca` **em SQL** dentro da RPC, para o `wip_t` bater 100% com o JS e **dropar `contarPendentesPorPosto`** (elimina o 2º scan puxado pro JS).
  - A RPC precisa da **ordem dos postos** (join `sf_ordem_postos`) e do **perfil** (join `sf_postos`: `exigeManutencao`, `recurso` p/ burnin) — hoje ela só recebe `(pmo,op)`.
  - Regras a replicar: reteste (`posto_retorno` → 1º da lista); reprovado → Manutenção **se o posto exige**, senão próprio posto; burn-in entrada (recurso burnin, status vazio) → próprio posto; aprovado/passagem → **próximo** posto (ou concluído); sem registro → 1º posto (+ não-iniciadas na Entrada).
- **Risco:** médio/alto (lógica sutil). **Mitigação:** o domínio já tem `postoPendenteDePeca` + testes (`fluxo-op.test.ts`); criar um **harness de paridade** que compara a RPC nova vs o JS atual em TODAS as OPs reais antes de trocar. Só remove o JS quando bater em 100%.

### Fase 3 — Menos round-trips no Fluxo e na auth
- `fluxoPeriodo` faz **2 chamadas** (matutino+vespertino) somadas no cliente → 1 RPC que recebe as faixas e soma no banco.
- **Taxa dupla de auth** (2 Auth + 2 DB por server action: middleware + `getSessao`) — avaliar N1 (tirar query do middleware) / claims no JWT. Auth-sensível → cuidadoso, medir ganho.

### Fase 4 — Estrutural (depois, se necessário)
- **Arquivar/particionar `sf_registros`** (só cresce; 23k prod / 68k dev). Particionar por OP/mês ou arquivar OPs finalizadas antigas — reduz o custo de todo scan residual.
- **Cache** de referências quase-estáticas: `mapaPostoPerfil`, `sf_defeitos`, `tabela_nqa` (lidas a cada ação; mudam raramente).

## Regras de segurança
- Índices no Prod: **sempre `create index concurrently`** (psql, fora de transação); no Dev SQL Editor, `create index` normal (roda em transação).
- Toda troca scan→SQL passa por **harness de paridade** (novo == antigo em dados reais) antes de remover o código antigo.
- Sem senha/connection string no chat (psql pede a senha).

## Anexo — queries de medição (Fase 0)
> Trocar `:pmo`/`:op`/`:posto` pela OP de 5000 e um posto cheio (ex.: Teste).

```sql
-- A) contarLancadosNoPosto (por bipe)
explain (analyze, buffers)
select numero_serie_norm,status,data_hora,id
from sf_registros
where pmo=:pmo and op=:op and posto=:posto and numero_serie_norm <> '';

-- A') versão agregada proposta (comparar tempo)
explain (analyze, buffers)
select count(*) from (
  select distinct on (numero_serie_norm) status
  from sf_registros
  where pmo=:pmo and op=:op and posto=:posto and numero_serie_norm <> ''
  order by numero_serie_norm, data_hora desc, id desc
) t where lower(trim(status)) <> 'reprovado';

-- B) contarPendentesPorPosto (load do Fluxo) — o scan que vai pro JS
explain (analyze, buffers)
select numero_serie,numero_serie_norm,status,posto,posto_retorno,data_hora,id
from sf_registros
where pmo=:pmo and op=:op and numero_serie_norm <> ''
order by data_hora asc, id asc;

-- B') a RPC do Fluxo (já agrega no banco)
explain (analyze, buffers) select * from sf_fluxo_op(:pmo, :op);

-- Volume por posto (dimensiona o A)
select posto, count(*) from sf_registros where pmo=:pmo and op=:op group by posto order by 2 desc;

-- Índices atuais
-- (no psql) \d sf_registros
```
