# Ocultar incompletos nas Etiquetas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um toggle "Ocultar incompletos" na tela de Etiquetas que esconde da lista os processos inelegíveis (que não geram etiqueta), com contador dos ocultos.

**Architecture:** Camada de filtro client-side em cima do sub-filtro existente. Renomeia o memo `linhasVisiveis` (resultados+chips) para `subFiltradas` e recria `linhasVisiveis` derivando dele conforme o toggle. Sem servidor, sem migração.

**Tech Stack:** Next.js 16 (client component), TypeScript strict `noUncheckedIndexedAccess`, Tailwind.

## Global Constraints

- Muda **um arquivo**: `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx`.
- **Sem TDD** (filtro de apresentação sobre lógica pura já testada). Sem migração, sem servidor.
- A lógica de **seleção** e de **geração** de etiquetas **não muda**; o toggle é puramente visual.
- Toggle **desligado por padrão**; estado só na sessão (reload zera).
- Trailer de commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit via heredoc. **Sem `git push`** (usuário valida o smoke).
- Verificação: `npx tsc --noEmit && npm run lint && npm run build` (único warning aceitável: o `<img>` pré-existente).

## File Structure

- Modify: `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx` (estado + memos + cabeçalho).

---

### Task 1: Toggle "Ocultar incompletos"

**Files:**
- Modify: `src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx`

- [ ] **Step 1: Estado do toggle**

Logo após a linha do `subFiltro`:

```tsx
  const [subFiltro, setSubFiltro] = useState<SubFiltroEtiquetas>(SUB_FILTRO_PADRAO)
```

adicionar:

```tsx
  const [ocultarIncompletos, setOcultarIncompletos] = useState(false)
```

- [ ] **Step 2: Renomear o memo atual para `subFiltradas`**

Trocar o bloco:

```tsx
  /** Linhas exibidas = resultado da busca principal com o sub-filtro aplicado. */
  const linhasVisiveis = useMemo(
    () => aplicarSubFiltro(resultados ?? [], subFiltro, ACESSORES),
    [resultados, subFiltro],
  )
```

por:

```tsx
  /** Resultados da busca principal com o sub-filtro (chips) aplicado. */
  const subFiltradas = useMemo(
    () => aplicarSubFiltro(resultados ?? [], subFiltro, ACESSORES),
    [resultados, subFiltro],
  )
```

- [ ] **Step 3: Recriar `linhasVisiveis` derivado + `ocultos`**

Logo **depois** do memo `elegibilidades` (o bloco que termina em `}, [resultados])` e monta o `Map` de elegibilidade), inserir:

```tsx
  /**
   * Linhas exibidas = sub-filtradas e — se "Ocultar incompletos" estiver ligado — só os
   * elegíveis (que podem gerar etiqueta). Tabela e cards iteram esta lista. Precisa ficar
   * DEPOIS de `elegibilidades` na ordem de declaração.
   */
  const linhasVisiveis = useMemo(
    () =>
      ocultarIncompletos
        ? subFiltradas.filter((p) => elegibilidades.get(p.id)?.elegivel)
        : subFiltradas,
    [subFiltradas, ocultarIncompletos, elegibilidades],
  )

  /** Quantos incompletos o toggle está escondendo agora (0 quando desligado). */
  const ocultos = subFiltradas.length - linhasVisiveis.length
```

(Todas as referências a `linhasVisiveis` no resto do arquivo — `selecionarTodosElegiveis`, o contador, a tabela e os cards — passam a consumir esta versão sem outra mudança.)

- [ ] **Step 4: Toggle no cabeçalho + contador**

Trocar o cabeçalho dos resultados:

```tsx
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={selecionarTodosElegiveis}>
                Selecionar todos (elegíveis)
              </Button>
              <Button variant="outline" size="sm" onClick={limparSelecao}>
                Limpar seleção
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">
              {selecionados.size} selecionado(s) de {linhasVisiveis.length} visível(is)
            </span>
          </div>
```

por:

```tsx
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={selecionarTodosElegiveis}>
                Selecionar todos (elegíveis)
              </Button>
              <Button variant="outline" size="sm" onClick={limparSelecao}>
                Limpar seleção
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
                <input
                  type="checkbox"
                  className="size-4 accent-enterplak"
                  checked={ocultarIncompletos}
                  onChange={(e) => setOcultarIncompletos(e.target.checked)}
                />
                Ocultar incompletos
              </label>
            </div>
            <span className="text-sm text-muted-foreground">
              {selecionados.size} selecionado(s) de {linhasVisiveis.length} visível(is)
              {ocultos > 0 && ` · ${ocultos} incompleto(s) oculto(s)`}
            </span>
          </div>
```

- [ ] **Step 5: Verificar e commit**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros (só o warning `<img>` pré-existente). Se o build faltar memória, `pkill -f "next dev" || true` antes e/ou `NODE_OPTIONS="--max-old-space-size=4096" npm run build`.

```bash
git add "src/app/(app)/recebimento/etiquetas/etiquetas-cliente.tsx"
git commit -F - << 'EOF'
feat(etiquetas): toggle "Ocultar incompletos" na lista de resultados

Esconde os processos inelegíveis (que não geram etiqueta) da tabela e dos
cards, com contador dos ocultos. Filtro client-side sobre o sub-filtro; a
seleção e a geração não mudam. Desligado por padrão.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

## Notas de verificação (self-review)

- **Cobertura da spec:** toggle no cabeçalho (Step 4) ✅; desligado por padrão (Step 1) ✅;
  contador com ocultos (Step 4) ✅; client-side sobre sub-filtro (Steps 2–3) ✅; vale tabela e
  cards porque ambos iteram `linhasVisiveis` ✅; seleção/geração intactas (nenhum toque nelas) ✅.
- **Ordem de declaração:** `linhasVisiveis` (novo) referencia `elegibilidades` e `subFiltradas`
  → foi colocado **depois** dos dois (Step 3). Sem uso antes da declaração.
- **Sem placeholders:** todo passo traz o código completo, com o "antes" lido do arquivo real.
- **Tipos:** `ocultos: number`; `ocultarIncompletos: boolean`; `elegibilidades.get(p.id)?.elegivel`
  já era o padrão usado na tela (optional chaining seguro sob `noUncheckedIndexedAccess`).
