# Scanner SPI/NQA/Burn-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usam `- [ ]`.

**Goal:** SPI entra no fluxo scanner (lista de defeitos fixa de solda); NQA ganha comentário livre; Burn-in escolhe Evento antes e a saída vira scanner.

**Architecture:** 2 migrações (0075 perfil SPI; 0076 coluna `observacao` + `sf_lancar`). Domínio ganha a lista SPI + seletor de defeitos por posto. `lancamento-form` reescreve `ehScanner` (inclui SPI + Burn-in-saída), usa o catálogo por posto, e o Burn-in ganha Evento-antes-da-ação. Demais postos intactos.

**Tech Stack:** Next.js 16, React 19, TS strict, Supabase (Postgres/RPC), Vitest.

## Global Constraints
- PT-BR; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Não quebrar** os postos já prontos (inspeção/teste scanner, passagem, Integração, Embalagem).
- Migrações **aplicadas no Dev primeiro** (`export SUPABASE_GO_BINARY="$HOME/.local/share/supabase/supabase-go"; supabase db push`). Dev/Prod hoje em **0074**; estas são **0075/0076**.
- Build/lint/test verdes ao fim de cada task.

## File Structure
- **Create** `supabase/migrations/0075_sf_perfil_spi_defeitos.sql`
- **Create** `supabase/migrations/0076_sf_registros_observacao.sql`
- **Modify** `src/modules/shopfloor/domain/acao-lancamento.ts` (+ test) — lista SPI + `defeitosDoPosto`.
- **Modify** `src/modules/shopfloor/application/lancar-action.ts` (`EntradaLancamento.observacao`), `src/modules/shopfloor/infra/lancamento-repository.ts` (`SfLancarArgs.p_observacao` + `chamarSfLancar`).
- **Modify** `src/app/(app)/shopfloor/operar/lancamento/lancamento-form.tsx`.

---

## Task 1: Migração 0075 — perfil SPI vira defeitos

**Files:** Create `supabase/migrations/0075_sf_perfil_spi_defeitos.sql`.

- [ ] **Step 1:** Escrever:
```sql
-- SPI passa a coletar defeito (código) na reprova, igual aos outros testes de defeito
-- (o autocomplete usa uma lista fixa de solda no front). Antes: reprova por posição.
update public.sf_posto_perfis set reprova = 'defeitos' where chave = 'spi';
```
- [ ] **Step 2:** Aplicar no Dev (`supabase db push`) — confirmar sem erro.
- [ ] **Step 3:** Commit (`feat(shopfloor): perfil SPI passa a reprovar por defeito (migração 0075)`).

---

## Task 2: Migração 0076 — comentário (observacao) + camada

**Files:** Create `supabase/migrations/0076_sf_registros_observacao.sql`; Modify `lancamento-repository.ts`, `lancar-action.ts`.

**Interfaces:**
- Produces: coluna `sf_registros.observacao text not null default ''`; `sf_lancar` com `p_observacao text default ''`; `SfLancarArgs.p_observacao: string`; `EntradaLancamento.observacao?: string`.

- [ ] **Step 1: Migração**
Criar `0076_sf_registros_observacao.sql`:
```sql
-- Comentário livre (usado no NQA). Coluna aditiva + sf_lancar passa a recebê-lo.
alter table public.sf_registros add column if not exists observacao text not null default '';
```
Em seguida, **recriar `sf_lancar`**: copie o corpo EXATO da última definição (`supabase/migrations/0033_sf_manutencao.sql`, `create or replace function public.sf_lancar(...)`) para esta migração e faça só 2 mudanças:
1. Acrescentar o parâmetro `p_observacao text default ''` (por último na assinatura, para não quebrar chamadas por posição).
2. No **insert base** de `sf_registros` (o do começo do corpo — linha ~41 de 0033, o que grava status/defeito), incluir `observacao` na lista de colunas e `p_observacao` nos values. **Não** mexer nos inserts de caixa (a coluna tem default `''`). Não alterar mais nenhuma lógica.

- [ ] **Step 2:** Aplicar no Dev (`supabase db push`) — confirmar 0076 aplicada.

- [ ] **Step 3: Camada TS**
Em `lancamento-repository.ts`: `SfLancarArgs` += `p_observacao: string`. (O `chamarSfLancar` repassa o objeto inteiro — só garantir o campo.)
Em `lancar-action.ts`: `EntradaLancamento` += `observacao?: string`; no `chamarSfLancar({...})` do caminho normal, acrescentar `p_observacao: entrada.observacao ?? ''`.

- [ ] **Step 4:** Build + lint + testes verdes.
- [ ] **Step 5:** Commit (`feat(shopfloor): sf_registros.observacao + sf_lancar recebe comentário (migração 0076)`).

---

## Task 3: Domínio — lista SPI + seletor de defeitos por posto

**Files:** Modify `src/modules/shopfloor/domain/acao-lancamento.ts` + `__tests__/acao-lancamento.test.ts`.

**Interfaces:**
- Produces:
  - `const DEFEITOS_SPI: DefeitoCatalogo[] = [{codigo:'FALTA DE SOLDA',tipo:1},{codigo:'INSUFICIÊNCIA DE SOLDA',tipo:1},{codigo:'EXAGERO DE SOLDA',tipo:1},{codigo:'CURTO',tipo:1}]`
  - `function defeitosDoPosto(perfilChave: string, catalogo: DefeitoCatalogo[]): DefeitoCatalogo[]` → `perfilChave === 'spi' ? DEFEITOS_SPI : catalogo`.

- [ ] **Step 1: Teste (falha)** — acrescentar ao test existente:
```ts
import { classificarAcao, defeitosDoPosto, DEFEITOS_SPI } from '../acao-lancamento'
// ...
describe('defeitosDoPosto', () => {
  const cat = [{ codigo: '101 X', tipo: 2 }]
  it('spi → lista fixa de solda', () => {
    expect(defeitosDoPosto('spi', cat)).toBe(DEFEITOS_SPI)
    expect(DEFEITOS_SPI.map((d) => d.codigo)).toContain('CURTO')
  })
  it('outros → catálogo geral', () => {
    expect(defeitosDoPosto('inspecao', cat)).toBe(cat)
  })
})
// e classificarAcao com a lista SPI reconhece o defeito de solda:
it('SPI: código de solda → reprovado', () => {
  expect(classificarAcao('curto', DEFEITOS_SPI, '2659381000', '2659381999')).toEqual({ tipo: 'reprovado', codigo: 'CURTO' })
})
```
- [ ] **Step 2:** Rodar e ver falhar.
- [ ] **Step 3: Implementar** — acrescentar `DEFEITOS_SPI` e `defeitosDoPosto` em `acao-lancamento.ts` (não mudar `classificarAcao`).
- [ ] **Step 4:** Rodar e ver passar.
- [ ] **Step 5:** Commit (`feat(shopfloor): lista fixa de defeitos de SPI + defeitosDoPosto`).

---

## Task 4: Frontend — SPI (lista) + NQA (comentário)

**Files:** Modify `lancamento-form.tsx`.

**Interfaces:** Consumes `defeitosDoPosto`/`DEFEITOS_SPI` (T3), `observacao` no `lancar` (T2).

- [ ] **Step 1: SPI usa a lista do posto**
  - `const defeitosPosto = defeitosDoPosto(perfilDo(posto).chave, defeitos)` (memoizado por `posto`).
  - Trocar, no fluxo scanner, o uso de `defeitos` por `defeitosPosto`: no `classificarAcao(numeroSerie, defeitosPosto, …)` (onAcao), no `<datalist id="acao-defeitos-list">` (options = `defeitosPosto`), e no `<ReprovarModal defeitosCatalogo={defeitosPosto.map(d=>d.codigo)} …>`.
  - Após a migração 0075, SPI é `reprova==='defeitos'` → já entra no `ehScanner` atual; **remover** o `!ehSpi` do `ehScanner` (SPI agora é scanner). Conferir que `ehSpi` (que ainda existe pra o bloco de posições) não conflita — o bloco de posições SPI (`mostraStatus && ehSpi && reprovado`) fica **inalcançável** no scanner (status não é usado); pode deixar como está (morto) ou remover. Remover pra limpar.

- [ ] **Step 2: NQA comentário**
  - Estado `const [observacao, setObservacao] = useState('')`; limpar em `resetCamposDinamicos`/`limparPeca`.
  - No bloco `{ehNqa && (...)}`, acrescentar um campo **Comentário** (`<Input>` ou textarea) sempre visível, ligado a `observacao` (opcional).
  - No `onEnviar` (caminho NQA usa `onEnviar`), passar `observacao: ehNqa ? observacao : undefined` ao `lancar`.

- [ ] **Step 3:** Build + lint + testes verdes.
- [ ] **Step 4:** Commit (`feat(shopfloor): SPI usa lista fixa no scanner + comentário livre no NQA`).

---

## Task 5: Frontend — Burn-in (evento antes + saída scanner)

**Files:** Modify `lancamento-form.tsx`.

- [ ] **Step 1: Evento antes da ação + foco**
  - Mover o seletor **Evento (Entrada/Saída)** para **antes** do campo de ação. Na cadeia de foco: ao escolher o posto Burn-in, focar o seletor de Evento; ao escolher o Evento, focar o campo de ação. (Se o Select por teclado atrapalhar, aceitar teclas Entrada/Saída.)

- [ ] **Step 2: Ação do Burn-in por evento**
  - `ehScanner` passa a considerar Burn-in **na saída** como scanner: reescrever `const ehScanner = comStatus && !ehNqa && ((!ehBurnin && perfilDo(posto).reprova==='defeitos') || (ehBurnin && burninEvento==='saida'))`. (SPI já entra pelo `reprova==='defeitos'`.)
  - **Burn-in entrada:** o campo de ação bipa SN → `onAcao` detecta `ehBurnin && burninEvento==='entrada'` → chama direto `gravarBurninEntrada()` = `startTransition(lancar({..., burninEvento:'entrada'}))` (sem modal, sem status).
  - **Burn-in saída:** `onAcao` roda `classificarAcao(numeroSerie, defeitos, faixa)` (catálogo geral) → SN→AprovarModal; defeito→ReprovarModal (igual aos outros). Em `gravarAprovado`/`gravarReprovado`, quando `ehBurnin`, passar `burninEvento:'saida'` ao `lancar` (status Aprovado/Reprovado, defeitos).
  - **Aviso de tempo mínimo:** o `onEnviar` tem o aviso de sair antes do tempo mínimo do Burn-in; trazer essa checagem pra o `gravarAprovado`/`gravarReprovado` quando `ehBurnin && burninEvento==='saida'` (antes de gravar; se cancelar, aborta).

- [ ] **Step 3:** Build + lint + testes verdes.
- [ ] **Step 4:** Commit (`feat(shopfloor): Burn-in — evento antes da ação; saída no fluxo scanner (aprova/reprova)`).

---

## Smoke (manual, scanner)
1. **SPI:** bipa SN→aprova; digita/bipa "curto"→reprova (posição+SN); um defeito **fora** da lista de solda → "não reconhecido". Registro guarda o código.
2. **NQA:** Visual+Funcional + comentário livre → registra; comentário some ao limpar.
3. **Burn-in:** escolhe Evento **antes**; entrada bipa SN→registra; saída bipa SN→aprova / defeito→reprova; aviso de tempo mínimo aparece na saída antecipada.
4. Inspeção/Teste, passagem, Integração, Embalagem **iguais**.

## Self-Review
- SPI: migração 0075 + lista fixa (T3) + front (T4) — usa defeitosDoPosto no scanner. ✔
- NQA: 0076 (coluna+sf_lancar) + camada (T2) + campo (T4). ✔
- Burn-in: front (T5), evento-antes + saída-scanner + aviso de tempo. ✔
- Migrações Dev-first; sf_lancar recriado copiando 0033 (só +param +coluna no insert base). ✔
- Demais postos intactos (ehScanner isola; NQA segue onEnviar). ✔
