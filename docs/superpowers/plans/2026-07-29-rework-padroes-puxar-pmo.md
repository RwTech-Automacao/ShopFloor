# Rework Padrões + Puxar por PMO + fix do cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** (1) Auto-preencher Cliente+Descrição pela OP mais recente da PMO; (2) padrão associa a uma PMO **escolhida** (no lugar da Descrição); (3) resetar o form ao abrir (fix do "cache").

**Architecture:** A page monta `dadosPorPmo` (PMO → {cliente, descrição} da OP mais recente) a partir das ordens já carregadas e passa pro form; o `ordem-form.tsx` auto-preenche ao mudar a PMO, troca o campo Descrição do salvar-padrão por "Associar à PMO", e reseta o estado ao abrir o Dialog. Sem banco.

**Tech Stack:** Next.js 16 (App Router), React 19, TS strict, Supabase.

## Global Constraints

- PT-BR em UI/comentários. Sem migração (a coluna `descricao` do padrão fica sem uso).
- Não mudar outras lógicas do form (postos/receita/faixa/etc.).
- Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Spec: `docs/superpowers/specs/2026-07-29-rework-padroes-puxar-pmo-design.md`.

## File Structure

- Modify: `src/modules/shopfloor/infra/ordem-repository.ts` (add `created_at` ao select + `OrdemRow`).
- Modify: `src/app/(app)/shopfloor/ordens/page.tsx` (monta `dadosPorPmo`, passa como prop).
- Modify: `src/app/(app)/shopfloor/ordens/ordens-lista.tsx` (prop `dadosPorPmo` → OrdemForm interno).
- Modify: `src/app/(app)/shopfloor/ordens/ordem-form.tsx` (auto-fill + associar PMO + dropdown label + reset).

---

### Task 1: Plumbing de dados — `dadosPorPmo`

**Files:** `ordem-repository.ts`, `page.tsx`, `ordens-lista.tsx`

**Interfaces:** Produces `dadosPorPmo: Record<string, { cliente: string; descricao: string }>` passado ao `<OrdemForm>` (Task 2).

- [ ] **Step 1: `created_at` no `listarOrdens`** — em `src/modules/shopfloor/infra/ordem-repository.ts`:
  - No `.select(...)` do `listarOrdens`, incluir `created_at`:
    `'id,pmo,op,cliente,qtd,descricao,acp,status,sn_ini,sn_fim,created_at,sf_ordem_postos(posto,ordem),sf_ordem_componentes(pmo_componente)'`
  - Adicionar `created_at: string` na interface `OrdemRow` (junto dos outros campos).

- [ ] **Step 2: `dadosPorPmo` na page** — em `src/app/(app)/shopfloor/ordens/page.tsx`, depois do `const pmosExistentes = ...`:
```tsx
  // Cliente + descrição da OP MAIS RECENTE de cada PMO (pra auto-preencher no form).
  const maisRecentePorPmo: Record<string, string> = {}
  const dadosPorPmo: Record<string, { cliente: string; descricao: string }> = {}
  for (const o of ordens) {
    if (!maisRecentePorPmo[o.pmo] || o.created_at > maisRecentePorPmo[o.pmo]) {
      maisRecentePorPmo[o.pmo] = o.created_at
      dadosPorPmo[o.pmo] = { cliente: o.cliente, descricao: o.descricao }
    }
  }
```
  E passar `dadosPorPmo={dadosPorPmo}` tanto no `<OrdemForm ... />` quanto no `<OrdensLista ... />`.

- [ ] **Step 3: prop na `OrdensLista`** — em `src/app/(app)/shopfloor/ordens/ordens-lista.tsx`:
  - Adicionar `dadosPorPmo` à desestruturação de props e ao tipo:
    `dadosPorPmo: Record<string, { cliente: string; descricao: string }>`.
  - Passar `dadosPorPmo={dadosPorPmo}` no `<OrdemForm ... />` interno (o de edição).

- [ ] **Step 4: tsc** — `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` deve acusar **só** o erro esperado no `ordem-form.tsx` (prop `dadosPorPmo` ainda não existe lá — some na Task 2). Se aparecer outro erro, corrigir.

- [ ] **Step 5: Commit**
```bash
git add src/modules/shopfloor/infra/ordem-repository.ts "src/app/(app)/shopfloor/ordens/page.tsx" "src/app/(app)/shopfloor/ordens/ordens-lista.tsx"
git commit -m "$(cat <<'EOF'
feat(shopfloor): monta dadosPorPmo (cliente+descrição da OP mais recente) e passa ao form

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rework do `ordem-form.tsx`

**Files:** `src/app/(app)/shopfloor/ordens/ordem-form.tsx`

**Interfaces:** Consumes `dadosPorPmo` (Task 1), `salvarPadraoAction` (já importado).

Aplicar as edições abaixo (o arquivo já foi lido; casar pelos trechos exatos):

- [ ] **Step 1: nova prop `dadosPorPmo`** — na assinatura/props do `OrdemForm`, adicionar
  `dadosPorPmo: Record<string, { cliente: string; descricao: string }>` (junto de `padroesExistentes`, etc.).

- [ ] **Step 2: Descrição controlada + estados novos** — trocar:
```tsx
  const [descricaoPadrao, setDescricaoPadrao] = useState('')
```
por:
```tsx
  const [pmoPadrao, setPmoPadrao] = useState('')
```
E adicionar (perto dos outros `useState` do form, ex.: após `const [cliente, setCliente] = ...`):
```tsx
  const [descricao, setDescricao] = useState(ordem?.descricao ?? '')
  const [instanciaForm, setInstanciaForm] = useState(0)
```

- [ ] **Step 3: input Descrição vira controlado** — trocar:
```tsx
                <Input id="descricao" name="descricao" defaultValue={ordem?.descricao ?? ''} />
```
por:
```tsx
                <Input id="descricao" name="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
```

- [ ] **Step 4: auto-preencher ao mudar a PMO** — trocar o input de PMO:
```tsx
                <Input id="pmo" name="pmo" value={pmo} onChange={(e) => setPmo(e.target.value)} required />
```
por:
```tsx
                <Input id="pmo" name="pmo" value={pmo} onChange={(e) => {
                  const novo = e.target.value
                  setPmo(novo)
                  const dados = dadosPorPmo[novo.trim()]
                  if (dados) { setCliente(dados.cliente); setDescricao(dados.descricao); setModoNovoCliente(false) }
                }} required />
```

- [ ] **Step 5: reset ao abrir + key no form** — trocar:
```tsx
      <Dialog open={open} onOpenChange={setOpen}>
```
por:
```tsx
      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          // Reset ao abrir: "Nova OP" limpa; edição recarrega a OP (fix do "cache").
          setPmo(ordem?.pmo ?? '')
          setFluxo(ordem?.postos ?? [])
          setReceita(ordem?.componentes ?? [])
          setCliente(ordem?.cliente ?? '')
          setDescricao(ordem?.descricao ?? '')
          setModoNovoCliente(false)
          setPadraoSelecionado('')
          setInstanciaForm((n) => n + 1)
        }
      }}>
```
E na tag do form, adicionar a `key` (trocar `<form action={formAction} className="flex flex-col gap-4">` por):
```tsx
          <form key={instanciaForm} action={formAction} className="flex flex-col gap-4">
```

- [ ] **Step 6: abrirSalvarPadrao pré-preenche a PMO** — trocar:
```tsx
  function abrirSalvarPadrao() {
    setNomePadrao('')
    setDescricaoPadrao('')
    setSalvarAberto(true)
  }
```
por:
```tsx
  function abrirSalvarPadrao() {
    setNomePadrao('')
    setPmoPadrao(pmo)
    setSalvarAberto(true)
  }
```

- [ ] **Step 7: onConfirmarSalvarPadrao usa a PMO escolhida** — trocar o corpo:
```tsx
  async function onConfirmarSalvarPadrao() {
    const nome = nomePadrao.trim()
    if (nome === '') {
      toast.error('Informe o nome do padrão.')
      return
    }
    const existente = padroesDoPmo.find((p) => p.nome === nome)
    if (existente) {
      const ok = await confirmar({
        titulo: `Já existe um padrão "${nome}" para este PMO. Sobrescrever?`,
        rotuloConfirmar: 'Sobrescrever',
      })
      if (!ok) return
    }
    startSalvarPadrao(async () => {
      const r = await salvarPadraoAction({
        pmo,
        nome,
        descricao: descricaoPadrao.trim(),
        postos: fluxo,
        componentes: receita,
      })
      if (r.ok) {
        setSalvarAberto(false)
```
por (mantendo o resto do corpo após o `if (r.ok) { setSalvarAberto(false)` igual):
```tsx
  async function onConfirmarSalvarPadrao() {
    const nome = nomePadrao.trim()
    const pmoAlvo = pmoPadrao.trim()
    if (nome === '') {
      toast.error('Informe o nome do padrão.')
      return
    }
    if (pmoAlvo === '') {
      toast.error('Informe a PMO à qual associar o padrão.')
      return
    }
    const existente = padroesExistentes.find((p) => p.pmo === pmoAlvo && p.nome === nome)
    if (existente) {
      const ok = await confirmar({
        titulo: `Já existe um padrão "${nome}" para a PMO ${pmoAlvo}. Sobrescrever?`,
        rotuloConfirmar: 'Sobrescrever',
      })
      if (!ok) return
    }
    startSalvarPadrao(async () => {
      const r = await salvarPadraoAction({
        pmo: pmoAlvo,
        nome,
        descricao: '',
        postos: fluxo,
        componentes: receita,
      })
      if (r.ok) {
        setSalvarAberto(false)
```

- [ ] **Step 8: dropdown de padrão mostra só o nome** — trocar as DUAS ocorrências de
  `p.descricao ? \`${p.nome} — ${p.descricao}\` : p.nome` por apenas `p.nome`:
  - No `SelectValue` (função filha): `return p ? p.nome : 'Puxar de padrão…'`.
  - No `SelectItem`: `>{p.nome}</SelectItem>`.

- [ ] **Step 9: dialog salvar — Descrição vira "Associar à PMO"** — trocar o bloco do campo Descrição do
  dialog "Salvar como padrão":
```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="descricaoPadrao">Descrição</Label>
              <Input
                id="descricaoPadrao"
                value={descricaoPadrao}
                onChange={(e) => setDescricaoPadrao(e.target.value)}
              />
            </div>
```
por:
```tsx
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pmoPadrao">Associar à PMO *</Label>
              <Input
                id="pmoPadrao"
                value={pmoPadrao}
                onChange={(e) => setPmoPadrao(e.target.value)}
              />
            </div>
```

- [ ] **Step 10: Lint + build**

Run: `npm run lint && NODE_OPTIONS="--max-old-space-size=4096" npm run build`
Expected: sem erros; nenhuma referência sobrando a `descricaoPadrao`/`setDescricaoPadrao`; `/shopfloor/ordens` builda.

- [ ] **Step 11: Commit**
```bash
git add "src/app/(app)/shopfloor/ordens/ordem-form.tsx"
git commit -m "$(cat <<'EOF'
feat(shopfloor): OP puxa cliente/descrição por PMO + padrão associa a PMO escolhida + reset do form

- Ao mudar a PMO, auto-preenche Cliente+Descrição da OP mais recente daquela PMO
- Salvar como padrão: "Associar à PMO" (escolhida) no lugar da Descrição; dropdown só o nome
- Reset do form ao abrir o Dialog (fix do "cache" da última OP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verificação final (após as tasks)
- [ ] `npm run test` — suíte verde.
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" npm run build` — build limpo.
- [ ] Smoke no preview: (1) digitar uma PMO existente → Cliente+Descrição preenchem; (2) "Salvar como padrão" pede Nome + "Associar à PMO" (pré = PMO do form), sem Descrição → o padrão aparece nas OPs da PMO escolhida, dropdown só com o nome; (3) salvar uma OP e reabrir "Nova OP" → form **limpo**; editar → dados da OP.

## Self-review (feito ao escrever)
- **Cobertura do spec:** dadosPorPmo (T1) · auto-fill por PMO (T2 s4) · padrão associa PMO + sem descrição (T2 s6/7/9) · dropdown só nome (T2 s8) · reset do form (T2 s5) · descrição controlada (T2 s2/3). ✓
- **Sem placeholders:** trechos before/after exatos (o arquivo foi lido).
- **Consistência:** `dadosPorPmo` mesmo tipo em page/lista/form; `pmoPadrao` substitui `descricaoPadrao` de ponta a ponta (estado, dialog, handler); overwrite-check agora por `pmoAlvo`.
- **Nota:** o `key` no `<form>` remonta os inputs soltos (op/qtd/acp/status/sn_ini/sn_fim); os controlados resetam pelos setters no `onOpenChange`.
