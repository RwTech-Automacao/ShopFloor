# Embalagem por caixa (auto-numeração + fechar caixa) — Design

> **Data:** 2026-08-03 · **Módulo:** ShopFloor (Processo) · **Branch:** `feat/shopfloor-embalagem-caixa`
> **Tipo:** reformulação do fluxo de Embalagem. **Tem migração + backend + painel próprio.** Dev × Prod.

## Contexto

Hoje, num posto de perfil **caixa** (Embalagem), o operador digita **Nº da Caixa** e **Qtd por caixa** a cada
lançamento; o `sf_lancar` conta as peças da caixa e barra quando enche ("caixa cheia"). Não há conceito de
"caixa fechada antes do limite", nem numeração automática, nem visão do que entrou.

O novo fluxo (aprovado): número da caixa **automático**, limite **digitado uma vez**, botão **Fechar caixa**
(avança sozinho pra próxima), marcação **☐ Última caixa** (fecha sem avançar), **confirmação** ao fechar antes
do limite, **quadro** dos últimos SNs, e **contagem** (X/limite nesta · total embaladas · X/total da OP).

**Código da caixa:** `CX[seq][qtd]OP-PMO` com **colchetes literais** → ex.: `CX[3][10]12345-PMO973`
(caixa 3, 10 peças, OP 12345, PMO973). A `qtd` é a **real** (finalizada ao fechar).

## Objetivo

Substituir os campos manuais de caixa por um **painel de Embalagem** (à la Integração) com caixa auto-numerada,
limite único, fechar/última, contagem e quadro dos últimos SNs. Persistir o estado da caixa (aberta/fechada) para
sobreviver a recarga da página.

## Escopo

**Dentro:** tabela `sf_caixas` (estado da caixa) + RPC `sf_fechar_caixa`; geração do código (domínio); actions de
carregar/embalar/fechar; `EmbalagemPanel` no Lançamento (perfil caixa); `qtd` da OP exposto no Lançamento.
**Fora:** etiqueta/impressão da caixa (onda futura); reabrir caixa fechada; mover peça entre caixas.

## Design

### 1. Migração — `supabase/migrations/0070_sf_caixas.sql`
```sql
create table public.sf_caixas (
  id         uuid primary key default gen_random_uuid(),
  pmo        text not null,
  op         text not null,
  posto      text not null,
  seq        int  not null,             -- 1,2,3...
  limite     int  not null,             -- qtd por caixa (digitada uma vez)
  qtd        int  not null default 0,   -- peças na caixa (final, gravado ao fechar)
  codigo     text not null default '',  -- CX[seq][qtd]OP-PMO, gerado ao fechar
  fechada    boolean not null default false,
  ultima     boolean not null default false,
  created_at timestamptz not null default now(),
  fechada_em timestamptz,
  unique (pmo, op, posto, seq)
);
alter table public.sf_caixas enable row level security;
create policy sf_caixas_select on public.sf_caixas for select using (tem_permissao('visualizar'));
create policy sf_caixas_admin  on public.sf_caixas for all using (tem_permissao('lancar')) with check (tem_permissao('lancar'));
```
E o RPC atômico **`sf_fechar_caixa`** (security definer): recebe `p_pmo,p_op,p_posto,p_seq,p_ultima`; conta as
peças da caixa (`sf_registros where pmo/op/posto and numero_caixa = 'CX[' || p_seq || ']'`); grava na `sf_caixas`
`qtd`, `codigo = 'CX[' || seq || '][' || qtd || ']' || op || '-' || pmo`, `fechada=true`, `ultima=p_ultima`,
`fechada_em=now()`; **atualiza** os `sf_registros` dessa caixa `set numero_caixa = codigo`. Retorna `{ok, codigo}`.
(Barra se a caixa não existir/estiver vazia.)

### 2. Domínio — `src/modules/shopfloor/domain/caixa.ts` (+ testes)
```ts
/** Código da caixa: CX[seq][qtd]OP-PMO (colchetes literais). Ex.: CX[3][10]12345-PMO973. */
export function gerarCodigoCaixa(seq: number, qtd: number, op: string, pmo: string): string {
  return `CX[${seq}][${qtd}]${op}-${pmo}`
}
/** Marcador da caixa ABERTA nos registros (antes de fechar): CX[seq]. */
export function marcadorCaixaAberta(seq: number): string {
  return `CX[${seq}]`
}
```
Testes: `gerarCodigoCaixa(3,10,'12345','PMO973') === 'CX[3][10]12345-PMO973'`; `marcadorCaixaAberta(3) === 'CX[3]'`.

### 3. Infra + actions — `embalagem`
- **`OrdemLancamentoLista` += `qtd: number | null`** (do `sf_ordens.qtd`) — pro "X/total da OP". Ajustar select/map.
- **`carregarEmbalagem(pmo, op, posto)`** → estado atual: `seq` da caixa aberta (ou próxima), `limite` (herda da
  última caixa), `qtdNaCaixa` (count dos registros da caixa aberta), `totalEmbaladas` (count de todos os registros
  de embalagem dessa OP+posto), `ultimasSns` (últimos N SNs da caixa aberta), `concluida` (última caixa fechada com
  `ultima=true`). Deriva de `sf_caixas` + `sf_registros`.
- **Embalar a peça:** reusa o `lancar` existente (perfil caixa) com `numeroCaixa = marcadorCaixaAberta(seq)` e
  `qtdPorCaixa = limite` — o `sf_lancar` já barra "caixa cheia" por count. Antes do 1º lançamento da caixa,
  criar a linha em `sf_caixas` (seq, limite) se não existir (via uma action `abrirCaixa` ou dentro do fluxo).
- **`fecharCaixa(pmo, op, posto, seq, ultima)`** → chama `sf_fechar_caixa`; retorna o código final.

### 4. Frontend — `EmbalagemPanel` (novo, em `operar/lancamento/embalagem-panel.tsx`)
- Renderizado quando `ehEmbalagem` (`recurso === 'caixa'`), **no lugar** do card "Peça" (igual ao IntegracaoPanel).
- Remove os campos "Nº da Caixa"/"Qtd por caixa" do Contexto.
- **Início:** se não há limite definido, pede o **Limite por caixa** (input, uma vez). Com limite, mostra o painel.
- **Cabeçalho do painel:** `Caixa CX{seq}` · `Limite: {limite}` · `☐ Última caixa` · botão **Fechar caixa**.
- **Contador:** barra + `{qtdNaCaixa}/{limite} nesta caixa` · `Total embaladas: {totalEmbaladas}` · `{totalEmbaladas}/{qtdOP} do contrato` (se `qtdOP`).
- **Campo SN** (menor) + **quadro** "Últimas nesta caixa" (SNs mais recentes no topo).
- **Bipar peça:** Enter → `lancar` na caixa aberta; sucesso → incrementa contador, adiciona ao quadro, refoca; se
  "caixa cheia" → avisa (o operador fecha e segue).
- **Fechar caixa:** se `qtdNaCaixa < limite` → **confirma** ("Fechar com {qtd}/{limite}?"). Confirma → `fecharCaixa`;
  se `☐ Última` marcada → mostra "Embalagem concluída" e **não** abre próxima; senão prepara **CX{seq+1}** (mesmo limite).
- Foco no SN após cada ação; recarga da página recupera o estado via `carregarEmbalagem`.

## Critérios de sucesso
- Caixa auto-numerada; limite digitado uma vez vale pras seguintes.
- "7/10", total embaladas e "X/total da OP" corretos; quadro mostra os últimos SNs.
- Fechar caixa gera `CX[seq][qtd]OP-PMO` com a qtd real e avança; **última** fecha sem avançar; fechar antes do limite pede confirmação.
- Recarregar a página mantém o estado (caixa atual/aberta, contadores).
- Build/lint/test verdes; migração `0070` só no Dev.

## Riscos / considerações
- **Estado da caixa** persiste em `sf_caixas` (não dá pra derivar "fechada antes do limite" só de `sf_registros`).
- **Atualização dos registros ao fechar** (numero_caixa provisório `CX[seq]` → código final) é feita no RPC, atômica.
- **Reuso do `sf_lancar`** pro insert da peça evita reescrever o lançamento; só a caixa é auto-gerenciada.
- **Concorrência:** assume 1 operador por posto de Embalagem (sem lock multi-usuário). Aceitável no chão de fábrica.
- Smoke: encher caixa até o limite (avança), fechar antes do limite (confirma), marcar última (conclui), recarregar
  no meio (mantém), conferir código final e contadores; conferir que a grade/registros mostram o código final.
