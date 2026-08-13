'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { carregarEmbalagem, embalarIndividual } from '@/modules/shopfloor/application/embalagem-actions'

/**
 * Embalagem INDIVIDUAL (1 produto por caixa). Bipa o produto e depois a caixa; se os dois Nº de
 * Série baterem, registra. Fluxo escolhido pela OP (flag embalagem_individual). Sem limite/CX.
 */
export function EmbalagemIndividualPanel({
  colaborador, pmo, op, posto, qtdOP,
}: { colaborador: string; pmo: string; op: string; posto: string; qtdOP: number | null }) {
  const [snProduto, setSnProduto] = useState('')
  const [snCaixa, setSnCaixa] = useState('')
  const [total, setTotal] = useState(0)
  const [recentes, setRecentes] = useState<string[]>([])
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [, startCarregar] = useTransition()
  const [enviando, startEnviar] = useTransition()
  const produtoRef = useRef<HTMLInputElement>(null)
  const caixaRef = useRef<HTMLInputElement>(null)
  const refocar = useRef(false) // pedir foco no produto quando a gravação terminar (input destrava)

  // total já embalado (persiste entre recarregamentos / troca de contexto)
  useEffect(() => {
    startCarregar(async () => {
      setResultado(null)
      const r = await carregarEmbalagem(pmo, op, posto)
      if (r.ok) setTotal(r.estado.totalEmbaladas)
      else setResultado({ tipo: 'aviso', titulo: r.erro })
    })
  }, [pmo, op, posto])

  // refoca o produto assim que a transição termina (o input fica disabled durante o envio).
  useEffect(() => {
    if (enviando) return
    if (!refocar.current) return
    refocar.current = false
    produtoRef.current?.focus()
  }, [enviando])

  function onConferir() {
    if (snProduto.trim() === '' || snCaixa.trim() === '' || enviando) return
    const prod = snProduto
    const caixa = snCaixa
    startEnviar(async () => {
      const r = await embalarIndividual({ colaborador, pmo, op, posto, numeroSerie: prod, numeroSerieCaixa: caixa })
      setSnProduto('')
      setSnCaixa('')
      refocar.current = true
      if (!r.ok) {
        setResultado({
          tipo: 'aviso',
          titulo: r.erro,
          chips: [
            { rotulo: 'Produto', valor: prod.trim(), mono: true },
            { rotulo: 'Caixa', valor: caixa.trim(), mono: true },
          ],
        })
        return
      }
      setResultado({ tipo: 'ok', titulo: 'Peça embalada', chips: [{ rotulo: 'Nº Série', valor: prod.trim(), mono: true }] })
      setTotal((t) => t + 1)
      setRecentes((prev) => [prod.trim(), ...prev])
    })
  }

  const pct = qtdOP && qtdOP > 0 ? Math.min(100, Math.round((total / qtdOP) * 100)) : null

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="shrink-0">
        <CardTitle>Embalagem individual <span className="text-sm font-normal text-muted-foreground">· 1 produto por caixa</span></CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="shrink-0">
          <PainelResultado resultado={resultado} />
        </div>

        <div className="shrink-0">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium">Total embaladas: {total}{qtdOP ? ` / ${qtdOP} da OP` : ''}</span>
            {pct !== null && <span className="text-muted-foreground">{pct}%</span>}
          </div>
          {pct !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-enterplak" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snProduto">Nº de Série do Produto</Label>
            <Input
              id="snProduto" ref={produtoRef} value={snProduto} onChange={(e) => setSnProduto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); caixaRef.current?.focus() } }}
              placeholder="Bipe o produto" autoComplete="off" autoFocus className="h-12 text-lg" disabled={enviando}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="snCaixa">Nº de Série da Caixa</Label>
            <Input
              id="snCaixa" ref={caixaRef} value={snCaixa} onChange={(e) => setSnCaixa(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onConferir() } }}
              placeholder="Bipe a caixa" autoComplete="off" className="h-12 text-lg" disabled={enviando}
            />
          </div>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">Bipe o produto, depois a caixa. Se os dois Nº de Série baterem, a peça é registrada.</p>

        <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border p-2">
          <p className="mb-1 shrink-0 text-xs font-medium text-muted-foreground">Embaladas nesta sessão ({recentes.length})</p>
          <ul className="flex max-h-[8rem] flex-col gap-0.5 overflow-y-auto text-sm">
            {recentes.length === 0 && <li className="text-muted-foreground">—</li>}
            {recentes.map((s, i) => <li key={`${s}-${i}`} className="font-mono">{s}</li>)}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
