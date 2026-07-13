# Seções Recebimento/Qualidade + status dinâmico (#7 + #3a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Conferência dividida em seções Recebimento/Qualidade independentes (cada uma com Salvar próprio e responsável), e status terminal dinâmico dirigido pela lista "Resultado".

**Architecture:** Migração 0015 (colunas + status sem constraint fixa + config). Domínio puro (ciclo-vida com terminais dinâmicos; calculos sem `usuario_primeiro`). Infra (tipos + valores de status para o filtro). Application (uma action de salvar por seção + finalizar/reabrir ajustados; remover cancelar). UI (formulário em seções, ações, badges, filtro).

**Tech Stack:** Next.js 16 (Server Actions), TS strict, Supabase (RLS), Tailwind, Vitest.

## Global Constraints
- Domínio em TS puro (sem Supabase/Next). Datas como string; nada de `new Date()` para chave/fuso.
- **Status:** fixos `aberto`, `em_conferencia`; terminais = **valores da lista "Resultado"** (o status guardado é o valor do campo `resultado`, ex.: `"Aprovado"`). Terminal = `!['aberto','em_conferencia'].includes(status)`.
- **Salvar por seção:** Recebimento salva Comercial+Material+Recebimento (+ `responsavel_recebimento`); Qualidade salva Comercial+Material+Qualidade (+ `responsavel_qualidade`). Responsável = **último que salvou**. 1º save promove `aberto→em_conferencia`.
- **Finalizar:** exige só `resultado` preenchido → `status = valor de resultado`. **Reabrir:** terminal → `em_conferencia`.
- **Removidos:** campo/coluna `responsavel_contagem`, o Salvar único, o Cancelar (botão+ação+status).
- **Part Number recebido** passa para o grupo `qualidade` (1º item).
- Migração roda em **produção sem dados reais** (confirmado).
- Código que fala com Supabase é verificado por `tsc`/lint/build + smoke (padrão do projeto); TDD nos domínios.

---

### Task 1: Migração 0015 (banco: colunas, status, config, RLS)

**Files:**
- Create: `supabase/migrations/0015_secoes_status_dinamico.sql`

> Sem teste automatizado (SQL). O **controller aplica** em produção (`supabase db push`) após revisar o arquivo, antes do smoke.

- [ ] **Step 1: Escrever a migração**

```sql
-- #7 + #3a: seções Recebimento/Qualidade + status dinâmico.

-- 1) Status: remove a constraint fixa (os terminais agora são dinâmicos =
--    valores da lista "Resultado"). Normaliza dados de teste antigos.
alter table public.processos_recebimento drop constraint if exists processos_recebimento_status_check;
update public.processos_recebimento set status = 'em_conferencia'
  where status in ('finalizado', 'cancelado');

-- 2) Responsáveis por seção (último que salvou); remove o responsável de contagem.
alter table public.processos_recebimento
  add column responsavel_recebimento uuid references public.usuarios(id),
  add column responsavel_qualidade  uuid references public.usuarios(id),
  drop column if exists responsavel_contagem;

-- 3) Config de campos: PN recebido vai para Qualidade (1º item); remove o
--    responsável de contagem; obrigatório na finalização passa a ser só o resultado.
update public.configuracao_campos set grupo = 'qualidade', ordem = 235 where campo = 'part_number_recebido';
delete from public.configuracao_campos where campo = 'responsavel_contagem';
update public.configuracao_campos set obrigatorio_finalizacao = (campo = 'resultado');

-- 4) Lista "Resultado" ganha os status terminais iniciais (Admin pode adicionar mais).
insert into public.lista_itens (lista_id, valor, ativo, ordem)
  select l.id, v.valor, true, v.ordem
  from public.listas l
  cross join (values ('Aprovado', 1), ('Reprovado', 2)) as v(valor, ordem)
  where l.chave = 'resultado'
  on conflict do nothing;

-- 5) RLS: "concluído" deixa de ser = 'finalizado' e passa a ser "não é
--    aberto/em_conferencia" (cobre qualquer terminal dinâmico). Remove o cancelado.
drop policy processos_update on public.processos_recebimento;
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status in ('aberto', 'em_conferencia') or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status in ('aberto', 'em_conferencia')
         or public.tem_permissao('finalizar')
         or public.tem_permissao('editar_finalizado'))
  );
```

> **Nota ao implementer:** confirme os nomes exatos das colunas de `lista_itens` (provavelmente `lista_id, valor, ativo, ordem`) lendo `supabase/migrations/0002_listas.sql` antes de finalizar o INSERT; ajuste se divergir. O nome da constraint (`processos_recebimento_status_check`) usa `drop ... if exists`, então é tolerante.

- [ ] **Step 2: Commit** (o controller aplica com `supabase db push` depois)

```bash
git add "supabase/migrations/0015_secoes_status_dinamico.sql"
git commit -m "feat(processos): migração 0015 — seções, responsáveis, status dinâmico, RLS"
```

---

### Task 2: Domínio — ciclo de vida com terminais dinâmicos (TDD)

**Files:**
- Modify: `src/modules/recebimento/domain/ciclo-vida.ts` (reescrever)
- Test: `src/modules/recebimento/domain/__tests__/ciclo-vida.test.ts` (reescrever os casos de transição)

**Interfaces:**
- Produces: `type StatusProcesso = string`; `STATUS_ABERTO`, `STATUS_EM_CONFERENCIA`; `ehTerminal(status)`, `podePromoverParaConferencia(status)`, `podeFinalizar(status)`, `podeReabrir(status)`, `camposFaltantesFinalizacao(valores, campos)` (inalterado).

- [ ] **Step 1: Reescrever o teste** (`__tests__/ciclo-vida.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import {
  ehTerminal,
  podePromoverParaConferencia,
  podeFinalizar,
  podeReabrir,
  camposFaltantesFinalizacao,
} from '../ciclo-vida'

describe('ehTerminal', () => {
  it('aberto/em_conferencia não são terminais', () => {
    expect(ehTerminal('aberto')).toBe(false)
    expect(ehTerminal('em_conferencia')).toBe(false)
  })
  it('qualquer outro valor (valor do Resultado) é terminal', () => {
    expect(ehTerminal('Aprovado')).toBe(true)
    expect(ehTerminal('Reprovado')).toBe(true)
    expect(ehTerminal('Aprovado condicional')).toBe(true)
  })
})

describe('transições', () => {
  it('promove só a partir de aberto', () => {
    expect(podePromoverParaConferencia('aberto')).toBe(true)
    expect(podePromoverParaConferencia('em_conferencia')).toBe(false)
    expect(podePromoverParaConferencia('Aprovado')).toBe(false)
  })
  it('finaliza só a partir de em_conferencia', () => {
    expect(podeFinalizar('em_conferencia')).toBe(true)
    expect(podeFinalizar('aberto')).toBe(false)
    expect(podeFinalizar('Aprovado')).toBe(false)
  })
  it('reabre só a partir de um terminal', () => {
    expect(podeReabrir('Aprovado')).toBe(true)
    expect(podeReabrir('Reprovado')).toBe(true)
    expect(podeReabrir('em_conferencia')).toBe(false)
    expect(podeReabrir('aberto')).toBe(false)
  })
})

describe('camposFaltantesFinalizacao', () => {
  it('lista os obrigatórios vazios', () => {
    const campos = [
      { campo: 'resultado', obrigatorioFinalizacao: true },
      { campo: 'observacao', obrigatorioFinalizacao: false },
    ]
    expect(camposFaltantesFinalizacao({ resultado: '', observacao: 'x' }, campos)).toEqual(['resultado'])
    expect(camposFaltantesFinalizacao({ resultado: 'Aprovado' }, campos)).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar → falha** — `npx vitest run src/modules/recebimento/domain/__tests__/ciclo-vida.test.ts` (símbolos não existem).

- [ ] **Step 3: Reescrever `ciclo-vida.ts`**

```ts
// Status: 'aberto' e 'em_conferencia' são fixos; os terminais são dinâmicos —
// o valor do campo `resultado` (ex.: 'Aprovado', 'Reprovado', ou o que o Admin
// adicionar à lista "Resultado"). Por isso StatusProcesso é `string`.
export type StatusProcesso = string

export const STATUS_ABERTO = 'aberto'
export const STATUS_EM_CONFERENCIA = 'em_conferencia'

/** Um status é terminal (processo concluído) se não é aberto nem em conferência. */
export function ehTerminal(status: StatusProcesso): boolean {
  return status !== STATUS_ABERTO && status !== STATUS_EM_CONFERENCIA
}

/** `aberto` → `em_conferencia` (promoção automática no 1º salvamento). */
export function podePromoverParaConferencia(status: StatusProcesso): boolean {
  return status === STATUS_ABERTO
}

/** Finalizar (concluir) só a partir de `em_conferencia`. */
export function podeFinalizar(status: StatusProcesso): boolean {
  return status === STATUS_EM_CONFERENCIA
}

/** Reabrir só a partir de um status terminal → volta para `em_conferencia`. */
export function podeReabrir(status: StatusProcesso): boolean {
  return ehTerminal(status)
}

/**
 * Lista os campos `obrigatorioFinalizacao` cujo valor está vazio, na ordem em
 * que aparecem. Usado para bloquear a finalização (hoje só `resultado`).
 */
export function camposFaltantesFinalizacao(
  valores: Record<string, unknown>,
  campos: { campo: string; obrigatorioFinalizacao: boolean }[],
): string[] {
  return campos
    .filter((c) => c.obrigatorioFinalizacao)
    .filter((c) => {
      const v = valores[c.campo]
      return v === null || v === undefined || String(v).trim() === ''
    })
    .map((c) => c.campo)
}
```

- [ ] **Step 4: Rodar → passa.** `npx tsc --noEmit` também (o tipo `StatusProcesso` mudou; ver Task 4 para consumidores).
- [ ] **Step 5: Commit** — `git commit -m "feat(processos): ciclo de vida com status terminal dinâmico (TDD)"`

> **Nota:** este passo troca `StatusProcesso` para `string` e remove `podeTransicionar`. Consumidores diretos (`transicoes-processo.ts`, `salvar-processo.ts`, `processo-detalhe-repository.ts`) são atualizados nas Tasks 4/5 — o `tsc` pode acusar erros nesses arquivos até lá; isso é esperado dentro desta sequência. Commit este passo mesmo com erros nos consumidores (serão resolvidos nas próximas tasks) OU, se preferir manter o `tsc` verde a cada commit, faça Tasks 2/4/5 juntas antes de rodar `tsc`. (Recomendado: rode Tasks 2→4→5 e só então `tsc` verde.)

---

### Task 3: Domínio — remover `usuario_primeiro` do cálculo + badges de status

**Files:**
- Modify: `src/modules/recebimento/domain/calculos.ts` (remover o `case`)
- Modify: `src/modules/recebimento/domain/__tests__/calculos.test.ts` (remover o teste do caso)
- Modify: `src/modules/recebimento/domain/status-processo.ts` (badges)
- Modify: `src/modules/recebimento/domain/__tests__/status-processo.test.ts` (ajustar rótulos)

**Interfaces:**
- `calcularCamposCalculados` mantém a assinatura; só deixa de tratar a fórmula `usuario_primeiro` (o campo `responsavel_contagem` já não existe após a Task 1, então nada mais usa essa fórmula).

- [ ] **Step 1: Remover o `case 'usuario_primeiro'`** em `calculos.ts` (linhas 78-85 do bloco `switch`). Deixe os outros casos. `ContextoCalculo` fica como está (os campos `usuarioAtual`/`valoresAtuais` continuam no tipo, ainda passados pelos chamadores — sem ripple).

- [ ] **Step 2: Remover o teste do `usuario_primeiro`** em `__tests__/calculos.test.ts` (o(s) `it` que exercita(m) essa fórmula). Rode `npx vitest run src/modules/recebimento/domain/__tests__/calculos.test.ts` → verde.

- [ ] **Step 3: Atualizar badges** em `status-processo.ts` — trocar os mapas para o novo vocabulário (o fallback já cobre terminais dinâmicos desconhecidos):

```ts
const ROTULOS: Record<string, string> = {
  aberto: 'Aberto',
  em_conferencia: 'Em conferência',
}

const CORES: Record<string, string> = {
  aberto: 'bg-slate-50 text-slate-600 ring-1 ring-slate-500/25',
  em_conferencia: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/30',
  Aprovado: 'bg-green-50 text-green-700 ring-1 ring-green-600/30',
  Reprovado: 'bg-red-50 text-red-700 ring-1 ring-red-600/30',
}
```
(Mantém `COR_PADRAO` e a função `rotuloStatusProcesso` como estão — para um terminal novo/desconhecido, cai no rótulo bruto + cor neutra.)

- [ ] **Step 4: Ajustar `__tests__/status-processo.test.ts`** — remover asserts de `finalizado`/`cancelado`; garantir que `rotuloStatusProcesso('Aprovado').rotulo === 'Aprovado'` e que um status desconhecido cai no rótulo bruto. Rode o teste → verde.

- [ ] **Step 5: Commit** — `git commit -m "feat(processos): remove usuario_primeiro do cálculo + badges de status dinâmico"`

---

### Task 4: Infra — tipos do repositório de detalhe + valores de status para o filtro

**Files:**
- Modify: `src/modules/recebimento/infra/processo-detalhe-repository.ts`
- Modify/Create: função para listar os valores de status do filtro (ver Step 3)

- [ ] **Step 1: Atualizar `ProcessoRow`** — remover `responsavel_contagem`; adicionar `responsavel_recebimento: string | null` e `responsavel_qualidade: string | null` (na seção recebimento/auditoria). `status` continua tipado como `StatusProcesso` (agora `string`).

- [ ] **Step 2: Atualizar `ColunaGravavel` + `COLUNAS_GRAVAVEIS`** — remover `'responsavel_contagem'`; adicionar `'responsavel_recebimento'` e `'responsavel_qualidade'`. (Manter `motivo_cancelamento`/`cancelado_por` na lista é inofensivo, mas podem ser removidos já que o cancelamento saiu — decisão do implementer; se remover, remova também de `ProcessoRow`? NÃO: as colunas continuam no banco, então mantenha em `ProcessoRow`; só tire de `COLUNAS_GRAVAVEIS`/`ColunaGravavel` se quiser impedir gravação. Recomendado: manter como está para minimizar mudança.)

- [ ] **Step 3: Adicionar `listarValoresStatus()`** — retorna os valores possíveis de status para o filtro (`aberto`, `em_conferencia` + itens da lista "Resultado"). Implemente lendo os itens ativos da lista `resultado` (siga o padrão de `carregarItensPorLista`/`lista-repository`):

```ts
// Em processo-detalhe-repository.ts (ou num repo de referências): retorna os
// status possíveis para o filtro da lista de Processos.
export async function listarValoresStatus(): Promise<{ valor: string; rotulo: string }[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('lista_itens')
    .select('valor, listas!inner(chave)')
    .eq('listas.chave', 'resultado')
    .eq('ativo', true)
    .order('ordem', { ascending: true })
  if (error) throw error
  const terminais = ((data ?? []) as { valor: string }[]).map((r) => ({ valor: r.valor, rotulo: r.valor }))
  return [
    { valor: 'aberto', rotulo: 'Aberto' },
    { valor: 'em_conferencia', rotulo: 'Em conferência' },
    ...terminais,
  ]
}
```
> **Nota:** confirme a forma do join `lista_itens`→`listas` no schema (0002). Se o embedding `listas!inner(chave)` não bater, faça em 2 passos (buscar `id` da lista `resultado`, depois `lista_itens` por `lista_id`). Verifique com `npx tsc --noEmit`.

- [ ] **Step 4: `npx tsc --noEmit`** — corrija consumidores de `ProcessoRow`/status conforme necessário (o detalhe/page e o save são tratados nas Tasks 5/7). Commit — `git commit -m "feat(processos): tipos do repositório (responsáveis por seção) + valores de status"`

---

### Task 5: Application — salvar por seção + finalizar/reabrir + remover cancelar

**Files:**
- Create: `src/modules/recebimento/application/salvar-secao-processo.ts` (substitui `salvar-processo.ts`)
- Delete: `src/modules/recebimento/application/salvar-processo.ts`
- Modify: `src/modules/recebimento/application/transicoes-processo.ts` (finalizar/reabrir; remover cancelar)

**Interfaces:**
- Produces: `salvarSecaoProcesso(id: string, secao: 'recebimento' | 'qualidade', valores: Record<string, unknown>): Promise<{ ok: true } | { ok: false; erro: string }>`; `finalizarProcesso(id)`, `reabrirProcesso(id)` (assinaturas mantidas). Remove `cancelarProcesso`.

- [ ] **Step 1: Criar `salvar-secao-processo.ts`** — baseado no `salvar-processo.ts` atual, com estas mudanças: (a) recebe `secao`; (b) só aceita campos cujo `grupo` ∈ {comercial, material, `secao`}; (c) usa `ehTerminal`/`podePromoverParaConferencia` no lugar dos literais `'cancelado'/'finalizado'/'aberto'`; (d) carimba o responsável da seção.

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { ehTerminal, podePromoverParaConferencia, STATUS_EM_CONFERENCIA } from '../domain/ciclo-vida'
import { calcularCamposCalculados, type CampoCalc } from '../domain/calculos'
import { converterValor } from '../domain/conversao'
import {
  atualizarProcesso,
  buscarProcesso,
  carregarCamposFormulario,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'

export type Secao = 'recebimento' | 'qualidade'
export type ResultadoSalvarProcesso = { ok: true } | { ok: false; erro: string }

/**
 * Salva uma seção de conferência (recebimento OU qualidade). Ambas gravam
 * também os campos base (comercial + material). Carimba o responsável da seção
 * = usuário que salvou (último). 1º save promove aberto → em_conferencia.
 */
export async function salvarSecaoProcesso(
  id: string,
  secao: Secao,
  valores: Record<string, unknown>,
): Promise<ResultadoSalvarProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para editar processos.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }
  if (ehTerminal(processo.status) && !podeFazer(sessao.perfil, 'editar_finalizado')) {
    return { ok: false, erro: 'Você não tem permissão para editar um processo concluído.' }
  }

  const campos = await carregarCamposFormulario()
  const gruposAceitos = new Set(['comercial', 'material', secao])
  const camposPorNome = new Map(campos.map((c) => [c.campo, c]))
  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))

  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []
  for (const [campo, bruto] of Object.entries(valores)) {
    const config = camposPorNome.get(campo)
    if (!config) continue
    if (!gruposAceitos.has(config.grupo)) continue // campo de outra seção → ignora
    if (config.calculado) continue
    const r = converterValor(bruto, config.tipo)
    if (!r.ok) return { ok: false, erro: `${config.rotulo}: ${r.erro}` }
    novosValores[campo] = r.valor
    camposAlterados.push(campo)
  }

  const valoresAtuais = processo as unknown as Record<string, unknown>
  const valoresParaCalculo: Record<string, unknown> = { ...valoresAtuais, ...novosValores }
  const [fornecedoresCriticos, nqa] = await Promise.all([carregarCriticidade(), carregarTabelaNqa()])
  const resultadoCalculo = calcularCamposCalculados(valoresParaCalculo, camposCalculados, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
    valoresAtuais,
  })
  const camposCalculadosAlterados: string[] = []
  for (const [campo, valor] of Object.entries(resultadoCalculo)) {
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
    camposCalculadosAlterados.push(campo)
  }

  const diff = calcularDiff(
    processo as unknown as Record<string, unknown>,
    novosValores,
    [...camposAlterados, ...camposCalculadosAlterados],
  )

  const patch: PatchProcesso = { ...(novosValores as PatchProcesso), atualizado_por: sessao.usuarioId }
  if (secao === 'recebimento') patch.responsavel_recebimento = sessao.usuarioId
  else patch.responsavel_qualidade = sessao.usuarioId
  const promove = podePromoverParaConferencia(processo.status)
  if (promove) patch.status = STATUS_EM_CONFERENCIA

  try {
    await atualizarProcesso(id, patch)
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Processo #${processo.numero} — seção ${secao} salva`,
    dados: diff,
  })
  if (promove) {
    await registrarLog({
      entidade: 'processo',
      entidadeId: id,
      acao: 'mudar_status',
      descricao: `Processo #${processo.numero}: aberto → em_conferencia`,
      dados: { de: 'aberto', para: 'em_conferencia' },
    })
  }

  revalidatePath(`/recebimento/processos/${id}`)
  return { ok: true }
}
```

> `PatchProcesso` precisa aceitar `responsavel_recebimento`/`responsavel_qualidade` (Task 4). Se `sessao.usuarioId` não existir com esse nome, confira `getSessao` e ajuste (o `salvar-processo.ts` atual já usa `sessao.usuarioId`).

- [ ] **Step 2: Ajustar `transicoes-processo.ts`** — `finalizarProcesso`: usar `podeFinalizar(status)`; validar `camposFaltantesFinalizacao` (= só resultado); gravar `status = String(processo.resultado ?? '')`; se `resultado` vazio → erro "Preencha o Resultado.". `reabrirProcesso`: `podeReabrir(status)` → `em_conferencia` (limpa finalizado_por/em). **Remover `cancelarProcesso`.** Trocar imports de `podeTransicionar` por `podeFinalizar`/`podeReabrir`/`camposFaltantesFinalizacao`.

```ts
// finalizarProcesso — trecho central (mantém checagem de permissão editar+finalizar):
if (!podeFinalizar(processo.status)) {
  return { ok: false, erro: 'Este processo não pode ser finalizado no status atual.' }
}
const campos = await carregarCamposFormulario()
const faltantes = camposFaltantesFinalizacao(processo as unknown as Record<string, unknown>, campos)
if (faltantes.length > 0) {
  const rotulos = campos.filter((c) => faltantes.includes(c.campo)).map((c) => c.rotulo)
  return { ok: false, erro: `Preencha os campos obrigatórios: ${rotulos.join(', ')}.` }
}
const novoStatus = String(processo.resultado ?? '').trim()
if (!novoStatus) return { ok: false, erro: 'Preencha o Resultado para finalizar.' }
await atualizarProcesso(id, {
  status: novoStatus,
  finalizado_por: sessao.usuarioId,
  finalizado_em: new Date().toISOString(),
})
// log mudar_status: de statusAnterior para novoStatus
```
(reabrir: trocar `processo.status !== 'finalizado'` por `!podeReabrir(processo.status)`; grava `status: STATUS_EM_CONFERENCIA`.)

- [ ] **Step 3: Deletar `salvar-processo.ts`** (`git rm`). Buscar referências: `grep -rn "salvar-processo\|salvarProcesso\|cancelarProcesso" src/` e atualizar (o form em Task 6; qualquer outro import).

- [ ] **Step 4: `npx tsc --noEmit && npm run lint`** → verde. Commit — `git commit -m "feat(processos): salvar por seção + finalizar dinâmico + remove cancelar"`

---

### Task 6: UI — formulário em seções com dois Salvar

**Files:**
- Modify: `src/app/(app)/recebimento/processos/[id]/processo-form.tsx`
- Modify (se necessário): `src/app/(app)/recebimento/processos/[id]/processo-detalhe.tsx` (wrapper dirty-state) — ajustar dirty por seção

**Objetivo:** renderizar **Comercial + Material** (editáveis) no topo; **seção Recebimento** (campos do grupo `recebimento` + botão **Salvar Recebimento**); **seção Qualidade** (campos do grupo `qualidade`, PN recebido 1º pela `ordem` + botão **Salvar Qualidade**). Cada botão chama `salvarSecaoProcesso(processoId, secao, valoresDaBaseMaisSecao)`.

- [ ] **Step 1:** Trocar o import/uso de `salvarProcesso` por `salvarSecaoProcesso` (de `../../../../modules/recebimento/application/salvar-secao-processo`, use alias `@/`). Remover o botão Salvar único.

- [ ] **Step 2:** Agrupar os campos por `grupo`. Manter Comercial/Material como cards de topo (editáveis, como hoje). Para as seções Recebimento e Qualidade, ao final de cada uma renderizar um botão **Salvar** que:
  - monta o payload com os valores dos grupos `comercial`, `material` e o grupo da seção (não-calculados);
  - chama `salvarSecaoProcesso(processoId, 'recebimento'|'qualidade', payload)` dentro de `startTransition`;
  - `toast.success('Recebimento salvo.')` / `'Qualidade salva.'` ou `toast.error(r.erro)`.
  - fica desabilitado em `somenteLeitura` ou durante o transition.

```tsx
// Helper de payload (base + uma seção), reaproveitando `campos` e `valores`:
function payloadSecao(secao: 'recebimento' | 'qualidade'): Record<string, unknown> {
  const gruposAceitos = new Set(['comercial', 'material', secao])
  const payload: Record<string, unknown> = {}
  for (const campo of campos) {
    if (campo.calculado) continue
    if (!gruposAceitos.has(campo.grupo)) continue
    const bruto = valores[campo.campo] ?? ''
    payload[campo.campo] = campo.tipo === 'numero' ? (bruto === '' ? null : Number(bruto)) : bruto
  }
  return payload
}
// Botão por seção:
function onSalvarSecao(secao: 'recebimento' | 'qualidade') {
  startTransition(async () => {
    const r = await salvarSecaoProcesso(processoId, secao, payloadSecao(secao))
    if (r.ok) toast.success(secao === 'recebimento' ? 'Recebimento salvo.' : 'Qualidade salva.')
    else toast.error(r.erro)
  })
}
```

- [ ] **Step 3:** Renderizar o botão **Salvar Recebimento** ao final do card do grupo `recebimento` e **Salvar Qualidade** ao final do card do grupo `qualidade`. Comercial/Material seguem sem botão próprio (são salvos por qualquer um dos dois).

- [ ] **Step 4:** Ajustar o dirty-state (usado para bloquear Finalizar com alterações não salvas) — hoje é um `dirty` único no `processo-detalhe.tsx`. Simplificar: manter um `dirty` global (qualquer campo não-calculado alterado) que bloqueia Finalizar; **ou** por seção. Recomendado v1: manter o `dirty` global existente (bloqueia Finalizar enquanto houver QUALQUER alteração não salva). Não introduza dirty-por-seção agora (YAGNI).

- [ ] **Step 5:** `npx tsc --noEmit && npm run lint && npm run build` → verde. Commit — `git commit -m "feat(processos): formulário em seções com Salvar por seção"`

> **Nota ao implementer:** leia `processo-form.tsx` e `processo-detalhe.tsx` atuais antes de editar; preserve o padrão de `CampoControle`, o cálculo ao vivo (`calcularCamposCalculados`) e a renderização read-only dos calculados. O campo `responsavel_contagem` sai naturalmente (não vem mais de `configuracao_campos`).

---

### Task 7: UI — ações (finalizar/reabrir, sem cancelar) + filtro de status + página de detalhe

**Files:**
- Modify: `src/app/(app)/recebimento/processos/[id]/acoes-processo.tsx`
- Modify: `src/app/(app)/recebimento/processos/[id]/page.tsx`
- Modify: `src/app/(app)/recebimento/processos/processos-filtros.tsx`

- [ ] **Step 1: `acoes-processo.tsx`** — remover `BotaoCancelar` e todo o fluxo de cancelamento (dialog/motivo) e o import de `cancelarProcesso`. Manter `BotaoFinalizar` (mostra em `em_conferencia`) e `BotaoReabrir` (mostra em terminal). Trocar a condição de "reabrir" para `status !== 'aberto' && status !== 'em_conferencia'` (terminal). Remover props `podeExcluir` se ficarem sem uso.

- [ ] **Step 2: `[id]/page.tsx`** — atualizar `editavelPorStatus`: `aberto|em_conferencia` → `podeEditar`; senão (terminal) → `podeEditarFinalizado`. Remover a menção a `finalizado`/`cancelado` literais. Passar para o detalhe os nomes dos responsáveis por seção, se quiser exibi-los (opcional v1: exibir `responsavel_recebimento`/`responsavel_qualidade` — pode ser adiado).

- [ ] **Step 3: `processos-filtros.tsx`** — trocar a constante `STATUS` fixa por valores carregados do banco. Como é client component, receba os status por prop: a página da lista (`processos/page.tsx`, feature 3b) passa `statusOpcoes` (via `listarValoresStatus()` da Task 4) para `<ProcessosFiltros statusOpcoes={...} />`. Ajustar `processos/page.tsx` para carregar e passar. (Alternativa: manter fixo `aberto`/`em_conferencia` + buscar os terminais — mas a prop é mais limpo.)

- [ ] **Step 4:** `npx tsc --noEmit && npm run lint && npm run build` → verde. Commit — `git commit -m "feat(processos): ações sem cancelar + filtro de status dinâmico"`

---

### Task 8: Verificação final + smoke

- [ ] **Step 1:** `npx tsc --noEmit && npm run lint && npx vitest run && npm run build` → tudo verde.
- [ ] **Step 2 (controller):** aplicar a migração 0015 em produção (`supabase db push`) e recarregar o schema cache (`notify pgrst, 'reload schema'`) se a `listarValoresStatus` usar embedding novo.
- [ ] **Step 3: Smoke** (`npm run dev`, localhost:3000):
  - Abrir um processo: ver Comercial/Material + seção Recebimento (com Salvar) + seção Qualidade (PN recebido 1º, com Salvar). Sem "responsável contagem", sem Salvar único, sem Cancelar.
  - Salvar Recebimento → grava e carimba responsável recebimento; Salvar Qualidade → idem qualidade. Independentes.
  - Preencher Resultado = Aprovado → Finalizar → status vira "Aprovado" (badge verde). Reabrir → volta "Em conferência".
  - Filtro de status na lista mostra Aberto/Em conferência/Aprovado/Reprovado.
- [ ] **Step 4:** Nada a commitar (verificação). Fim.

---

## Self-Review
- **Cobertura da spec:** seções independentes + 2 saves (Task 5/6), responsáveis por seção (Task 1 colunas + Task 5 carimbo), remover responsavel_contagem (Task 1/3/4), remover Salvar único e Cancelar (Task 5/6/7), PN→qualidade (Task 1), status dinâmico (Task 2 domínio + Task 1 sem constraint + Task 3 badges + Task 7 filtro), Finalizar só resultado (Task 1 obrigatoriedade + Task 5 finalizar), Reabrir (Task 5), RLS (Task 1), migração segura (Task 1/8). ✔
- **Placeholders:** as tasks de UI (6/7) são de modificação e referenciam os arquivos atuais com os blocos de código novos — sem "TBD"; o implementer lê o componente atual e aplica as mudanças descritas. ✔
- **Consistência de tipos:** `StatusProcesso=string`, `STATUS_ABERTO/EM_CONFERENCIA`, `ehTerminal/podeFinalizar/podeReabrir/podePromoverParaConferencia`, `salvarSecaoProcesso(id,secao,valores)`, `PatchProcesso` com responsáveis, `listarValoresStatus()` — usados com as mesmas assinaturas entre tasks. ✔
- **Nota de sequência:** Tasks 2→4→5 mudam um tipo compartilhado (`StatusProcesso`) e removem `salvarProcesso`; rodar o `tsc` verde só ao fim da Task 5 (documentado na Task 2).
