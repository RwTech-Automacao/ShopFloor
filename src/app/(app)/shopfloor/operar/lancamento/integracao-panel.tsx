'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { integrar, resolverPlacaIntegracaoAction } from '@/modules/shopfloor/application/integracao-actions'

interface LinhaEncaixada {
  sn: string
  op: string
}

export function IntegracaoPanel({
  colaborador,
  cliente: _cliente,
  pmo,
  op,
  descricao,
  componentes,
}: {
  colaborador: string
  cliente: string
  pmo: string
  op: string
  descricao: string
  componentes: string[]
}) {
  const [linhas, setLinhas] = useState<Record<string, LinhaEncaixada>>({})
  const [bipe, setBipe] = useState('')
  const [produtoSN, setProdutoSN] = useState('')
  const [resolvendo, startResolucao] = useTransition()
  const [registrando, startRegistro] = useTransition()
  const bipeRef = useRef<HTMLInputElement>(null)
  const produtoRef = useRef<HTMLInputElement>(null)

  const semReceita = componentes.length === 0
  const preenchidas = componentes.filter((pm) => linhas[pm] !== undefined).length
  const todasPreenchidas = !semReceita && preenchidas === componentes.length
  const valido = todasPreenchidas && produtoSN.trim() !== ''

  function refocarBipe() {
    setTimeout(() => bipeRef.current?.focus(), 0)
  }

  function onBipar() {
    if (bipe.trim() === '' || resolvendo || semReceita) return
    const snBipado = bipe
    startResolucao(async () => {
      const r = await resolverPlacaIntegracaoAction(pmo, op, snBipado)
      if (!r.ok) {
        toast.error(r.erro)
        bipeRef.current?.select()
        return
      }
      if (linhas[r.pmo] !== undefined) {
        toast.error('PMO já tem placa')
        bipeRef.current?.select()
        return
      }
      setLinhas((prev) => ({ ...prev, [r.pmo]: { sn: snBipado.trim(), op: r.op } }))
      toast.success(`Placa encaixada em ${r.pmo}`)
      setBipe('')
      refocarBipe()
    })
  }

  function limpar() {
    setLinhas({})
    setProdutoSN('')
  }

  function onRegistrar() {
    if (!valido || registrando) return
    const placas = componentes.map((pm) => ({ pmo: pm, op: linhas[pm]!.op, sn: linhas[pm]!.sn }))
    startRegistro(async () => {
      const r = await integrar({ colaborador, pmo, op, produtoSN, placas })
      if (r.ok) {
        toast.success(`Integração registrada: ${r.codigo}`)
        limpar()
        setTimeout(() => produtoRef.current?.focus(), 0)
      } else {
        toast.error(r.erro)
      }
    })
  }

  const contador = useMemo(() => `${preenchidas} / ${componentes.length} placas`, [preenchidas, componentes.length])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integração</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Descrição</Label>
          <Input value={descricao} readOnly disabled />
        </div>

        {semReceita ? (
          <p className="text-sm text-red-600">
            Esta OP não tem receita de Integração cadastrada — cadastre a receita no Cadastro de OP.
          </p>
        ) : (
          <>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Receita <span className="font-normal text-muted-foreground">· 1 placa por PMO</span>
                </p>
                <span className="text-sm text-muted-foreground">{contador}</span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PMO</TableHead>
                      <TableHead>Nº de Série encaixado</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {componentes.map((pm) => {
                      const linha = linhas[pm]
                      return (
                        <TableRow key={pm}>
                          <TableCell className="font-medium">{pm}</TableCell>
                          <TableCell>{linha ? linha.sn : <span className="text-muted-foreground">aguardando bipe…</span>}</TableCell>
                          <TableCell>
                            {linha ? (
                              <Badge variant="outline" className="border-green-600 text-green-700">Encaixada</Badge>
                            ) : (
                              <Badge variant="secondary">Pendente</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bipePlaca">Bipe a placa</Label>
              <Input
                id="bipePlaca"
                ref={bipeRef}
                value={bipe}
                onChange={(e) => setBipe(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
                placeholder="Bipe o SN da placa"
                autoComplete="off"
                autoFocus
                className="h-12 text-lg"
                disabled={resolvendo}
              />
            </div>
          </>
        )}

        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="produtoSN">Produto Final (Nº de Série)</Label>
            <Input
              id="produtoSN"
              ref={produtoRef}
              value={produtoSN}
              onChange={(e) => setProdutoSN(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRegistrar() } }}
              placeholder="Bipe o SN do produto final"
              autoComplete="off"
              className="h-12 text-lg"
              disabled={semReceita}
            />
          </div>
          {!semReceita && (
            <Button onClick={onRegistrar} disabled={!valido || registrando} className="h-11 bg-enterplak px-8 hover:bg-enterplak-700">
              {registrando ? 'Registrando…' : 'Registrar Integração'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
