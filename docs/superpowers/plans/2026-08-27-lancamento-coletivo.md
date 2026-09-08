# Lançamento Coletivo — plano de implementação

> **Para quem executa:** SUB-SKILL: use superpowers:subagent-driven-development (recomendado) ou
> superpowers:executing-plans, tarefa a tarefa. Steps usam checkbox (`- [ ]`).

**Goal:** permitir, em postos marcados como coletivos, bipar vários SNs (máx 15), acumular numa lista
e enviar todos de uma vez (melhor esforço), mantendo a automação do bipe único.

**Architecture:** flag `sf_postos.coletivo` (por posto, só perfis passagem/spi/inspecao) → o
`lancamento-form` entra em "modo lote" quando o posto é coletivo: os commits que hoje chamam `lancar()`
passam a **empilhar** numa lista; um botão "Enviar" chama a action `lancarLote` que reusa `lancar()` por
item (best-effort). Sem RPC nova.

**Tech stack:** Next 16 (App Router, server actions), React 19, Supabase (Postgres), Tailwind v4.

## Global Constraints
- Migração **aditiva** (coluna com default false) — Prod não muda até merge; sem quebrar `sf_lancar`.
- **MAX_LOTE = 15** (constante compartilhada).
- Coletivo só vale p/ perfis com `chave` ∈ **`passagem`, `spi`, `inspecao`** (chavear pela `chave`).
- Commit por SN **idêntico** ao bipe único (reusa `lancar()`); nada de duplicar a lógica de domínio.
- Não tocar em `gravarBurninEntrada` nem nos painéis especiais (Integração/Embalagem/NQA).

---

### Task 1: Migração + persistência da flag `coletivo`

**Files:**
- Create: `supabase/migrations/0082_sf_postos_coletivo.sql`
- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (PostoRow + listarPostos select)
- Modify: `src/modules/shopfloor/infra/postos-repository.ts` (criarPosto/atualizarPosto)
- Modify: `src/modules/shopfloor/application/sf-postos-actions.ts` (ler `coletivo` do form/dados)

**Interfaces produced:** `PostoRow.coletivo: boolean`; `criarPosto({chave,ordem,perfil,coletivo})`;
`atualizarPosto(chave,{perfil,coletivo})`.

> ⚠️ Numeração: a main pode ter gap (0081 vazou pro Prod). Conferir o maior nº em
> `supabase/migrations/` e usar o próximo livre. Aqui assumo **0082**; ajustar se colidir.

- [ ] **Step 1:** criar a migração:
```sql
-- 0082_sf_postos_coletivo.sql
-- Lançamento coletivo: flag por posto (só faz sentido p/ perfis passagem/spi/inspecao;
-- o gate de qual perfil pode marcar é na UI/actions). Aditiva.
alter table public.sf_postos add column if not exists coletivo boolean not null default false;
```
- [ ] **Step 2:** `ordem-repository.ts` — adicionar `coletivo: boolean` à interface `PostoRow` e incluir
  `coletivo` no select de `listarPostos` (`.select('chave,ordem,perfil,coletivo')`).
- [ ] **Step 3:** `postos-repository.ts` — `criarPosto` aceita `coletivo` (default false) e grava;
  `atualizarPosto` aceita `coletivo` opcional e grava quando presente.
- [ ] **Step 4:** `sf-postos-actions.ts`:
  - `cadastrarPostoAction`: `const coletivo = formData.get('coletivo') === 'on'`; **validar** que só é
    `true` se `perfilEscolhido.chave ∈ {passagem,spi,inspecao}` (senão força false); passar a `criarPosto`.
    Incluir no log.
  - `atualizarPostoAction(chave, { perfil, coletivo })`: mesma validação por perfil; passar a `atualizarPosto`.
- [ ] **Step 5:** aplicar a 0082 no Dev (o usuário roda via SQL Editor/psql) e rodar `npm test` + `tsc`.

---

### Task 2: Checkbox "Lançamento coletivo" no Cadastrar Posto

**Files:**
- Modify: `src/app/(app)/configuracoes/sf-postos/posto-form.tsx`
- Reference: `src/modules/shopfloor/domain/perfil-posto.ts` (perfis + chaves)

**Interfaces consumed:** `atualizarPostoAction(chave,{perfil,coletivo})`, `cadastrarPostoAction`.

**Constante compartilhada** (novo, em `perfil-posto.ts`):
```ts
/** Perfis que suportam lançamento coletivo (chaveado por chave; renomear o nome não quebra). */
export const PERFIS_COLETIVO_OK: readonly string[] = ['passagem', 'spi', 'inspecao']
export const perfilSuportaColetivo = (chave: string) => PERFIS_COLETIVO_OK.includes(chave)
```

- [ ] **Step 1:** em `perfil-posto.ts`, exportar `PERFIS_COLETIVO_OK` + `perfilSuportaColetivo` (com teste
  unitário em `__tests__/perfil-posto.test.ts`: true p/ as 3 chaves, false p/ 'teste'/'burnin'/'nqa').
- [ ] **Step 2:** `PostoForm` (novo): tornar o **perfil controlado** (`const [perfilSel, setPerfilSel] = useState('')`),
  passar `value`/`onValueChange` ao `PerfilSelect` (adicionar essas props ao componente). Renderizar,
  **quando `perfilSuportaColetivo(perfilSel)`**, um checkbox:
```tsx
{perfilSuportaColetivo(perfilSel) && (
  <label className="flex items-center gap-2 text-sm">
    <input type="checkbox" name="coletivo" className="size-4" />
    Lançamento coletivo (bipa vários SNs e envia junto)
  </label>
)}
```
  (o `name="coletivo"` entra no FormData → action já lê no Task 1.)
- [ ] **Step 3:** `EditarPostoButton`: idem controlado, com `defaultValue`/estado inicial =
  `posto.perfil` e o checkbox `defaultChecked={posto.coletivo}`; no `onSubmit`, ler
  `formData.get('coletivo') === 'on'` e passar em `atualizarPostoAction(posto.chave, { perfil, coletivo })`.
  ⚠️ `PostoRow` agora tem `coletivo` (Task 1) — a lista (`postos-lista.tsx`) já passa `posto` inteiro.
- [ ] **Step 4:** `tsc` + `npm test` + lint dos arquivos tocados.

---

### Task 3: Levar a flag `coletivo` pro Lançamento

**Files:**
- Modify: `src/modules/shopfloor/infra/postos-repository.ts` (novo `mapaPostoColetivo`)
- Modify: `src/app/(app)/shopfloor/operar/lancamento/page.tsx` (carregar + passar prop)
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx` (prop + `ehColetivo`)

- [ ] **Step 1:** `postos-repository.ts` — `export async function mapaPostoColetivo(): Promise<Record<string, boolean>>`
  (select `chave,coletivo` de `sf_postos`; mapa chave→coletivo).
- [ ] **Step 2:** `page.tsx` — adicionar `mapaPostoColetivo()` ao `Promise.all` e passar
  `postosColetivo={postosColetivo}` ao `LancamentoForm`.
- [ ] **Step 3:** `lancamento-form.tsx` — aceitar a prop `postosColetivo: Record<string, boolean>`; derivar:
```ts
const ehColetivo = posto !== '' && postosColetivo[posto] === true && perfilSuportaColetivo(perfilDo(posto).chave)
```
  (o `perfilSuportaColetivo` é defesa contra dado antigo.)
- [ ] **Step 4:** `tsc` + `npm test`.

---

### Task 4: Action `lancarLote` (best-effort)

**Files:**
- Modify: `src/modules/shopfloor/application/lancar-action.ts` (nova função exportada)

**Interfaces produced:**
```ts
export interface ResultadoItemLote { numeroSerie: string; ok: boolean; erro?: string }
export async function lancarLote(itens: EntradaLancamento[]): Promise<{ resultados: ResultadoItemLote[] }>
```

- [ ] **Step 1: teste** (`lancar-action` não tem teste unit fácil por bater no banco; validar o guard de
  tamanho com um teste de domínio se viável, senão pular p/ o smoke). No mínimo: garantir que `MAX_LOTE`
  vem de constante compartilhada.
- [ ] **Step 2:** exportar `MAX_LOTE = 15` de um módulo de domínio (ex.: `domain/lote.ts`) e usar aqui e no form.
- [ ] **Step 3:** implementar `lancarLote`:
```ts
export async function lancarLote(itens: EntradaLancamento[]): Promise<{ resultados: ResultadoItemLote[] }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { resultados: itens.map((i) => ({ numeroSerie: i.numeroSerie, ok: false, erro: MENSAGENS.SEM_PERMISSAO })) }
  }
  if (itens.length === 0) return { resultados: [] }
  if (itens.length > MAX_LOTE) {
    return { resultados: itens.map((i) => ({ numeroSerie: i.numeroSerie, ok: false, erro: `Máximo ${MAX_LOTE} por lote.` })) }
  }
  const resultados: ResultadoItemLote[] = []
  for (const item of itens) {          // sequencial: mesmo posto, itens independentes; best-effort
    try {
      const r = await lancar(item)     // reusa TODA a lógica/validação por SN
      resultados.push({ numeroSerie: item.numeroSerie, ok: r.ok, erro: r.ok ? undefined : r.erro })
    } catch {
      resultados.push({ numeroSerie: item.numeroSerie, ok: false, erro: MENSAGENS.ERRO_INTERNO })
    }
  }
  return { resultados }
}
```
- [ ] **Step 4:** `tsc` + `npm test`.

---

### Task 5: Modo lote no form — empilhar em vez de gravar

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

**Consome:** `ehColetivo` (Task 3), `MAX_LOTE` (Task 4), `EntradaLancamento`.
**Produz:** estado `lote: ItemLote[]`, helper `empilharNoLote`.

```ts
type ItemLote = { entrada: EntradaLancamento; outcome: 'aprovado'|'reprovado'|null; erro?: string }
const [lote, setLote] = useState<ItemLote[]>([])
```

- [ ] **Step 1:** helper de empilhar (com dup local + MAX_LOTE):
```ts
/** Modo coletivo: em vez de gravar, empilha o bipe na lista do lote. Retorna true se empilhou. */
function empilharNoLote(entrada: EntradaLancamento, outcome: 'aprovado'|'reprovado'|null): boolean {
  const sn = entrada.numeroSerie.trim()
  if (lote.some((i) => normalizarSerie(i.entrada.numeroSerie) === normalizarSerie(sn))) {
    mostrar({ tipo: 'aviso', titulo: 'Este SN já está no lote.', chips: [{ rotulo: 'Nº Série', valor: sn, mono: true }] })
    limparPeca(); return false
  }
  if (lote.length >= MAX_LOTE) {
    mostrar({ tipo: 'aviso', titulo: `Máximo de ${MAX_LOTE} SNs por lote — envie os atuais antes de continuar.` })
    return false
  }
  setLote((prev) => [...prev, { entrada, outcome }])
  mostrar({ tipo: outcome === 'reprovado' ? 'reprova' : 'ok', titulo: 'Adicionado ao lote',
    chips: [{ rotulo: 'Nº Série', valor: sn, mono: true }, { rotulo: 'Lote', valor: `${lote.length + 1}/${MAX_LOTE}` }] })
  limparPeca(); return true
}
```
- [ ] **Step 2:** interceptar **`onEnviar`** (passagem/spi): montar o `entrada` que hoje vai pro `lancar`
  (mesmos campos das linhas atuais) e o `outcome` (já calculado no bloco atual). ANTES do
  `startTransition(... lancar ...)`, inserir:
```ts
if (ehColetivo) { empilharNoLote(entrada, outcome); return }
```
  (extrair o objeto passado ao `lancar` numa const `entrada` p/ reusar nos dois caminhos.)
- [ ] **Step 3:** interceptar **`gravarAprovado`** (scanner aprovar): idem — montar `entrada`
  (`{colaborador,posto,pmo,op,numeroSerie:sn,status:'Aprovado',conservoConfirmado}`), `outcome='aprovado'`,
  e `if (ehColetivo) { empilharNoLote(entrada,'aprovado'); return }` antes do `startTransition`.
  (A confirmação de conserto continua acontecendo ANTES — comportamento igual.)
- [ ] **Step 4:** interceptar **`gravarReprovado`** (scanner reprovar): idem —
  `entrada={...,status:'Reprovado',defeitos:...}`, `outcome='reprovado'`,
  `if (ehColetivo) { empilharNoLote(entrada,'reprovado'); return }`.
- [ ] **Step 5:** **NÃO** tocar em `gravarBurninEntrada`. Confirmar que burnin/nqa/embalagem/integração
  seguem intactos (ehColetivo é false pra eles por perfil).
- [ ] **Step 6:** `tsc` + `npm test` + lint.

---

### Task 6: UI da lista do lote + Enviar + trocar-contexto

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`

- [ ] **Step 1:** `enviarLote`:
```ts
const [enviandoLote, startEnviarLote] = useTransition()
function enviarLote() {
  if (lote.length === 0 || enviandoLote) return
  startEnviarLote(async () => {
    const { resultados } = await lancarLote(lote.map((i) => i.entrada))
    const falhas = lote
      .map((i) => { const r = resultados.find((x) => normalizarSerie(x.numeroSerie) === normalizarSerie(i.entrada.numeroSerie)); return r && !r.ok ? { ...i, erro: r.erro } : null })
      .filter(Boolean) as ItemLote[]
    const okN = resultados.filter((r) => r.ok).length
    setLote(falhas)                              // mantém só as falhas, com o motivo
    mostrar({ tipo: falhas.length ? 'aviso' : 'ok',
      titulo: falhas.length ? `${okN} enviado(s), ${falhas.length} com erro` : `${okN} peça(s) enviada(s)` })
    refreshTotalPosto(); recarregarHistorico?.() // reaproveitar o refresh existente do form
  })
}
```
  (Adaptar `recarregarHistorico` ao mecanismo real de histórico do form — reusar o que `onEnviar` já usa.)
- [ ] **Step 2:** render em modo coletivo — quando `ehColetivo`, mostrar a **lista do lote** (SN + status +
  erro quando houver + botão remover por linha) e o botão **"Enviar (N)"** (disabled se vazio/enviando).
  Colocar ao lado do bipe (reusar o grid das telas especiais). O bipe normal continua; o histórico normal
  continua embaixo.
- [ ] **Step 3:** remover linha: `setLote((prev) => prev.filter((_, idx) => idx !== i))`.
- [ ] **Step 4:** trocar posto/OP com lote pendente → `useConfirmacao`: nos handlers de mudar posto/OP
  (e no "Atualizar cabeçalho"), se `lote.length > 0`, `await confirmar({titulo:'Descartar o lote pendente?'...})`;
  se confirmar, `setLote([])` e segue; senão, aborta a troca.
- [ ] **Step 5:** `tsc` + `npm test` + lint + build.

---

## Self-review (feito)
- Cobertura do spec: flag por posto ✅ (T1), gate por perfil ✅ (T1/T2), checkbox no cadastro ✅ (T2),
  máx 15 ✅ (T4/T5), reprova-na-hora ✅ (reusa os commits existentes, T5), best-effort ✅ (T4/T6),
  remover linha ✅ (T6), trocar-contexto ✅ (T6), sem RPC nova ✅.
- Sem placeholders; tipos consistentes (`EntradaLancamento`, `ItemLote`, `ResultadoItemLote`, `MAX_LOTE`).
- Fora do escopo mantido fora: persistência no refresh, auto-send, editar status na lista.
