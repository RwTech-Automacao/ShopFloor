# Consultar / Cancelar Integração — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer de volta a consulta/cancelamento de Integração como aba própria em Operar (`Lançamento | Consultar Integração | Manutenção`), reusando o backend órfão, e corrigir o produto-em-vários-postos.

**Architecture:** `buscarIntegracaoPorSn` vira `buscarIntegracoesPorSn` (lista, pois um produto pode estar em N integrações — uma por posto); `IntegracaoDetalhe` ganha `posto`; a rota `operar/integracao` deixa de redirecionar e vira a tela (server component + client form com busca por SN + cancelar via `useConfirmacao`).

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TS strict, Supabase, sonner, base-ui.

## Global Constraints

- **Sem migração** — reusa RPC/actions/colunas existentes (`sf_integracoes.posto` já existe desde 0066).
- **Fiel à antiga** + 2 modernizações: `useConfirmacao` (não `window.confirm`) e campo bipe-friendly (autoFocus, Enter busca, refoca).
- **Cancelar exige `administrar`** (`podeCancelar`); **ver exige `lancar`**. Não-admin não vê o botão.
- **Nomes canônicos:** `buscarIntegracoesPorSn(snNorm): Promise<IntegracaoDetalhe[]>`; `IntegracaoDetalhe.posto: string`; `buscarIntegracao(sn)` devolve `{ ok: true; detalhes: IntegracaoDetalhe[] } | { ok: false; erro }`; componente `ConsultaIntegracaoForm({ podeCancelar })`.
- **PT-BR**; commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Build/lint/test verdes ao fim de cada task:** `npm run build` (se OOM, `NODE_OPTIONS=--max-old-space-size=6144 npm run build`), `npm run lint`, `npm test`.

---

## File Structure

- **Modify** `src/modules/shopfloor/infra/integracao-repository.ts` — `posto` em Row/Detalhe/CAMPOS_HDR/montarDetalhe; `buscarIntegracaoPorSn` → `buscarIntegracoesPorSn` (lista).
- **Modify** `src/modules/shopfloor/application/integracao-actions.ts` — `buscarIntegracao` (lista) + `resolverPlacaIntegracaoAction` (ajuste do consumidor).
- **Modify** `src/app/(app)/shopfloor/operar/layout.tsx` — aba entre Lançamento e Manutenção.
- **Modify** `src/app/(app)/shopfloor/operar/integracao/page.tsx` — de redirect para a tela (server component).
- **Create** `src/app/(app)/shopfloor/operar/integracao/consulta-integracao-form.tsx` — client form.

> **Dead code intocado:** `listarOrdensParaIntegracao`/`OrdemIntegracao` seguem sem uso (limpeza no backlog).

---

## Task 1: Backend — busca em lista + `posto`

**Files:**
- Modify: `src/modules/shopfloor/infra/integracao-repository.ts`
- Modify: `src/modules/shopfloor/application/integracao-actions.ts`

**Interfaces:**
- Produces: `IntegracaoDetalhe.posto: string`; `buscarIntegracoesPorSn(snNorm: string): Promise<IntegracaoDetalhe[]>`; `buscarIntegracao(sn): { ok: true; detalhes: IntegracaoDetalhe[] } | { ok: false; erro: string }` (consumido pela Task 2).

> Sem teste unitário novo (infra/DB + server action). Verificação: build+lint+test (322 testes seguem verdes).

- [ ] **Step 1: `integracao-repository.ts` — `posto` + busca em lista**

Em `ItemIntegracao`/`IntegracaoDetalhe`, acrescentar `posto` ao **detalhe**:
```ts
export interface IntegracaoDetalhe {
  codigo: string
  dataHora: string
  colaborador: string
  cliente: string
  pmo: string
  op: string
  posto: string
  produtoSn: string
  qtdPlacas: number
  itens: ItemIntegracao[]
}
```
Em `IntegracaoRow`, acrescentar `posto: string`. Em `montarDetalhe`, incluir `posto: row.posto` no objeto devolvido. Em `CAMPOS_HDR`, acrescentar `,posto`:
```ts
const CAMPOS_HDR = 'id,codigo,data_hora,colaborador,cliente,pmo,op,produto_sn,qtd_placas,posto'
```
**Substituir** `buscarIntegracaoPorSn` por `buscarIntegracoesPorSn` (lista, sem `maybeSingle`):
```ts
/** TODAS as integrações ATIVAS em que o SN aparece como produto OU placa (produto pode
 *  estar em várias — uma por posto). Dedup por código, ordenadas por data desc. */
export async function buscarIntegracoesPorSn(snNorm: string): Promise<IntegracaoDetalhe[]> {
  const supabase = await createServerSupabase()

  // como PRODUTO (pode haver N)
  const { data: prods, error: e1 } = await supabase
    .from('sf_integracoes')
    .select(CAMPOS_HDR)
    .eq('produto_sn_norm', snNorm)
    .eq('status', 'ATIVA')
  if (e1) throw e1

  // como PLACA
  const { data: itens, error: e2 } = await supabase
    .from('sf_integracao_itens')
    .select('sf_integracoes!inner(id,codigo,data_hora,colaborador,cliente,pmo,op,produto_sn,qtd_placas,posto,status)')
    .eq('placa_sn_norm', snNorm)
    .eq('sf_integracoes.status', 'ATIVA')
  if (e2) throw e2

  const rows: IntegracaoRow[] = [
    ...((prods ?? []) as unknown as IntegracaoRow[]),
    ...((itens ?? []) as unknown as { sf_integracoes: IntegracaoRow }[]).map((i) => i.sf_integracoes),
  ]
  const porCodigo = new Map<string, IntegracaoRow>()
  for (const r of rows) if (!porCodigo.has(r.codigo)) porCodigo.set(r.codigo, r)
  const detalhes = await Promise.all([...porCodigo.values()].map(montarDetalhe))
  return detalhes.sort((a, b) => (a.dataHora < b.dataHora ? 1 : -1))
}
```
(Remover a antiga `buscarIntegracaoPorSn`.)

- [ ] **Step 2: `integracao-actions.ts` — ajustar os dois consumidores**

No import, trocar `buscarIntegracaoPorSn` por `buscarIntegracoesPorSn`.

Em `resolverPlacaIntegracaoAction` (o aviso "placa já vinculada" no bipe), trocar:
```ts
const jaVinculada = await buscarIntegracaoPorSn(normalizarSerie(sn))
if (jaVinculada) {
  return { ok: false, erro: `Placa já vinculada à integração ${jaVinculada.codigo}.` }
}
```
por:
```ts
const vinc = await buscarIntegracoesPorSn(normalizarSerie(sn))
if (vinc.length > 0) {
  return { ok: false, erro: `Placa já vinculada à integração ${vinc[0]!.codigo}.` }
}
```

Trocar a action `buscarIntegracao` pela versão em lista:
```ts
export async function buscarIntegracao(
  sn: string,
): Promise<{ ok: true; detalhes: IntegracaoDetalhe[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, detalhes: [] }
  try {
    const detalhes = await buscarIntegracoesPorSn(alvo)
    return { ok: true, detalhes }
  } catch {
    return { ok: false, erro: MENSAGENS.ERRO_INTERNO! }
  }
}
```
(`cancelarIntegracao` fica **inalterada**.)

- [ ] **Step 3: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: verdes (322 testes).

- [ ] **Step 4: Commit**
```bash
git add src/modules/shopfloor/infra/integracao-repository.ts src/modules/shopfloor/application/integracao-actions.ts
git commit -m "feat(shopfloor): busca de integração por SN devolve lista + posto (produto pode estar em N postos)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Tela — aba, rota e client form

**Files:**
- Modify: `src/app/(app)/shopfloor/operar/layout.tsx`
- Modify: `src/app/(app)/shopfloor/operar/integracao/page.tsx`
- Create: `src/app/(app)/shopfloor/operar/integracao/consulta-integracao-form.tsx`

**Interfaces:**
- Consumes (Task 1): `buscarIntegracao(sn): { ok: true; detalhes: IntegracaoDetalhe[] } | { ok: false; erro }`; `IntegracaoDetalhe` (com `posto`); `cancelarIntegracao(codigo)`.
- Consumes (existente): `getSessao`, `podeNoModulo`, `SemPermissao`, `useConfirmacao`.

- [ ] **Step 1: `operar/layout.tsx` — aba no meio**

```ts
const ABAS = [
  { rotulo: 'Lançamento', href: '/shopfloor/operar/lancamento' },
  { rotulo: 'Consultar Integração', href: '/shopfloor/operar/integracao' },
  { rotulo: 'Manutenção', href: '/shopfloor/operar/manutencao' },
]
```

- [ ] **Step 2: `operar/integracao/page.tsx` — de redirect para tela**

Substituir o conteúdo por:
```tsx
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { ConsultaIntegracaoForm } from './consulta-integracao-form'

export default async function ConsultarIntegracaoPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return <SemPermissao descricao="Você não tem permissão para consultar integrações." />
  }
  const podeCancelar = podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-tinta">Consultar Integração</h2>
        <p className="text-sm text-muted-foreground">
          Bipe o Nº de Série de um produto ou de uma placa para ver a integração.
        </p>
      </div>
      <ConsultaIntegracaoForm podeCancelar={podeCancelar} />
    </div>
  )
}
```

- [ ] **Step 3: Criar `operar/integracao/consulta-integracao-form.tsx`**

```tsx
'use client'

import { useRef, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useConfirmacao } from '@/components/ui/confirm-dialog'
import { buscarIntegracao, cancelarIntegracao } from '@/modules/shopfloor/application/integracao-actions'
import type { IntegracaoDetalhe } from '@/modules/shopfloor/infra/integracao-repository'

export function ConsultaIntegracaoForm({ podeCancelar }: { podeCancelar: boolean }) {
  const [buscaSN, setBuscaSN] = useState('')
  const [detalhes, setDetalhes] = useState<IntegracaoDetalhe[]>([])
  const [buscou, setBuscou] = useState(false)
  const [ultimoSN, setUltimoSN] = useState('')
  const [buscando, startBusca] = useTransition()
  const [cancelando, startCancel] = useTransition()
  const buscaRef = useRef<HTMLInputElement>(null)
  const { confirmar, dialog } = useConfirmacao()

  function buscar(sn: string) {
    if (sn.trim() === '' || buscando) return
    startBusca(async () => {
      const r = await buscarIntegracao(sn)
      if (r.ok) {
        setDetalhes(r.detalhes)
        setBuscou(true)
        setUltimoSN(sn)
      } else {
        toast.error(r.erro)
      }
      setTimeout(() => buscaRef.current?.select(), 0)
    })
  }

  async function onCancelar(codigo: string) {
    if (cancelando) return
    const ok = await confirmar({
      titulo: `Cancelar a integração ${codigo}?`,
      descricao: 'O produto e as placas ficarão livres para re-integrar.',
      rotuloConfirmar: 'Cancelar integração',
    })
    if (!ok) return
    startCancel(async () => {
      const r = await cancelarIntegracao(codigo)
      if (r.ok) {
        toast.success('Integração cancelada.')
        buscar(ultimoSN) // re-busca: o bloco cancelado some
      } else {
        toast.error(r.erro)
      }
    })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Buscar por Nº de Série</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="buscaSN">SN do produto ou da placa</Label>
              <Input
                id="buscaSN"
                ref={buscaRef}
                value={buscaSN}
                onChange={(e) => setBuscaSN(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(buscaSN) } }}
                placeholder="Bipe o SN"
                autoComplete="off"
                autoFocus
                className="h-11"
                disabled={buscando}
              />
            </div>
            <Button variant="outline" onClick={() => buscar(buscaSN)} disabled={buscando} className="h-11">
              <Search className="mr-1 size-4" /> {buscando ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          {buscou && detalhes.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma integração ativa encontrada para esse SN.</p>
          )}

          {detalhes.map((d) => (
            <div key={d.codigo} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <p className="font-semibold text-tinta">{d.codigo}</p>
                  <p className="text-muted-foreground">
                    {d.cliente} · {d.pmo}/{d.op} · {d.posto} · {d.qtdPlacas} placa(s) · por {d.colaborador}
                  </p>
                </div>
                {podeCancelar && (
                  <Button variant="destructive" size="sm" onClick={() => onCancelar(d.codigo)} disabled={cancelando}>
                    Cancelar integração
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>PMO</TableHead>
                      <TableHead>OP</TableHead>
                      <TableHead>Nº de Série</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.itens.map((it, i) => (
                      <TableRow key={i}>
                        <TableCell className={it.tipo === 'Produto' ? 'font-medium text-enterplak' : ''}>{it.tipo}</TableCell>
                        <TableCell>{it.pmo}</TableCell>
                        <TableCell>{it.op}</TableCell>
                        <TableCell>{it.sn}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {dialog}
    </>
  )
}
```

- [ ] **Step 4: Build + lint + testes**

Run: `npm run build && npm run lint && npm test`
Expected: verdes.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/shopfloor/operar/layout.tsx" "src/app/(app)/shopfloor/operar/integracao/page.tsx" "src/app/(app)/shopfloor/operar/integracao/consulta-integracao-form.tsx"
git commit -m "feat(shopfloor): aba Consultar Integração (busca por SN + cancelar) em Operar

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Smoke (manual, ao fim da feature)

1. **Produto 1 posto:** bipa o SN de um produto integrado em 1 posto → 1 bloco (com o posto), produto + placas.
2. **Produto 2 postos:** produto integrado em 2 postos de Integração → **2 blocos** (um por posto), sem erro.
3. **Placa:** bipa o SN de uma placa → o bloco da integração dela.
4. **Cancelar (admin):** cancela → some da lista, e a re-integração daquele produto/placa deixa de barrar.
5. **Não-admin:** o botão Cancelar não aparece.
6. **Não achou:** SN inexistente → "Nenhuma integração ativa encontrada".

---

## Self-Review (checagem do autor)

- **Cobertura da spec:** §1 infra → T1; §2 actions → T1; §3 rota/aba → T2; §4 client → T2. ✔
- **Sem placeholders:** todo passo com código real. ✔
- **Consistência de tipos:** `buscarIntegracoesPorSn: Promise<IntegracaoDetalhe[]>` e `IntegracaoDetalhe.posto` (T1) usados idênticos na action e no form (T2); `buscarIntegracao` devolve `{ detalhes }` consumido por `setDetalhes(r.detalhes)`. ✔
- **Dois consumidores de `buscarIntegracaoPorSn` ajustados:** `resolverPlacaIntegracaoAction` e `buscarIntegracao` (T1). ✔
