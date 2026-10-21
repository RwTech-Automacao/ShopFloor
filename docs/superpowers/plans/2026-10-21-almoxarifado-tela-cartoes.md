# Tela do Almoxarifado em cartões de pendência: plano de implementação

> **Para quem executa:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com `- [ ]`.

**Meta:** trocar a tela Recebimento → Almoxarifado (hoje o `LancamentoForm` em "modo Almoxarifado") por uma tela própria: lista de cartões de pendência (caixa ou lote) com filtro por OP; escolher o cartão, conferir os detalhes e bipar.
**Spec aprovada:** `docs/superpowers/specs/2026-10-21-almoxarifado-tela-redesenho-design.md` (branch `feat/almoxarifado-necessidade`, worktree `ShopFloor-necessidade`).
**Arquitetura:** a regra de negócio não muda (migrações 0155/0156). A lista já existe (`sf_almox_pendencias`, 0158), ganha só a hora de cada item; uma função nova (0159) traz os detalhes do cartão aberto; a tela é um componente cliente novo que reaproveita as actions de bipe e o `PainelResultado`.
**Pilha:** Postgres 15 (plpgsql), Supabase, Next.js 16 (**ler `AGENTS.md` do worktree** antes de mexer em rota/página), React 19, TypeScript, Vitest + Testing Library, Tailwind v4.

## Restrições globais (valem para todas as tarefas)

- PT-BR na interface e nos comentários. `tem_permissao` **sempre com 2 argumentos**. O posto é decidido pelo **perfil** (`sf_posto_perfis.recurso = 'almoxarifado'`), **nunca pelo nome**.
- Migração **aditiva e idempotente**, corpo com `$func$` (o SQL Editor não aceita dois cifrões), `notify pgrst, 'reload schema'`, `revoke ... from public, anon` + `grant ... to authenticated`. **Sem `concurrently`.**
- **A regra do Almoxarifado não muda:** as recusas, o posto anterior, a amostra K e o envio `tipo='lote'` são os das migrações 0155/0156. Nenhuma dessas funções é alterada.
- Rota e permissões inalteradas: `/recebimento/almoxarifado`, `recebimento.lancar` + `shopfloor.visualizar`; posto fixo = o único posto de perfil `almoxarifado`; colaborador = usuário logado.
- Falha de leitura é **estado de erro próprio**, nunca lista vazia.
- Não mexer em `almoxarifado-panel.tsx`, nem remover o `modoAlmoxarifado` do `LancamentoForm` nesta entrega (só deixa de ser usado por esta rota).
- Commits pequenos, PT-BR, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **Não fazer push, não trocar de branch.** Nada contra produção. O banco local do Supabase (docker `supabase_db_shopfloor-filtros-local`, porta 54322) só na Tarefa 5, e só para aplicar 0158 e 0159.
- Testes SQL: **só** o Postgres descartável em Docker dos scripts `supabase/tests/rodar-*.sh`.

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `supabase/migrations/0158_sf_almox_pendencias.sql` | alterar (ainda não está em produção): acrescentar a coluna `em` (hora do fechamento/aprovação) e `drop function if exists` antes do `create` |
| `supabase/migrations/0159_sf_almox_detalhe.sql` | criar: `sf_almox_detalhe(p_pmo, p_op, p_codigo, p_lote_id)` |
| `supabase/tests/almoxarifado_pendencias_test.sql` + `rodar-almoxarifado-test.sh` | criar/acrescentar: casos da 0158 e da 0159 |
| `src/modules/shopfloor/domain/almoxarifado.ts` | alterar: `PendenciaAlmoxarifado` ganha `loteId` e `em`; tipo `DetalheAlmoxarifado`; funções puras `opsComPendencia`, `filtrarPorOp`, `horaCurta`, `fraseDeCaixaErrada` |
| `src/modules/shopfloor/application/almoxarifado-actions.ts` | alterar: `listarPendenciasAlmoxarifado` devolve os campos novos; criar `detalharPendenciaAlmoxarifado` |
| `src/app/(app)/recebimento/almoxarifado/almoxarifado-tela.tsx` | criar: orquestra lista ↔ cartão aberto ↔ resultado |
| `.../lista-cartoes.tsx`, `.../caixa-aberta.tsx`, `.../lote-aberto.tsx` | criar: as três telas |
| `src/app/(app)/recebimento/almoxarifado/page.tsx` | alterar: renderiza `AlmoxarifadoTela` em vez do `LancamentoForm` |
| `src/app/(app)/shopfloor/operar/lancamento/pendencias-almoxarifado.tsx` (+ teste) e o uso dele em `lancamento-form.tsx` | remover (a lista passa a ser a tela nova) |
| testes ao lado de cada arquivo novo | criar |

---

## Tarefa 1: SQL (a hora na 0158 e a função de detalhe 0159)

**Contexto a ler antes (inteiro):** `supabase/migrations/0158_sf_almox_pendencias.sql`, `0155_sf_almox_posto_anterior.sql` (`sf_almox_posto_anterior`, `sf_almox_necessidades`), `0156_sf_almox_lote.sql` (`sf_almox_lotes`), `supabase/tests/rodar-almoxarifado-test.sh`, `almoxarifado_lote_test.sql` (como a massa dos lotes nasce pela `sf_nqa_individual`) e `almoxarifado_necessidade_test.sql` (como a massa de caixa nasce).

**Interfaces que esta tarefa produz (a Tarefa 2 depende dos nomes exatos):**
- `sf_almox_pendencias()` devolve: `pmo text, op text, tipo text, codigo text, seq int, pecas int, lote_id uuid, amostra int, ja_lancadas int, em timestamptz`. `em` = `fechada_em` da caixa (tipo `caixa`) ou `aprovado_em` do lote (tipo `lote`).
- `sf_almox_detalhe(p_pmo text, p_op text, p_codigo text, p_lote_id uuid default null) returns jsonb`:
  - sempre: `{ok:true, qtd_op:int|null, recebidas_op:int, posto_anterior: {posto, recurso, precisa_aprovado} | null}`;
  - caixa (`ok:true, tipo:'caixa'`): `codigo, pecas:int, sns:text[], fechada_em, fechada_por:text|null`;
  - lote (`ok:true, tipo:'lote'`): `rotulo, pecas:int, amostra:int|null, sns:text[], aprovado_em, ja_lancadas:int`;
  - falhas como dado: `{ok:false, motivo:'op_inexistente'|'sem_almoxarifado'|'item_inexistente'}`; sem permissão = **erro** `SEM_PERMISSAO`.

- [ ] **1.1 Testes primeiro** em `supabase/tests/almoxarifado_pendencias_test.sql` (arquivo novo; monte a PRÓPRIA massa numa OP nova, sem depender do estado que os outros testes deixam), vermelhos:
  1. `sf_almox_pendencias()` devolve a caixa fechada concluída com `em` igual ao `fechada_em` dela; devolve o lote aprovado com `em` igual ao `aprovado_em` (`max(data_hora)` do lote); OP finalizada não aparece; OP sem Almoxarifado na rota não aparece; sem permissão → erro `SEM_PERMISSAO`.
  2. `sf_almox_detalhe` de **caixa**: `sns` ordenados e distintos; `fechada_em` certo; `fechada_por` = `colaborador` do **último** registro da Embalagem daquela caixa; `qtd_op` = `sf_ordens.qtd`; `recebidas_op` = SNs distintos já no posto Almoxarifado da OP (0 antes de dar entrada, N depois); `posto_anterior` com o posto, o recurso e `precisa_aprovado`.
  3. `sf_almox_detalhe` de **lote**: `sns`, `amostra` (K da `sf_almox_lote_amostra`), `aprovado_em`, `ja_lancadas`.
  4. Falhas: OP inexistente → `motivo = 'op_inexistente'`; OP sem Almoxarifado → `'sem_almoxarifado'`; código de caixa inexistente (ou caixa aberta) e lote inexistente → `'item_inexistente'`; sem permissão → erro.
  Como o teste simula a sessão: copie exatamente o jeito dos outros testes do harness (stub de `tem_permissao`/`auth.uid`).
- [ ] **1.2** Acrescentar o arquivo ao `rodar-almoxarifado-test.sh` (depois do `almoxarifado_lote_test.sql`, e as migrações 0158 e 0159 na lista de `docker cp`, aplicadas depois da 0156; **e de novo** no bloco de idempotência, duas vezes cada). Rodar e **ver falhar** pelo motivo certo (função inexistente).
- [ ] **1.3** Alterar `0158_sf_almox_pendencias.sql`: `drop function if exists public.sf_almox_pendencias();` antes do `create or replace` (o tipo de retorno muda); acrescentar `em timestamptz` ao `returns table` e preenchê-lo: caixa → `n.fechada_em` (a `sf_almox_necessidades` já devolve `fechada_em`), lote → `l.aprovado_em`. Atualizar o cabeçalho da migração dizendo isso.
- [ ] **1.4** Criar `0159_sf_almox_detalhe.sql`. Esqueleto (complete o que falta lendo as funções vizinhas; o posto do Almoxarifado da rota é escolhido **exatamente** como na `sf_almox_necessidades`):

```sql
create or replace function public.sf_almox_detalhe(
  p_pmo text, p_op text, p_codigo text, p_lote_id uuid default null
) returns jsonb
language plpgsql stable
security definer
set search_path = public
as $func$
declare
  v_ordem record; v_almox text; v_prev record; v_recebidas int; v_base jsonb;
  v_cx record; v_sns text[]; v_por text; v_lote record;
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;
  select o.id, o.qtd, coalesce(o.embalagem_individual, false) as individual into v_ordem
    from sf_ordens o where o.pmo = p_pmo and o.op = p_op;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'op_inexistente'); end if;
  -- mesmo select do posto Almoxarifado da rota que a sf_almox_necessidades usa
  select opp.posto into v_almox
    from sf_ordem_postos opp
    join sf_postos po       on po.chave = opp.posto
    join sf_posto_perfis pe on pe.chave = po.perfil
   where opp.ordem_id = v_ordem.id and pe.recurso = 'almoxarifado'
   order by opp.ordem, opp.posto limit 1;
  if v_almox is null then return jsonb_build_object('ok', false, 'motivo', 'sem_almoxarifado'); end if;
  select * into v_prev from sf_almox_posto_anterior(v_ordem.id, v_almox);
  select count(distinct a.numero_serie_norm)::int into v_recebidas
    from sf_registros a
   where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> '';
  v_base := jsonb_build_object('ok', true, 'qtd_op', v_ordem.qtd, 'recebidas_op', v_recebidas,
    'posto_anterior', case when v_prev.posto is null then null
       else jsonb_build_object('posto', v_prev.posto, 'recurso', v_prev.recurso,
                               'precisa_aprovado', v_prev.precisa_aprovado) end);
  if v_ordem.individual then
    select l.* into v_lote from sf_almox_lotes(p_pmo, p_op) l where l.lote_id = p_lote_id;
    if not found then return jsonb_build_object('ok', false, 'motivo', 'item_inexistente'); end if;
    return v_base || jsonb_build_object('tipo', 'lote', 'rotulo', v_lote.rotulo, 'pecas', v_lote.pecas,
      'amostra', v_lote.amostra, 'sns', to_jsonb(v_lote.sns), 'aprovado_em', v_lote.aprovado_em,
      'ja_lancadas', v_lote.ja_lancadas);
  end if;
  select cx.posto, cx.fechada_em into v_cx
    from sf_caixas cx
   where cx.pmo = p_pmo and cx.op = p_op and cx.codigo = p_codigo and cx.fechada and cx.revisao = 0
   order by cx.posto, cx.seq limit 1;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'item_inexistente'); end if;
  select array_agg(distinct r.numero_serie_norm order by r.numero_serie_norm) into v_sns
    from sf_registros r
   where r.pmo = p_pmo and r.op = p_op and r.posto = v_cx.posto
     and r.numero_caixa = p_codigo and r.numero_serie_norm <> '';
  select r.colaborador into v_por
    from sf_registros r
   where r.pmo = p_pmo and r.op = p_op and r.posto = v_cx.posto and r.numero_caixa = p_codigo
   order by r.data_hora desc, r.created_at desc limit 1;
  return v_base || jsonb_build_object('tipo', 'caixa', 'codigo', p_codigo,
    'pecas', coalesce(cardinality(v_sns), 0), 'sns', to_jsonb(coalesce(v_sns, '{}'::text[])),
    'fechada_em', v_cx.fechada_em, 'fechada_por', nullif(btrim(v_por), ''));
end $func$;
revoke all on function public.sf_almox_detalhe(text, text, text, uuid) from public, anon;
grant execute on function public.sf_almox_detalhe(text, text, text, uuid) to authenticated;
notify pgrst, 'reload schema';
```
  Cabeçalho no estilo da 0158 (o quê, por quê, regra). **Atenção:** variáveis plpgsql com o mesmo nome de coluna (`posto`, `pecas`...) quebram o `select`; mantenha os prefixos `v_`/`p_` e qualifique as colunas.
- [ ] **1.5** Rodar `bash supabase/tests/rodar-almoxarifado-test.sh` **inteiro** (os testes antigos, os novos, a idempotência) e `rodar-estoque-envios-test.sh` e `rodar-estoque-enviado-test.sh`: **todos verdes**. Anotar a saída.
- [ ] **1.6** Commit: `feat(almoxarifado): hora na lista de pendências e sf_almox_detalhe (0158, 0159)`.

---

## Tarefa 2: domínio e actions

**Arquivos:** `src/modules/shopfloor/domain/almoxarifado.ts`, `src/modules/shopfloor/application/almoxarifado-actions.ts`; testes em `src/modules/shopfloor/domain/__tests__/almoxarifado-cartoes.test.ts` e `src/modules/shopfloor/application/__tests__/almoxarifado-detalhe-actions.test.ts` (siga o molde de mock de `getSessao` e `createServerSupabase` dos testes de actions já existentes ao lado, por exemplo os de `listarPendenciasAlmoxarifado`/`listarLotesAlmoxarifado`).

**Interfaces que esta tarefa produz (as componentes da Tarefa 3 dependem dos nomes exatos):**

```ts
// domain/almoxarifado.ts
export interface PendenciaAlmoxarifado {            // (já existe; ganha loteId e em)
  pmo: string; op: string; tipo: 'caixa' | 'lote'; codigo: string; pecas: number
  amostra: number | null; loteId: string | null; em: string | null
}
export interface DetalheAlmoxarifado {
  tipo: 'caixa' | 'lote'
  qtdOp: number | null; recebidasOp: number
  postoAnterior: { posto: string; recurso: string; precisaAprovado: boolean } | null
  pecas: number; sns: string[]
  em: string | null            // fechada_em (caixa) ou aprovado_em (lote)
  fechadaPor: string | null    // só caixa
  amostra: number | null       // só lote
  jaLancadas: number           // só lote
}
export interface OpComPendencia { chave: string; pmo: string; op: string }   // chave = `${op} · ${pmo}`
export function chaveDaOp(p: { pmo: string; op: string }): string
export function opsComPendencia(itens: PendenciaAlmoxarifado[]): OpComPendencia[]   // únicas, ordenadas por op (numérica quando possível) e depois pmo
export function filtrarPorOp(itens: PendenciaAlmoxarifado[], chave: string | null): PendenciaAlmoxarifado[]  // null = todas
export function horaCurta(iso: string | null): string      // 'HH:MM' em America/Sao_Paulo; '' se nulo/ inválido
export function codigoConfere(bipado: string, codigoDaCaixa: string): boolean   // trim + maiúsculas
export const FRASE_CAIXA_ERRADA = 'Este não é o código desta caixa. Confira a caixa na mão.'

// application/almoxarifado-actions.ts
export async function detalharPendenciaAlmoxarifado(p: { pmo: string; op: string; tipo: 'caixa' | 'lote'; codigo: string; loteId: string | null }):
  Promise<{ ok: true; detalhe: DetalheAlmoxarifado } | { ok: false; erro: string }>
```

- [ ] **2.1 Testes primeiro (vermelhos).**
  - Domínio: `opsComPendencia` agrupa duas pendências da mesma OP numa entrada e ordena `9901` antes de `9950` e `10001` depois (ordem numérica); `filtrarPorOp(itens, null)` devolve tudo, com chave devolve só a OP; `horaCurta('2026-10-21T13:42:00Z')` = `'10:42'` (UTC−3) e `horaCurta(null)` = `''`; `codigoConfere(' cx[2][2]9901-pmot02 ', 'CX[2][2]9901-PMOT02')` é true e códigos diferentes dão false.
  - Actions: `listarPendenciasAlmoxarifado` passa a devolver `loteId` (de `lote_id`) e `em` (de `em`); `detalharPendenciaAlmoxarifado`: sem sessão ou sem `recebimento.lancar`/`shopfloor.visualizar` → `{ok:false, erro:'Você não tem permissão para esta ação.'}`; chama `supabase.rpc('sf_almox_detalhe', { p_pmo, p_op, p_codigo, p_lote_id })` e converte o jsonb (snake→camel) nos dois formatos; `ok:false` do banco vira frase em PT-BR (`op_inexistente`→"OP não encontrada.", `sem_almoxarifado`→"Esta OP não passa pelo Almoxarifado.", `item_inexistente`→"Esta caixa ou lote não está mais esperando confirmação. Atualize a lista."); erro de RPC → "Não foi possível carregar os detalhes."; resposta que não é objeto → o mesmo erro (nunca devolver detalhe vazio).
- [ ] **2.2** Rodar e ver falhar. **2.3** Implementar o mínimo (siga o estilo de `listarLotesAlmoxarifado`). **2.4** `npx vitest run --maxWorkers=2 src/modules/shopfloor` e `npx tsc --noEmit` verdes. **2.5** Commit: `feat(almoxarifado): domínio e actions dos cartões de pendência`.

---

## Tarefa 3: a tela (cartões, caixa aberta, lote aberto)

**Arquivos (todos novos, em `src/app/(app)/recebimento/almoxarifado/`):** `almoxarifado-tela.tsx`, `lista-cartoes.tsx`, `caixa-aberta.tsx`, `lote-aberto.tsx`, e `__tests__/` com um teste por componente. **Ler antes:** `src/app/(app)/shopfloor/operar/lancamento/almoxarifado-panel.tsx` (como o bipe, a trava `enviandoRef`, o foco e o `PainelResultado` são usados), `src/components/ui/painel-resultado.tsx` (`ResultadoAcao`), `pendencias-almoxarifado.tsx` (a lista de hoje) e os componentes `Card`, `Button`, `Input` de `@/components/ui`.

**Interfaces:**
- Consome: Tarefa 2 (`PendenciaAlmoxarifado`, `DetalheAlmoxarifado`, `opsComPendencia`, `filtrarPorOp`, `horaCurta`, `codigoConfere`, `FRASE_CAIXA_ERRADA`, `listarPendenciasAlmoxarifado`, `detalharPendenciaAlmoxarifado`), e já existentes: `registrarEntradaAlmoxarifado(entrada: {pmo, op, posto, colaborador, bipe})`, `confirmarLoteAlmoxarifado(c: {pmo, op, posto, colaborador, loteId, amostra})`, `conferirBipeAmostra(lote, bipados, bipe)` e `amostraCompleta(lote, bipados)` (ambos recebem um `NecessidadeLote`: monte um a partir do detalhe: `{loteId, rotulo, pecas, amostra, sns, jaLancadas, aprovadoEm}`), `PainelResultado`, `ResultadoAcao`.
- Produz: `export function AlmoxarifadoTela(props: { colaborador: string; posto: string })`.

Comportamento (da spec; use exatamente estes textos):
- **`AlmoxarifadoTela`:** estado `itens` (carregando | erro | ok), `selecionado` (`PendenciaAlmoxarifado | null`) e `resultado` (`ResultadoAcao | null`). Carrega a lista ao montar e no Atualizar. Sem `selecionado`: mostra `PainelResultado` (o resultado da última ação, que fica até a próxima) e a `ListaCartoes`. Com `selecionado`: mostra a `CaixaAberta` ou o `LoteAberto`. Ao confirmar com sucesso: `setResultado({tipo:'ok', titulo: '<N> peça(s)', chips:[{rotulo:'Caixa'|'Lote', valor: código, mono:true}]})`, `selecionado = null` e recarrega a lista. Recusa do banco: `setResultado({tipo:'aviso', titulo: erro})` e o cartão **permanece aberto**. O cartão que o banco diz que não está mais pendente ("Esta caixa ou lote não está mais esperando confirmação…") volta para a lista atualizada.
- **`ListaCartoes`:** título "Esperando confirmação (N)"; `<select>` de OP com "Todas as OPs" + `opsComPendencia(itens)`; botão "Atualizar"; grade de cartões (flex wrap). Cartão de caixa: etiqueta "CAIXA · OP {op} · {pmo}", código em destaque (monoespaçado, `font-bold`), "N peças · fechada HH:MM" (omita a hora se vazia). Cartão de lote: etiqueta "LOTE · OP {op} · {pmo}", rótulo em destaque, "N peças · bipar K · aprovado HH:MM" (omita "bipar K" se `amostra` for nulo/≤0). O cartão é um `<button>` que chama `onEscolher(item)`. Vazio: "Nada esperando confirmação no Almoxarifado agora." (e, com filtro ativo, "Nada esperando confirmação nesta OP."). Erro: texto de aviso com a frase, **sem** o vazio.
- **`CaixaAberta`:** carrega o detalhe ao montar (estado carregando/erro/ok; erro com "Voltar à lista"). Mostra: linha pequena "OP {op} · {pmo} · coletiva · fechada {HH:MM}{ por {fechadaPor}}"; o **código da caixa em letra grande** (`text-3xl font-bold font-mono`); "Bipe este código para confirmar a entrada de N peças."; `Input` de bipe com foco automático; e, em letra menor: "Dentro da caixa: SN, SN…" (os `sns`), "Posto anterior: {posto} concluído" (ou "sem posto anterior"), "OP {op}: {recebidasOp} de {qtdOp} peças já no Almoxarifado" (omita o "de {qtdOp}" se `qtdOp` for nulo). Botão "‹ Voltar à lista". Enter com o campo vazio não faz nada; código que não confere (`!codigoConfere`) → `onResultado({tipo:'aviso', titulo: FRASE_CAIXA_ERRADA})`, **sem** chamar a action e sem limpar o campo; código que confere → `registrarEntradaAlmoxarifado({pmo, op, posto, colaborador, bipe})` com a mesma trava anti-duplo-Enter do painel antigo (`enviandoRef` síncrono + `enviando`). Divergência (`r.divergencia`) vai em `detalhe` do resultado, como no painel antigo.
- **`LoteAberto`:** carrega o detalhe; mostra "OP {op} · {pmo} · individual · aprovado {HH:MM}", "Lote {rotulo} · N peças", "Bipe K números de série quaisquer deste lote (amostra do NQA):", os `sns` como etiquetas (as bipadas com ✔ e destaque; se houver mais de 12, mostre as 12 primeiras (as bipadas sempre aparecem) e "… +N"), `Input` de bipe com foco, "Bipadas: X de K", botão "Confirmar lote" (desabilitado enquanto `!amostraCompleta`) e "‹ Voltar à lista". Bipe: `conferirBipeAmostra`; recusas com as frases do painel antigo ("A peça X não é deste lote.", "A peça X já está na amostra.", "A amostra já está completa: confirme o lote."). Confirmar → `confirmarLoteAlmoxarifado({... amostra: bipadas})`. Se `amostra` do detalhe for nulo/≤0: mostre "A Tabela NQA não tem amostra para este tamanho de lote." e **não** habilite o bipe nem o confirmar.

- [ ] **3.1 Testes primeiro (vermelhos), com `vi.hoisted` + `vi.mock('@/modules/shopfloor/application/almoxarifado-actions', ...)` como em `almoxarifado-panel.test.tsx`:**
  - `lista-cartoes`: renderiza cartões de caixa e lote com o texto da spec; o filtro por OP esconde as outras; clicar chama `onEscolher` com o item; vazio, vazio com filtro e erro (nunca vazio no erro).
  - `caixa-aberta`: mostra o código grande, os SNs, o posto anterior e "80 de 200 peças"; bipe errado → `onResultado` com `FRASE_CAIXA_ERRADA` e `registrarEntradaAlmoxarifado` **não** chamada; bipe certo (minúsculo/espaços) → chamada com `{pmo, op, posto, colaborador, bipe}`; sucesso → `onConfirmado`; recusa → `onResultado` aviso e cartão permanece; duplo Enter chama a action **uma vez**; detalhe com erro mostra a frase e o Voltar.
  - `lote-aberto`: progresso "0 de 3" → "2 de 3"; SN fora do lote e repetido recusados com as frases; Confirmar só habilita com 3; confirma com a amostra bipada; amostra nula bloqueia.
  - `almoxarifado-tela`: abre na lista; escolher um cartão abre a caixa/lote; confirmar volta à lista, recarrega e mostra o painel de resultado; recusa mantém o cartão.
- [ ] **3.2** Rodar e ver falhar (módulos inexistentes). **3.3** Implementar. **3.4** `npx vitest run --maxWorkers=2 "src/app/(app)/recebimento"` e `npx tsc --noEmit` verdes. **3.5** Commit: `feat(almoxarifado): tela de cartões de pendência (lista, caixa e lote abertos)`.

---

## Tarefa 4: ligar a rota e limpar o que ficou sem uso

**Arquivos:** `src/app/(app)/recebimento/almoxarifado/page.tsx`; remover `src/app/(app)/shopfloor/operar/lancamento/pendencias-almoxarifado.tsx` e `__tests__/pendencias-almoxarifado.test.tsx`; `lancamento-form.tsx` (tirar só o import e o uso do `PendenciasAlmoxarifado` e a função `escolherPendenciaAlmoxarifado`; **manter** `carregarOrdemNoCabecalho`, que é a extração do fim de `onBiparCabecalho`).

- [ ] **4.1** Em `page.tsx`: manter as checagens de permissão e a busca do posto Almoxarifado pelo **perfil** (`mapaPostoPerfil`, como hoje) e as mensagens "Não há posto com o perfil Almoxarifado…" / "Há N postos…". Remover `listarOrdensParaLancamento`, `mapaPostoColetivo`, `mapaPostoRotaDestino` e o `LancamentoForm`; renderizar `<AlmoxarifadoTela colaborador={sessao.nome} posto={posto} />`. Atualizar o comentário do arquivo (a tela agora é própria, em cartões; cite a spec).
- [ ] **4.2** Remover o componente antigo da lista e o uso dele; `grep -rn "PendenciasAlmoxarifado\|escolherPendenciaAlmoxarifado" src` não pode achar nada.
- [ ] **4.3** `npx tsc --noEmit` limpo e `npx vitest run --maxWorkers=2 "src/app/(app)/recebimento" "src/app/(app)/shopfloor/operar/lancamento"` verdes. Se algum teste existente da página do Almoxarifado ou do `lancamento-form` quebrar por causa da remoção, **é preciso entender por quê**: se o teste exercitava o `modoAlmoxarifado` do `LancamentoForm`, ele segue valendo (o modo continua existindo); só ajuste o que dependia da página. Relate cada ajuste.
- [ ] **4.4** Commit: `feat(almoxarifado): a rota usa a tela de cartões; remove a lista antiga`.

---

## Tarefa 5: verificação (por quem executa, antes de reportar)

- [ ] `npx tsc --noEmit` limpo; `npx vitest run --maxWorkers=2` **inteiro** verde (se algum teste de timeout falhar só sob carga, rode-o isolado e relate); os três runners SQL (`rodar-almoxarifado-test.sh`, `rodar-estoque-envios-test.sh`, `rodar-estoque-enviado-test.sh`) verdes; `NODE_OPTIONS="--max-old-space-size=4096" npx next build` sem erro (em worktree, o `node_modules` precisa estar acessível: veja a memória `worktree-next-build`, `cp -al`, não symlink; se o build não rodar por isso, relate em vez de pular).
- [ ] **Banco local para o usuário testar:** aplicar `0158` e `0159` no Postgres local do Supabase (`docker exec -i supabase_db_shopfloor-filtros-local psql -U postgres -v ON_ERROR_STOP=1 -q -1 < supabase/migrations/0158_sf_almox_pendencias.sql`, e o mesmo para a 0159; a 0158 tem `drop function` e deve rodar duas vezes sem erro). Só essas duas.
- [ ] Relatório: hashes, a lista de **tudo** que mudou em teste existente (idealmente nada), os casos novos cobertos, e qualquer ambiguidade resolvida.

## Fora do escopo

Atalho de bipe na lista; barra de andamento por OP; mudar a regra do Almoxarifado ou o Compels; remover o `modoAlmoxarifado` do `LancamentoForm`; as placas intermediárias; push e deploy.
