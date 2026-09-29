'use client'

import { useState, useTransition } from 'react'
import { Printer, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { caixasDaOp, qrDaCaixa, qrCodigoDaCaixa } from '@/modules/shopfloor/application/embalagem-actions'
import { pecasAntesDaCaixa } from '@/modules/shopfloor/domain/caixa'
import type { OpComCaixa, CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'
import { campoCsv } from '@/shared/lib/csv'
import { FolhaCaixa, useImpressaoFolha, nomeDoArquivo, fmtEmissao, type Folha } from '../../_components/folha-caixa'

export function CaixasForm({ ops }: { ops: OpComCaixa[] }) {
  const [sel, setSel] = useState('')
  const [caixas, setCaixas] = useState<CaixaConsulta[]>([])
  const [buscou, setBuscou] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [folha, setFolha] = useState<Folha | null>(null)
  const [carregando, startCarregar] = useTransition()
  const [gerando, startGerar] = useTransition()

  const ordem = ops.find((o) => `${o.pmo}||${o.op}` === sel)

  // A folha só entra no DOM quando `folha` existe; o hook manda imprimir e, ao fim, tira do DOM.
  useImpressaoFolha(folha, setFolha)

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

  /**
   * Baixa os SNs da caixa em CSV. Gerado no NAVEGADOR: os números já estão em memória (a lista veio
   * junto com as caixas), então uma volta ao servidor só adicionaria espera.
   *
   * `;` como separador e BOM no começo — mesma convenção da exportação de Registros, que é o que o
   * Excel em pt-BR abre direto, sem passar pelo assistente de importação.
   */
  function exportarCsv(caixa: CaixaConsulta) {
    const base = pecasAntesDaCaixa(caixas, caixa)
    const linhas = [
      ['#', 'Número de Série', 'Caixa'].join(';'),
      ...caixa.sns.map((sn, i) => [base + i + 1, sn, caixa.codigo].map(campoCsv).join(';')),
    ]
    const blob = new Blob(['\ufeff' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${nomeDoArquivo(caixa.codigo)}.csv`
    a.click()
    // Sem o revoke o blob fica na memória da aba até ela fechar — numa TV que passa o dia aberta,
    // uma exportação por caixa vira vazamento.
    URL.revokeObjectURL(url)
  }

  function imprimir(caixa: CaixaConsulta) {
    const [pmo, op] = sel.split('||')
    if (!pmo || !op) return
    startGerar(async () => {
      // Os dois QRs em paralelo: o grande (lista de SNs, conferência pelo celular) e o pequeno
      // (código final, bipe de mão no Almoxarifado). Um QR que falhe não impede a folha de sair
      // com o outro — cada um mostra seu próprio aviso no lugar do código.
      const [rSns, rCodigo] = await Promise.all([
        qrDaCaixa(pmo, op, caixa.posto, caixa.seq),
        qrCodigoDaCaixa(pmo, op, caixa.posto, caixa.seq),
      ])
      if (!rSns.ok) toast.error(rSns.erro)
      if (!rCodigo.ok) toast.error(rCodigo.erro)
      setFolha({
        caixa,
        base: pecasAntesDaCaixa(caixas, caixa),
        qrSvg: rSns.ok ? rSns.svg : null,
        aviso: rSns.ok ? null : rSns.erro,
        qrCodigoSvg: rCodigo.ok ? rCodigo.svg : null,
        avisoCodigo: rCodigo.ok ? null : rCodigo.erro,
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
                        {/* Montagem reprovada no NQA (revisao > 0): a caixa física foi desfeita e
                            remontada com o mesmo número, então ela não é nem "fechada" nem "aberta". */}
                        <Badge
                          variant="outline"
                          className={c.revisao > 0
                            ? 'border-red-600 text-red-700'
                            : (c.fechada ? 'border-green-600 text-green-700' : 'border-amber-500 text-amber-700')}
                        >
                          {c.revisao > 0 ? 'reprovada' : (c.fechada ? 'fechada' : 'aberta')}
                        </Badge>
                      </span>
                    </button>
                    {/* Sem folha pra montagem reprovada: a caixa dela não existe mais no chão. */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={gerando || c.qtd === 0 || c.revisao > 0}
                      title={c.revisao > 0 ? 'Esta montagem foi reprovada no NQA e refeita — a folha vale para a remontagem.' : undefined}
                      onClick={() => imprimir(c)}
                    >
                      <Printer className="mr-1 size-4" /> Imprimir / PDF
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={c.qtd === 0}
                      onClick={() => exportarCsv(c)}
                      title="Baixar os números de série desta caixa em CSV"
                    >
                      <Download className="mr-1 size-4" /> CSV
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
