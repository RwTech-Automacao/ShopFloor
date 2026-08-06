# OP única global (nunca criar OP repetida) — Design

> **Data:** 2026-08-06 · **Módulo:** ShopFloor (Cadastro de OP) · **Branch:** `feat/shopfloor-op-unica-global`
> **Tipo:** regra de negócio na server action (sem migração).

## Contexto
Hoje `sf_ordens` tem `unique (pmo, op)` — não dá pra repetir o par PMO+OP (a action já devolve
mensagem amigável no erro 23505). O usuário quer uma regra **mais restrita**: o **número da OP é único
global** — não pode existir o mesmo número de OP em **nenhum outro PMO**.

Já existem **3 números repetidos entre PMOs** na base (8019 PMOC64/65, 8248 PMOG01/02, 0000 PMOF32/57 —
em parte lixo de teste). Por isso a regra é aplicada **só no app, daqui pra frente** (decisão do usuário):
não adiciona constraint no banco, não limpa os duplicados históricos.

## Design
- **Infra** (`ordem-repository.ts`): `buscarOpEmUso(op, excetoId?)` → consulta `sf_ordens where op = <op>`
  (e `id != excetoId` na edição), `limit 1`. Devolve `{ id, pmo, op }` da OP que já usa o número, ou `null`.
- **Domínio puro** (`domain/op-unica.ts`): `mensagemOpDuplicada({ pmo, op })` → texto de bloqueio nomeando
  o PMO conflitante. (Pura → testável.)
- **`criarOrdemAction`**: depois de `validarOrdem`, antes de gravar — se `buscarOpEmUso(op)` achar algo,
  retorna `{ ok: false, erro: mensagemOpDuplicada(...) }`.
- **`editarOrdemAction`**: mesma checagem com `buscarOpEmUso(op, id)` (exclui a própria OP) — editar
  outros campos não trava; só trava se o número colidir com **outra** OP.

## Mensagem
`Já existe a OP {op} no PMO {pmo}. O número da OP deve ser único (não pode repetir em outro PMO).`

## Critérios de sucesso
- Criar OP com número já usado em qualquer PMO → bloqueado com a mensagem nomeando o PMO.
- Criar/editar OP com número novo → funciona normal.
- Editar uma OP existente (mesmo número) sem colidir com outra → funciona.
- `unique(pmo, op)` do banco intacta (backstop pro mesmo PMO). Sem migração. build+lint+test verdes.

## Fora de escopo
- Constraint `unique(op)` no banco + limpeza dos 3 duplicados históricos (fica pra um momento separado).
- Pré-checagem no cliente (o form já mostra o `erro` no submit).
