# Receita de Integração (BOM por PMO) — Design

> Restringe **quais PMOs de placa** podem compor um produto na Integração.
> Módulo ShopFloor Processo. Data: 2026-07-23.

## Contexto e objetivo

Hoje a tela de Integração aceita **qualquer** PMO/OP ativa como placa de um produto. A Enterplak
quer amarrar a "receita" do produto: um Produto Acabado (PA, ex. `PMO1`) é composto por Produtos
Intermediários (PI, ex. `PMO21` + `PMO22`). Só essas PMOs devem poder ser adicionadas como placas
daquele produto.

Nomenclatura do usuário: **PA** = PMO do produto final; **PI** = PMO de componente/placa. Um PA é
formado por N PIs.

## Decisões travadas (brainstorm 2026-07-23)

1. **Onde mora a receita:** na **OP** (tabela própria, espelhando `sf_ordem_postos`). Reaproveitada
   entre OPs do mesmo PMO pelo **"Puxar fluxo de OP…"** que já existe (traz a receita junto,
   editável). **Sem** tela/cadastro/permissão nova de "Produto/PMO".
2. **OP sem receita:** aceita **qualquer** PMO (comportamento atual). A restrição só liga quando a
   receita é preenchida → adoção gradual, não quebra OPs atuais nem o histórico (2.692 integrações).
3. **Rigor:** **whitelist de PMOs apenas** — sem quantidade por PMO e sem exigir lista completa.
   Pode integrar com um subconjunto; pode repetir a mesma PMO.
4. **Entrada das PMOs:** dropdown restrito às **PMOs que já têm OP** no sistema (menos a própria PMO
   da OP). *Limitação aceita:* não dá pra pôr na receita uma PMO sem OP cadastrada.
5. **Visibilidade:** na Integração, PMO fora da receita **não aparece** no dropdown da placa. O
   bloqueio no servidor é só rede de segurança (chamada forjada/corrida).

## Arquitetura

### Dado novo — `sf_ordem_componentes`
```sql
create table public.sf_ordem_componentes (
  ordem_id       uuid not null references public.sf_ordens(id) on delete cascade,
  pmo_componente text not null,
  primary key (ordem_id, pmo_componente)
);
-- RLS igual a sf_ordem_postos: select = visualizar; all = administrar.
```
Receita **efetiva daquela OP**. Conjunto vazio = sem restrição. `on delete cascade` acompanha a OP.

### Domínio puro (TDD) — `receitaPermite`
```ts
// src/modules/shopfloor/domain/receita.ts
/** Receita vazia libera tudo; senão a PMO da placa precisa estar na receita (case-insensitive). */
export function receitaPermite(receita: string[], placaPmo: string): boolean
```
Usada no cliente (filtrar dropdown) e espelhada na regra SQL (autoritativa).

### Cadastro de OP — `ordem-form.tsx` + `ordens-actions.ts`
- Nova seção **"Receita da Integração · PMOs de componente"**, **visível só quando `fluxo` inclui
  'Integração'**.
- Dropdown restrito a `pmosExistentes` (distinct `sf_ordens.pmo`, exceto a PMO da OP) → chips
  removíveis. Estado `receita: string[]`, submetido como hidden input `componentes` (JSON).
- `FluxoExistente` ganha `componentes: string[]`; o handler do "Puxar fluxo de OP…" passa a fazer
  `setFluxo(fonte.postos)` **e** `setReceita(fonte.componentes)`.
- `criarOrdemAction`/`editarOrdemAction`: parseiam `componentes` e regravam
  `sf_ordem_componentes` (substituição do conjunto). Se 'Integração' **não** está no fluxo → grava
  receita vazia (limpa).
- A página que monta o form carrega `pmosExistentes` e inclui `componentes` em cada
  `FluxoExistente`.

### Tela de Integração — `integracao-form.tsx`
- Cada OP integrável (`ordensIntegraveis`) ganha `componentes: string[]`.
- Ao escolher a OP do produto: se `componentes` não-vazio, `pmosPlaca` = `componentes` (∩ PMOs
  existentes); senão = todas as PMOs (hoje). Aviso na UI: *"Este produto aceita apenas placas das
  PMOs: …"*.

### Servidor — `sf_integrar` (rede de segurança)
- Carrega a receita do produto: `select array_agg(pmo_componente) from sf_ordem_componentes where
  ordem_id = v_ordem_produto`.
- Se não-vazia e alguma placa tem `pmo` fora dela → retorna `{ok:false, erro:'PLACA_FORA_DA_RECEITA'}`.
- Receita vazia → sem checagem (comportamento atual). `create or replace` (assinatura **inalterada**
  — sem overload, sem `drop function`).
- Mensagem no cliente (`integracao-actions.ts` MENSAGENS): `PLACA_FORA_DA_RECEITA` → "Uma das placas
  é de uma PMO fora da receita deste produto."

## O que NÃO muda
Gate de Manutenção, faixa de SN, anti-duplicidade, cancelamento (admin), Dashboard, Pesquisa/Grade.
OPs/integrações sem receita: comportamento idêntico ao de hoje.

## Casos de borda
- OP sem 'Integração' no fluxo: seção de receita nem aparece; qualquer receita residual é limpa ao salvar.
- Receita com PMO que depois perde todas as OPs: ainda barra placas fora; a PMO some do dropdown de
  cadastro (baseado em PMOs existentes) mas o valor gravado persiste até reeditar. Aceito.
- "Puxar fluxo" de OP sem Integração/sem receita: traz receita vazia (sem efeito). Ok.
- Placa cuja PMO = PMO do produto: já barrada por regra existente (SN da placa não pode = produto);
  a receita não precisa tratar. A própria PMO da OP é excluída do dropdown de cadastro.

## Testes
- **Domínio (TDD):** `receitaPermite` — vazia libera; whitelist permite/barra; case-insensitive.
- **Smoke no Dev:** (a) OP com receita rejeita placa de PMO fora (`PLACA_FORA_DA_RECEITA`); (b) OP
  sem receita integra qualquer PMO; (c) "puxar fluxo" carrega a receita numa OP nova.

## Migração de dados
Nenhuma. Tabela nasce vazia; todas as OPs existentes seguem "sem receita". Migração `0034`.
