'use client'

import { useEffect, useState, useTransition } from 'react'
import { Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { caixasDaOp, qrDaCaixa } from '@/modules/shopfloor/application/embalagem-actions'
import { pecasAntesDaCaixa } from '@/modules/shopfloor/domain/caixa'
import type { OpComCaixa, CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'

/** Pares QTD|NS por linha da folha — é o formato da planilha que a fábrica usa hoje. */
const PARES = 3

/** O que a folha impressa precisa saber. Montado no clique (nunca durante o render). */
interface Folha {
  caixa: CaixaConsulta
  base: number // peças embaladas antes desta caixa (o "QTD" começa em base+1)
  qrSvg: string | null
  aviso: string | null
  emitidoEm: string
}

const fmtEmissao = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function CaixasForm({ ops }: { ops: OpComCaixa[] }) {
  const [sel, setSel] = useState('')
  const [caixas, setCaixas] = useState<CaixaConsulta[]>([])
  const [buscou, setBuscou] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [folha, setFolha] = useState<Folha | null>(null)
  const [carregando, startCarregar] = useTransition()
  const [gerando, startGerar] = useTransition()

  const ordem = ops.find((o) => `${o.pmo}||${o.op}` === sel)

  // A folha só entra no DOM quando `folha` existe; aí manda imprimir e, ao fim, tira do DOM.
  // O timeout dá um quadro pro navegador desenhar a folha antes de abrir a janela de impressão.
  useEffect(() => {
    if (!folha) return
    const fim = () => setFolha(null)
    window.addEventListener('afterprint', fim, { once: true })
    const t = window.setTimeout(() => window.print(), 60)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('afterprint', fim)
    }
  }, [folha])

  function escolher(v: string) {
    setSel(v)
    setAbertos(new Set())
    setBuscou(false)
    const [pmo, op] = v.split('||')
    if (!pmo || !op) return
    startCarregar(async () => {
      const r = await caixasDaOp(pmo, op)
      if (!r.ok) { toast.error(r.erro); return }
      setCaixas(r.caixas)
      setBuscou(true)
    })
  }

  function toggle(key: string) {
    setAbertos((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  function imprimir(caixa: CaixaConsulta) {
    const [pmo, op] = sel.split('||')
    if (!pmo || !op) return
    startGerar(async () => {
      const r = await qrDaCaixa(pmo, op, caixa.posto, caixa.seq)
      // QR que não cabe não impede a folha: imprime com o aviso no lugar do código.
      if (!r.ok) toast.error(r.erro)
      setFolha({
        caixa,
        base: pecasAntesDaCaixa(caixas, caixa),
        qrSvg: r.ok ? r.svg : null,
        aviso: r.ok ? null : r.erro,
        emitidoEm: fmtEmissao.format(new Date()),
      })
    })
  }

  return (
    <>
      <Card className={folha ? 'print:hidden' : undefined}>
        <CardHeader><CardTitle>Consultar Caixa</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 sm:max-w-md">
            <Label>OP</Label>
            <Select value={sel} onValueChange={(v) => escolher(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="Selecione a OP" /></SelectTrigger>
              <SelectContent>
                {ops.map((o) => (
                  <SelectItem key={`${o.pmo}||${o.op}`} value={`${o.pmo}||${o.op}`}>
                    {o.pmo}/{o.op}{o.cliente ? ` · ${o.cliente}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {buscou && !carregando && caixas.length === 0 && (
            <p className="text-sm text-muted-foreground">Esta OP não tem caixas.</p>
          )}

          <div className="flex flex-col gap-2">
            {caixas.map((c) => {
              const key = `${c.posto}-${c.seq}`
              return (
                <div key={key} className="rounded-lg border border-border">
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className="flex flex-1 flex-wrap items-center justify-between gap-2 text-left text-sm hover:underline"
                    >
                      <span className="font-medium">{c.codigo}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {c.posto} · {c.qtd} peça(s)
                        <Badge variant="outline" className={c.fechada ? 'border-green-600 text-green-700' : 'border-amber-500 text-amber-700'}>
                          {c.fechada ? 'fechada' : 'aberta'}
                        </Badge>
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={gerando || c.qtd === 0}
                      onClick={() => imprimir(c)}
                    >
                      <Printer className="mr-1 size-4" /> Imprimir / PDF
                    </Button>
                  </div>
                  {abertos.has(key) && (
                    <ul className="flex flex-col gap-0.5 border-t border-border px-3 py-2 text-sm">
                      {c.sns.length === 0 && <li className="text-muted-foreground">sem peças</li>}
                      {c.sns.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {folha && ordem && <FolhaCaixa folha={folha} ordem={ordem} />}
    </>
  )
}

/**
 * A folha de papel. Só existe no DOM enquanto imprime e só aparece na impressão (`hidden
 * print:block`) — a tela continua sendo a de consulta. Espelha a planilha "Lista de Números de
 * Série" que a fábrica usa hoje: faixa do produto, dados da OP, grade de pares QTD|NS e o QR
 * Code com a lista de SNs no rodapé.
 */
function FolhaCaixa({ folha, ordem }: { folha: Folha; ordem: OpComCaixa }) {
  const { caixa, base, qrSvg, aviso, emitidoEm } = folha
  // Grade balanceada: enche a 1ª coluna de cima a baixo, depois a 2ª, depois a 3ª — mesma ordem de
  // leitura da planilha antiga, mas sem as dezenas de linhas em branco do gabarito.
  const porColuna = Math.ceil(caixa.sns.length / PARES)
  const linhas = Array.from({ length: porColuna }, (_, r) =>
    Array.from({ length: PARES }, (_, c) => {
      const i = c * porColuna + r
      return i < caixa.sns.length ? { qtd: base + i + 1, sn: caixa.sns[i]! } : null
    }),
  )

  return (
    <div className="hidden text-black print:block print:p-[12mm]">
      <h1 className="mb-2 text-center text-[15px] font-semibold">Lista de Números de Série</h1>

      <div className="border border-black">
        <div className="flex items-center gap-3 border-b border-black bg-[#3b3391] px-3 py-1.5 text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
          <span className="text-[11px] uppercase text-[#c5c2e6]">Produto</span>
          <span className="text-[13px] font-bold">
            {ordem.descricao ? `${ordem.descricao} — ${ordem.pmo}` : ordem.pmo}
          </span>
        </div>
        <dl className="grid grid-cols-3 text-[11px]">
          <Campo rotulo="Cliente" valor={ordem.cliente || '—'} />
          <Campo rotulo="OP" valor={ordem.op} />
          <Campo rotulo="Quantidade da OP" valor={ordem.qtdOp != null ? String(ordem.qtdOp) : '—'} />
          <Campo rotulo="Caixa" valor={caixa.codigo} />
          <Campo rotulo="Posto" valor={caixa.posto} />
          <Campo rotulo="Peças nesta caixa" valor={`${caixa.qtd}${caixa.fechada ? '' : ' (caixa aberta)'}`} />
        </dl>
      </div>

      <table className="mt-2 w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {Array.from({ length: PARES }, (_, c) => (
              <ColunaCabecalho key={c} />
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, r) => (
            <tr key={r}>
              {linha.map((celula, c) => (
                <Celula key={c} celula={celula} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex items-start gap-3 break-inside-avoid border border-black p-3">
        <span className="text-[11px] font-semibold">QR Code:</span>
        {qrSvg ? (
          <div className="size-[120px] [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <span className="text-[11px]">{aviso ?? 'não gerado'}</span>
        )}
        <span className="ml-auto self-end text-[9px]">Emitido em {emitidoEm}</span>
      </div>
    </div>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 border-b border-r border-black px-3 py-1">
      <dt className="text-[9px] uppercase text-neutral-600">{rotulo}</dt>
      <dd className="font-semibold">{valor}</dd>
    </div>
  )
}

/** Cabeçalho de um par de colunas. Fica no <thead> pra repetir em cada folha da impressão. */
function ColunaCabecalho() {
  return (
    <>
      <th className="w-[8%] border border-black px-1 py-0.5 text-center font-semibold">QTD</th>
      <th className="w-[25%] border border-black px-1 py-0.5 text-center font-semibold">NS</th>
    </>
  )
}

function Celula({ celula }: { celula: { qtd: number; sn: string } | null }) {
  return (
    <>
      <td className="border border-black px-1 py-0.5 text-center tabular-nums">{celula?.qtd ?? ''}</td>
      <td className="border border-black px-1 py-0.5 text-center font-mono">{celula?.sn ?? ''}</td>
    </>
  )
}
