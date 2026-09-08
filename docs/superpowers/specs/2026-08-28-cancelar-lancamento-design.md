# Cancelar lançamento — design

> Design/spec. Branch `feat/shopfloor-cancelar-lancamento` (da main). Permite o **gestor** cancelar
> um bipe errado direto na **tela de Registros** (ShopFloor → Registros), sem SQL na mão e com
> auditoria. Cancelar **remove o bipe** → a peça "volta um posto" automático em todas as telas.

## Contexto

`sf_registros` é um **log append-only** (uma linha por bipe). O "estado atual" de uma peça em cada
posto é **derivado do seu último bipe** — Fluxo, Pesquisa, contadores e a trava de sequência todos
leem `sf_registros` e calculam a posição da peça a partir do bipe mais recente
(`postoPendenteDePeca`).

Hoje, quando um operador bipa errado (ex.: aprova no Teste uma peça que devia reprovar), a correção
é escrita direta no banco — que **fura o log da app** e é arriscada. Queremos uma ação de **cancelar
lançamento** na tela de Registros, só pro gestor, que remove o bipe de forma **segura, auditada e
consistente**.

Como tudo deriva do último bipe, **remover** o bipe faz a peça "voltar um posto" **automaticamente em
todas as telas** — sem precisar mexer em cada query. É esse o motivo de escolhermos remover (mover pra
auditoria) em vez de um flag de soft-cancel (que exigiria filtrar `cancelado is null` em todo lugar).

## Decisões travadas (do brainstorm)

- **Mecanismo: mover pra auditoria.** Cancelar = grava a linha numa tabela de auditoria + apaga de
  `sf_registros`. As telas/derivações seguem lendo `sf_registros` sem nenhuma mudança.
- **Regra LIFO:** só dá pra cancelar o **último bipe** de um SN (naquela OP). Pra cancelar um do meio,
  cancela os mais recentes primeiro. Validado no servidor (não confia na tela).
- **Escopo de postos (v1):** cancelável = postos que só vivem em `sf_registros` — **Passagem ·
  Inspeção (SMD/PTH/Final) · Teste · SPI · Burn-in (entrada/saída)**. Bloqueados: **Embalagem**
  (mexe em `sf_caixas`) e **NQA por caixa** (`sf_nqa_caixa`). **Integração fica de fora** (já tem o
  cancelar próprio, a aba Consultar/Cancelar Integração). Regra técnica: bloquear se o perfil do
  posto tem `recurso in ('caixa','nqa','integracao')`.
- **Permissão:** só `administrar` (gestor). Reusa a permissão existente — sem mexer no RBAC.
- **Motivo: OBRIGATÓRIO** no cancelamento (rastro).
- **Checagem de "é cancelável" ao abrir o detalhe** — o botão já habilita/desabilita certo, com o
  motivo quando não pode.
- Burn-in não tem tabela própria: `sf_burnin` é função que grava em `sf_registros` e
  `sf_burnin_aberto` é uma **view** — então cancelar burn-in = remover a linha, e a view se
  recalcula. LIFO cobre entrada/saída (cancela a saída → volta a "cozinhando"; entrada só depois).

## Banco (migração `0087`)

### Tabela de auditoria

```sql
create table if not exists public.sf_registros_cancelados (
  id                uuid primary key default gen_random_uuid(),
  id_original       uuid not null,
  pmo               text not null,
  op                text not null,
  numero_serie_norm text not null,
  posto             text not null,
  dados             jsonb not null,          -- a linha original inteira (to_jsonb)
  motivo            text not null,
  cancelado_por     uuid,                    -- auth.uid()
  cancelado_em      timestamptz not null default now()
);
create index if not exists sf_registros_cancelados_sn
  on public.sf_registros_cancelados (pmo, op, numero_serie_norm);
```

- `dados jsonb` guarda a linha original completa → rastro à prova de mudança de schema.
- **RLS:** select = `tem_permissao('visualizar')`; sem policy de escrita (só via a RPC definer).

### RPC de cancelamento

```
sf_cancelar_lancamento(p_id uuid, p_motivo text) returns void
```

`security definer`, `set search_path = public`. Passos:

1. Gate `if not tem_permissao('administrar') then raise exception 'SEM_PERMISSAO'; end if;`
2. `if coalesce(trim(p_motivo),'') = '' then raise exception 'MOTIVO_OBRIGATORIO'; end if;`
3. Lê a linha alvo por `p_id` (pmo, op, numero_serie_norm, posto, e a linha inteira). Se não existir
   → `raise exception 'NAO_ENCONTRADO'`.
4. `perform pg_advisory_xact_lock(hashtext(pmo || '/' || op)::bigint);` (serializa com o lançamento).
5. **Escopo do posto:** olha o `recurso` do perfil do posto (join `sf_postos`→`sf_posto_perfis`). Se
   `recurso in ('caixa','nqa','integracao')` → `raise exception 'POSTO_NAO_CANCELAVEL'`.
6. **LIFO:** confere que `p_id` é o bipe de **maior (data_hora, id)** entre os registros de
   `(pmo, op, numero_serie_norm)`. Se não for → `raise exception 'NAO_E_ULTIMO'`.
7. `insert into sf_registros_cancelados (id_original, pmo, op, numero_serie_norm, posto, dados,
   motivo, cancelado_por) select id, pmo, op, numero_serie_norm, posto, to_jsonb(r.*), p_motivo,
   auth.uid() from sf_registros r where id = p_id;`
8. `delete from sf_registros where id = p_id;`

> Ordem 4→6 com o advisory lock garante que ninguém bipa/lança a mesma OP no meio da checagem LIFO +
> delete (evita cancelar o "último" que deixou de ser o último um instante depois).

## Application

Em `src/modules/shopfloor/application/` (arquivo novo `cancelamento-actions.ts` ou dentro de um
existente de registros):

- **`cancelavelInfo(id: string): Promise<{ podeCancelar: boolean; motivo?: string }>`** — checagem
  pro botão (UX). Gate `administrar` (se não tem → `{ podeCancelar: false, motivo: 'Sem permissão' }`).
  Lê a linha por id; deriva o `recurso` do posto (via `mapaPostoPerfil`); confere se é o último bipe
  do SN (mesma regra da RPC, em leitura). Retorna `podeCancelar` + um `motivo` legível quando não pode
  ("Só o bipe mais recente deste SN pode ser cancelado" / "Este posto não pode ser cancelado aqui").
  Fail-closed: erro/sem-permissão → `{ podeCancelar: false }`.
- **`cancelarLancamento(id: string, motivo: string): Promise<{ ok: true } | { ok: false; erro: string }>`**
  — gate `administrar`; valida `motivo` não-vazio; chama a RPC; mapeia os erros
  (`NAO_E_ULTIMO`→"Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.",
  `POSTO_NAO_CANCELAVEL`→"Este posto não pode ser cancelado por aqui.", `MOTIVO_OBRIGATORIO`→"Informe
  o motivo.", `SEM_PERMISSAO`→"Você não tem permissão para cancelar.", `NAO_ENCONTRADO`→"Registro não
  encontrado (talvez já cancelado).").

Infra: `src/modules/shopfloor/infra/cancelamento-repository.ts` — `chamarSfCancelar(id, motivo)` (rpc)
+ `lerRegistroParaCancelar(id)` / `ehUltimoBipe(pmo, op, snNorm, id)` (leituras da checagem).

## UI (tela de Registros → painel de detalhe)

`src/app/(app)/shopfloor/registros/registros-tabela.tsx` já tem um painel de detalhe do bipe
selecionado (mostra PMO·OP, Posto, SN, Status, Colaborador…). Acrescentar:

- Um botão **"Cancelar lançamento"** no detalhe, **renderizado só se o usuário tem `administrar`**
  (a page passa `podeAdministrar: boolean` como prop, resolvido no server via sessão).
- Ao selecionar um registro (abrir o detalhe), chama `cancelavelInfo(sel.id)`; enquanto carrega o
  botão fica desabilitado ("Verificando…"); o resultado habilita/desabilita e, quando não pode,
  mostra o **motivo** ao lado/como tooltip.
- Clicar no botão → **diálogo de confirmação** (useConfirmacao ou um modal próprio) mostrando o bipe
  (SN · posto · status · data) + um **campo Motivo (obrigatório)** — confirmar só habilita com motivo
  preenchido. Confirmar → `cancelarLancamento(id, motivo)` → em caso de ok, **recarrega a lista** (o
  bipe some) e some o detalhe; em erro, mostra a mensagem.
- Defesa em profundidade: o botão só aparece pro gestor **e** a RPC re-checa `administrar` no servidor.

> A page de Registros (`page.tsx`) passa a resolver `podeAdministrar` pela sessão e repassar até a
> tabela. A recarga da lista após cancelar pode ser via `router.refresh()` (server component
> re-busca) — seguir o padrão de recarga já usado nas outras telas do módulo.

## Escopo

**Entra (v1):**
- Migração `0087` (`sf_registros_cancelados` + `sf_cancelar_lancamento` + RLS).
- `cancelavelInfo` + `cancelarLancamento` (+ infra).
- Botão Cancelar no detalhe da tela de Registros (gestor-only, checado, motivo obrigatório).

**Fora de escopo (v1):**
- Cancelar em Embalagem / NQA-caixa (efeito colateral em `sf_caixas`/`sf_nqa_caixa`).
- Integração (tem cancelar próprio).
- Mostrar o bipe cancelado na Pesquisa marcado como "cancelado" (a auditoria existe, mas não é
  exibida nas telas operacionais).
- Desfazer um cancelamento.
- Cancelar em lote (vários de uma vez).

## Arquivos (previsão)

- **Migração** `supabase/migrations/0087_sf_registros_cancelados.sql` (tabela + RPC + RLS).
- **Infra** `src/modules/shopfloor/infra/cancelamento-repository.ts`.
- **Application** `src/modules/shopfloor/application/cancelamento-actions.ts` (`cancelavelInfo`,
  `cancelarLancamento`).
- **UI** `src/app/(app)/shopfloor/registros/registros-tabela.tsx` (botão + diálogo) e
  `.../registros/page.tsx` (resolver/repassar `podeAdministrar`). Possível componente novo
  `cancelar-dialog.tsx`.
- **Domínio** (se útil) `src/modules/shopfloor/domain/cancelamento.ts` — helper puro do escopo de
  posto cancelável (`postoCancelavel(recurso): boolean`) + teste de unidade.

## Migração e compatibilidade

- `0087` é aditiva. Numeração escolhida **acima de tudo em voo** (o maior em qualquer branch é 0086,
  do coletivo) pra não colidir no merge. main hoje vai até 0081.
- Sem `sf_registros_cancelados`/sem a RPC → a tela simplesmente não mostra/usa o botão (nada quebra).

## Como saber que deu certo

- **Feliz:** gestor abre Registros, seleciona o **último** bipe de um SN num posto simples, clica
  Cancelar, informa o motivo, confirma → o bipe some da lista, vai pra `sf_registros_cancelados` com
  motivo/quem/quando, e no **Fluxo/Pesquisa** a peça "voltou um posto".
- **LIFO:** selecionar um bipe que **não** é o último do SN → botão desabilitado com o motivo; se
  forçar (chamar a action), volta `NAO_E_ULTIMO`.
- **Escopo:** selecionar um bipe de **Embalagem/NQA-caixa** → botão desabilitado ("posto não
  cancelável"); Integração idem.
- **Permissão:** operador (sem `administrar`) **não vê** o botão; chamada direta à RPC volta
  `SEM_PERMISSAO`.
- **Motivo:** confirmar sem motivo é impossível (botão travado) e a RPC recusa `MOTIVO_OBRIGATORIO`.
- `npm run lint` + `tsc` + testes verdes (helper de escopo coberto por unidade; o resto por smoke).
