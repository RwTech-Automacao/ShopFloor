# Registrar reparo — defeito relatado + constatados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** No dialog "Registrar reparo": exibir o defeito relatado no cabeçalho e exigir ≥1 defeito constatado (do catálogo), gravando cada constatado como defeito da peça (conta em Registros/Pesquisa). Nada é removido.

**Architecture:** Migração `0061` adiciona a coluna `reparo_constatado` e redefine o RPC `sf_registrar_reparo` (drop da assinatura antiga + nova com `p_defeitos_constatados`). O param é plumbado pelo infra (`SfRegistrarReparoArgs`) e pela action (`EntradaReparo`). A UI carrega o catálogo e ganha o cabeçalho + a seção de constatados.

**Tech Stack:** Next.js 16, React 19, TS strict, Supabase (RPC security definer), Vitest 4.

## Global Constraints
- **Migração `0061` só no Dev** nesta etapa (Prod está em `0060`). Coluna aditiva (`add column ... default false`) + RPC redefinido (drop+create). Sem mudança de RLS.
- **Só acréscimo** — não remover/alterar nada do fluxo atual (colaborador + consertos continuam).
- **Constatado = só o código** (sem posição). **Obrigatório ≥1** pra concluir.
- Constatado grava linha em `sf_registros`: posto `Manutenção`, `codigo_defeito`=código, **`status`=''** (não 'Reprovado' — evita virar falsa pendência), `reparo_constatado=true`.
- Guard já existente: `podeNoModulo(...,'shopfloor','lancar')` na action; `tem_permissao('lancar')` no RPC.
- PT-BR. Build: `NODE_OPTIONS="--max-old-space-size=4096" npm run build`. O controlador aplica a `0061` no Dev após a Task 1 (fora das tasks).

---

### Task 1: Migração 0061 — coluna `reparo_constatado` + RPC `sf_registrar_reparo`

**Files:**
- Create: `supabase/migrations/0061_sf_reparo_constatado.sql`

**Interfaces — Produces:** coluna `sf_registros.reparo_constatado boolean`; RPC `sf_registrar_reparo(..., p_defeitos_constatados jsonb)`.

- [ ] **Step 1: Escrever a migração**
```sql
-- supabase/migrations/0061_sf_reparo_constatado.sql
-- Reparo: defeitos constatados (do catálogo) viram linhas de defeito da peça.
-- Marca a linha com reparo_constatado=true (codigo_defeito = código do catálogo).

alter table public.sf_registros
  add column if not exists reparo_constatado boolean not null default false;
comment on column public.sf_registros.reparo_constatado is
  'true = linha de defeito CONSTATADO durante o reparo (codigo_defeito = defeito do catálogo).';

-- Redefinir sf_registrar_reparo com o parâmetro novo. A aridade muda → dropar a
-- assinatura antiga primeiro (senão create-or-replace vira OVERLOAD ambíguo).
drop function if exists public.sf_registrar_reparo(
  text, text, text, text, text, text, text, text, text, text, timestamptz, jsonb);

create or replace function public.sf_registrar_reparo(
  p_colaborador          text,
  p_pmo                  text,
  p_op                   text,
  p_cliente              text,
  p_sn                   text,
  p_sn_norm              text,
  p_cod                  text,
  p_pos                  text,
  p_tipo                 text,
  p_posto_origem         text,
  p_data_hora_origem     timestamptz,
  p_consertos            jsonb,   -- [{descricao, posicao}]
  p_defeitos_constatados jsonb    -- ["1002 TRILHA ROMPIDA", ...] (códigos do catálogo)
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  if coalesce(jsonb_array_length(p_consertos), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSERTOS');
  end if;
  if coalesce(jsonb_array_length(p_defeitos_constatados), 0) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'SEM_CONSTATADOS_DEFEITO');
  end if;

  -- Linhas de conserto (INALTERADO): 1 por conserto, com o defeito relatado.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posicao, tipo_defeito, reparo_conserto, reparo_posicao, posto_origem, data_hora_origem)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    coalesce(p_cod, ''), coalesce(p_pos, ''), coalesce(p_tipo, ''),
    coalesce(x->>'descricao', ''), coalesce(x->>'posicao', ''),
    p_posto_origem, p_data_hora_origem
  from jsonb_array_elements(p_consertos) x;

  -- Linhas de defeito CONSTATADO (NOVO): 1 por código; status '' e reparo_constatado=true.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm,
    codigo_defeito, posto_origem, data_hora_origem, reparo_constatado)
  select p_colaborador, 'Manutenção', p_pmo, p_op, p_cliente, p_sn, p_sn_norm,
    d, p_posto_origem, p_data_hora_origem, true
  from jsonb_array_elements_text(p_defeitos_constatados) d
  where coalesce(d, '') <> '';

  return jsonb_build_object('ok', true,
    'linhas', jsonb_array_length(p_consertos),
    'constatados', jsonb_array_length(p_defeitos_constatados));
end;
$$;
```

- [ ] **Step 2: Verificar sintaxe localmente (sem aplicar)**
Não há Postgres local (Docker off). Confirmar apenas que o arquivo existe e que o `npm run build` do app não quebra (não depende do banco). O controlador aplica no Dev depois (`supabase db push`).
Run: `ls supabase/migrations/0061_sf_reparo_constatado.sql`

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/0061_sf_reparo_constatado.sql
git commit -m "feat(shopfloor): migração 0061 — reparo_constatado + RPC com defeitos constatados

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Plumbing — infra (args) + action (validação, param, log)

**Files:**
- Modify: `src/modules/shopfloor/infra/manutencao-repository.ts`
- Modify: `src/modules/shopfloor/application/manutencao-actions.ts`

**Interfaces:**
- Consumes: RPC `sf_registrar_reparo` com `p_defeitos_constatados` (Task 1).
- Produces: `EntradaReparo.defeitosConstatados: string[]`; a action passa `p_defeitos_constatados` e valida ≥1.

- [ ] **Step 1: Infra — adicionar o param ao tipo dos args**
Em `manutencao-repository.ts`, achar a interface `SfRegistrarReparoArgs` (tipo do `args` de `chamarSfRegistrarReparo`) e adicionar:
```ts
  p_defeitos_constatados: string[]
```
(O `chamarSfRegistrarReparo` já passa `args` inteiro pro `supabase.rpc('sf_registrar_reparo', args)`; o supabase-js serializa `string[]` → jsonb. Nada mais muda no infra.)

- [ ] **Step 2: Action — tipo, validação, passagem, mensagem, log**
Em `manutencao-actions.ts`:
- `interface EntradaReparo` += `defeitosConstatados: string[]`.
- Em `MENSAGENS`, adicionar: `SEM_CONSTATADOS_DEFEITO: 'Informe ao menos um defeito constatado.',`
- Em `registrarReparo`, após montar `consertos`:
```ts
  const defeitosConstatados = entrada.defeitosConstatados
    .map((c) => c.trim())
    .filter((c) => c !== '')
  // ...após a checagem de consertos:
  if (defeitosConstatados.length === 0) return { ok: false, erro: MENSAGENS.SEM_CONSTATADOS_DEFEITO! }
```
- No objeto passado a `chamarSfRegistrarReparo`, adicionar `p_defeitos_constatados: defeitosConstatados,`.
- No `registrarLog`: incluir `constatados` no `dados` e no texto da `descricao`
  (ex.: `` `Reparo de ${o.sn} (${o.pmo}/${o.op}, origem ${o.posto}): ${consertos.length} conserto(s), ${defeitosConstatados.length} constatado(s)` ``), e `dados: { ocorrencia: o, consertos, defeitosConstatados }`.

- [ ] **Step 3: Verificar tipos** — `npx tsc --noEmit -p tsconfig.json` limpo.

- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/manutencao-repository.ts src/modules/shopfloor/application/manutencao-actions.ts
git commit -m "feat(shopfloor): action/infra do reparo passam defeitos constatados (obrigatório ≥1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI — cabeçalho (relatado) + seção de defeitos constatados

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/manutencao/page.tsx`
- Modify: `src/app/(app)/shopfloor/operar/manutencao/manutencao-lista.tsx`

**Interfaces:**
- Consumes: `listarDefeitos` (catálogo) para as sugestões; `registrarReparo` com `defeitosConstatados` (Task 2).

- [ ] **Step 1: `page.tsx` — carregar o catálogo e passar os códigos**
```tsx
// adicionar o import:
import { listarReprovasOrigem, listarReparos, listarDefeitos } from '@/modules/shopfloor/infra/manutencao-repository'
```
**Nota:** `listarDefeitos` hoje vive em `lancamento-repository.ts` (retorna `{codigo,tipo}[]`), NÃO em `manutencao-repository`. Escolha a que existir: importar de `@/modules/shopfloor/infra/lancamento-repository`. Ajustar o import ao arquivo real. Então:
```tsx
  const [reprovas, reparos, defeitos] = await Promise.all([
    listarReprovasOrigem(), listarReparos(), listarDefeitos(),
  ])
  const ocorrencias = agruparPendencias(reprovas, reparos)
  const defeitosCatalogo = defeitos.map((d) => d.codigo)
  // ...
  <ManutencaoLista ocorrencias={ocorrencias} defeitosCatalogo={defeitosCatalogo} />
```

- [ ] **Step 2: `manutencao-lista.tsx` — prop, estado, cabeçalho, seção, validação, envio**
- Assinatura: `export function ManutencaoLista({ ocorrencias, defeitosCatalogo }: { ocorrencias: Ocorrencia[]; defeitosCatalogo: string[] })`.
- Estado novo: `const [constatados, setConstatados] = useState<string[]>([''])`.
- Em `abrirReparo(o)`: adicionar `setConstatados([''])`.
- `valido` passa a exigir também constatado:
```ts
  const valido =
    colaborador.trim() !== '' &&
    consertos.some((c) => c.descricao.trim() !== '') &&
    constatados.some((c) => c.trim() !== '')
```
- `onSalvar`: no objeto de `registrarReparo`, adicionar `defeitosConstatados: constatados,`.
- **Cabeçalho** (a `<p>` de contexto do dialog): acrescentar o defeito relatado quando houver:
```tsx
  {alvo.cod && <> · defeito relatado: <b>{alvo.cod}</b></>}
```
  (inserir dentro da `<p>`, junto de SN · PMO/OP · reprovada em … · posições.)
- **Seção "Defeitos constatados"** — inserir DEPOIS do bloco de Consertos e ANTES do `<DialogFooter>`,
  espelhando a estrutura de consertos (mas um único campo por linha, com datalist do catálogo):
```tsx
              <div className="flex flex-col gap-2">
                <Label>Defeitos constatados</Label>
                <datalist id="defeitos-constatados-list">
                  {defeitosCatalogo.map((c) => <option key={c} value={c} />)}
                </datalist>
                {constatados.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <Input
                      list="defeitos-constatados-list"
                      value={c}
                      onChange={(e) => setConstatados(constatados.map((x, idx) => (idx === i ? e.target.value : x)))}
                      placeholder="Código do defeito (do catálogo)"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      aria-label={`Remover defeito constatado ${i + 1}`}
                      onClick={() => setConstatados(constatados.length > 1 ? constatados.filter((_, idx) => idx !== i) : constatados)}
                      disabled={constatados.length <= 1}
                      className="text-muted-foreground hover:text-red-600 disabled:opacity-30"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setConstatados([...constatados, ''])}
                  className="self-start text-sm font-medium text-enterplak hover:underline"
                >
                  <Plus className="mr-1 inline size-4" /> Adicionar defeito constatado
                </button>
              </div>
```

- [ ] **Step 3: Build** — `NODE_OPTIONS="--max-old-space-size=4096" npm run build` limpo.

- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/manutencao/page.tsx" "src/app/(app)/shopfloor/operar/manutencao/manutencao-lista.tsx"
git commit -m "feat(shopfloor): reparo mostra defeito relatado + registra defeitos constatados

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (feita)
- **Cobertura da spec:** migração+RPC (T1), plumbing infra+action com validação obrigatória (T2), UI cabeçalho+seção+catálogo (T3). ✔
- **Placeholders:** nenhum — SQL e TSX completos. A "Nota" sobre `listarDefeitos` (vive em `lancamento-repository`) é conformidade com o código real, não lacuna.
- **Consistência:** `p_defeitos_constatados`/`defeitosConstatados`/`constatados` alinhados entre RPC (T1), args+action (T2) e UI (T3); erro `SEM_CONSTATADOS_DEFEITO` definido no RPC e mapeado em MENSAGENS. ✔
- **Riscos:** RPC redefinido com drop da assinatura antiga (precedente na 0033/sf_lancar). Migração aplicada no Dev pelo controlador após T1. Datalist só sugere ao digitar (combobox é backlog).
