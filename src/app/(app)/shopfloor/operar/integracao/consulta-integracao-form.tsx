'use client'

import { useRef, useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  const [aCancelar, setACancelar] = useState<string | null>(null) // código da integração no diálogo
  const [motivo, setMotivo] = useState('')
  const [erroCancel, setErroCancel] = useState('')

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

  function onCancelar(codigo: string) {
    if (cancelando) return
    setMotivo(''); setErroCancel(''); setACancelar(codigo)
  }

  function confirmarCancelamento() {
    const codigo = aCancelar
    if (!codigo || motivo.trim() === '' || cancelando) return
    startCancel(async () => {
      const r = await cancelarIntegracao(codigo, motivo)
      if (r.ok) {
        setACancelar(null)
        toast.success('Integração cancelada.')
        buscar(ultimoSN) // re-busca: o bloco cancelado some
      } else {
        setErroCancel(r.erro) // fica no diálogo (ex.: peça já avançou) — o gestor lê antes de fechar
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
                  <p className="font-semibold text-tinta">{d.codigo}{d.observacao.trim().startsWith('*') ? '*' : ''}</p>
                  <p className="text-muted-foreground">
                    {d.cliente} · {d.pmo}/{d.op} · {d.posto} · {d.qtdPlacas} placa(s) · por {d.colaborador}
                  </p>
                  {d.observacao.trim() !== '' && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{d.observacao}</p>
                  )}
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
      <Dialog open={aCancelar !== null} onOpenChange={(o) => { if (!o && !cancelando) setACancelar(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar a integração {aCancelar}?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              O produto e as placas ficarão livres para re-integrar. Esta ação fica registrada com o motivo.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="motivo-cancel-integracao">Motivo (obrigatório)</Label>
              <Input id="motivo-cancel-integracao" value={motivo} autoFocus
                onChange={(e) => { setMotivo(e.target.value); if (erroCancel) setErroCancel('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarCancelamento() } }}
                placeholder="Ex.: placa bipada errada" />
            </div>
            {erroCancel && <p className="text-sm text-red-600">{erroCancel}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={cancelando} onClick={() => setACancelar(null)}>Voltar</Button>
            <Button variant="destructive" disabled={cancelando || motivo.trim() === ''} onClick={confirmarCancelamento}>
              {cancelando ? 'Cancelando…' : 'Cancelar integração'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
