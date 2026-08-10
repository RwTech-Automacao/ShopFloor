'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PainelResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { integrar, resolverPlacaIntegracaoAction } from '@/modules/shopfloor/application/integracao-actions'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

interface LinhaEncaixada {
  sn: string
  op: string
}

export function IntegracaoPanel({
  colaborador,
  cliente: _cliente,
  pmo,
  op,
  posto,
  descricao,
  componentes,
}: {
  colaborador: string
  cliente: string
  pmo: string
  op: string
  posto: string
  descricao: string
  componentes: string[]
}) {
  const [linhas, setLinhas] = useState<Record<string, LinhaEncaixada>>({})
  const [bipe, setBipe] = useState('')
  const [produtoSN, setProdutoSN] = useState('')
  const [erroProduto, setErroProduto] = useState('') // erro mostrado DENTRO do modal do produto final
  const [ambiguo, setAmbiguo] = useState<{ sn: string; candidatos: { pmo: string; op: string }[] } | null>(null)
  const [etapa, setEtapa] = useState<'nenhuma' | 'confirmar' | 'produto'>('nenhuma') // fluxo final por modal
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [resolvendo, startResolucao] = useTransition()
  const [registrando, startRegistro] = useTransition()
  const bipeRef = useRef<HTMLInputElement>(null)
  const produtoRef = useRef<HTMLInputElement>(null)

  const semReceita = componentes.length === 0
  const preenchidas = componentes.filter((pm) => linhas[pm] !== undefined).length
  const todasPreenchidas = !semReceita && preenchidas === componentes.length

  function refocarBipe() {
    setTimeout(() => bipeRef.current?.focus(), 0)
  }

  // Encaixe: o campo de bipe fica disabled durante a resolução; refoca/seleciona quando termina,
  // pra o operador bipar a próxima placa sem tocar no mouse (mesmo padrão da Embalagem).
  const acaoAposResolver = useRef<null | 'focus' | 'select'>(null)
  useEffect(() => {
    if (resolvendo) return
    const a = acaoAposResolver.current
    if (!a) return
    acaoAposResolver.current = null
    const el = bipeRef.current
    if (!el) return
    el.focus()
    if (a === 'select') el.select()
  }, [resolvendo])

  // Ao entrar na etapa 'produto', foca o campo do produto final dentro do modal.
  useEffect(() => {
    if (etapa !== 'produto') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErroProduto('')
    const id = setTimeout(() => produtoRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [etapa])

  /** PMO cuja placa já usa este SN (normalizado), ou null — evita o mesmo SN em duas PMOs. */
  function pmoComSn(sn: string): string | null {
    const alvo = normalizarSerie(sn)
    const achado = Object.entries(linhas).find(([, l]) => normalizarSerie(l.sn) === alvo)
    return achado ? achado[0] : null
  }

  /** Encaixou a última placa? Abre o modal de conferência automaticamente. */
  function abrirConferenciaSeCompleto(pmoAdicionado: string) {
    if (componentes.every((c) => c === pmoAdicionado || linhas[c] !== undefined)) setEtapa('confirmar')
  }

  function onBipar() {
    if (bipe.trim() === '' || resolvendo || semReceita) return
    const snBipado = bipe
    startResolucao(async () => {
      const r = await resolverPlacaIntegracaoAction(pmo, op, posto, snBipado)
      if (!r.ok) {
        if ('candidatos' in r) {
          // SN ambíguo: o operador escolhe a qual PMO/OP associar.
          setAmbiguo({ sn: snBipado.trim(), candidatos: r.candidatos })
          setBipe('')
          return
        }
        setResultado({ tipo: 'aviso', titulo: r.erro })
        setBipe(''); acaoAposResolver.current = 'focus' // bipe errado → limpa o campo pra bipar outro
        return
      }
      if (linhas[r.pmo] !== undefined) {
        setResultado({ tipo: 'aviso', titulo: 'PMO já tem placa' })
        setBipe(''); acaoAposResolver.current = 'focus' // bipe errado → limpa o campo pra bipar outro
        return
      }
      const pmoRepetido = pmoComSn(snBipado)
      if (pmoRepetido) {
        setResultado({ tipo: 'aviso', titulo: `Esse Nº de Série já foi encaixado em ${pmoRepetido}.` })
        setBipe(''); acaoAposResolver.current = 'focus' // bipe errado → limpa o campo pra bipar outro
        return
      }
      setLinhas((prev) => ({ ...prev, [r.pmo]: { sn: snBipado.trim(), op: r.op } }))
      setResultado({ tipo: 'ok', titulo: 'Placa encaixada', chips: [{ rotulo: 'PMO', valor: r.pmo }, { rotulo: 'Nº Série', valor: snBipado.trim(), mono: true }] })
      setBipe('')
      abrirConferenciaSeCompleto(r.pmo)
      acaoAposResolver.current = 'focus' // refoca quando a resolução terminar (input volta a habilitar)
    })
  }

  function escolherCandidato(pmoEscolhido: string, opEscolhida: string) {
    if (!ambiguo) return
    if (linhas[pmoEscolhido] !== undefined) {
      setResultado({ tipo: 'aviso', titulo: 'PMO já tem placa' })
      return
    }
    const pmoRepetido = pmoComSn(ambiguo.sn)
    if (pmoRepetido) {
      setResultado({ tipo: 'aviso', titulo: `Esse Nº de Série já foi encaixado em ${pmoRepetido}.` })
      return
    }
    setLinhas((prev) => ({ ...prev, [pmoEscolhido]: { sn: ambiguo.sn, op: opEscolhida } }))
    setResultado({ tipo: 'ok', titulo: 'Placa encaixada', chips: [{ rotulo: 'PMO', valor: pmoEscolhido }, { rotulo: 'Nº Série', valor: ambiguo.sn, mono: true }] })
    setAmbiguo(null)
    abrirConferenciaSeCompleto(pmoEscolhido)
    refocarBipe()
  }

  function limpar() {
    setLinhas({})
    setProdutoSN('')
    setErroProduto('')
    setAmbiguo(null)
    setEtapa('nenhuma')
  }

  // snArg vem do Enter (valor lido direto do campo) — imune a atraso do estado quando o scanner bipa rápido.
  function onRegistrar(snArg?: string) {
    if (registrando) return
    const sn = (snArg ?? produtoSN).trim()
    if (!todasPreenchidas) { setErroProduto('Faltam placas encaixadas.'); return }
    if (colaborador.trim() === '') { setErroProduto('Falta o colaborador — bipe no cabeçalho.'); return }
    if (sn === '') { setErroProduto('Bipe o Nº de Série do produto final.'); return }
    const placas = componentes.map((pm) => ({ pmo: pm, op: linhas[pm]!.op, sn: linhas[pm]!.sn }))
    startRegistro(async () => {
      const r = await integrar({ colaborador, pmo, op, produtoSN: sn, placas, posto })
      if (r.ok) {
        setResultado({ tipo: 'ok', titulo: 'Integração registrada', chips: [{ rotulo: 'Código', valor: r.codigo, mono: true }, { rotulo: 'Produto', valor: sn, mono: true }] })
        limpar()
        refocarBipe()
      } else {
        setResultado({ tipo: 'aviso', titulo: r.erro }) // mantém na tela de trás
        setErroProduto(r.erro)                            // e também sobre o modal
        setProdutoSN('')                                  // bipe errado → limpa pra bipar outro
        setTimeout(() => produtoRef.current?.focus(), 0)
      }
    })
  }

  const contador = useMemo(() => `${preenchidas} / ${componentes.length} placas`, [preenchidas, componentes.length])

  return (
    <Card className="flex flex-col">
      <CardHeader className="shrink-0">
        <CardTitle>Integração</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="shrink-0">
          <PainelResultado resultado={resultado} />
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <Label>Descrição</Label>
          <Input value={descricao} readOnly disabled />
        </div>

        {semReceita ? (
          <p className="text-sm text-red-600">
            Esta OP não tem receita de Integração cadastrada — cadastre a receita no Cadastro de OP.
          </p>
        ) : (
          <>
            <div className="flex shrink-0 flex-col gap-1.5">
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

            {ambiguo && (
              <div className="shrink-0 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950/40">
                <p className="mb-2 text-sm font-medium">
                  O SN <span className="font-mono">{ambiguo.sn}</span> aparece em mais de uma PMO da receita — escolha a qual associar:
                </p>
                <div className="flex flex-wrap gap-2">
                  {ambiguo.candidatos.map((c) => (
                    <Button
                      key={`${c.pmo}||${c.op}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => escolherCandidato(c.pmo, c.op)}
                    >
                      {c.pmo} · OP {c.op}
                    </Button>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAmbiguo(null); refocarBipe() }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col">
              <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
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

            {todasPreenchidas && etapa === 'nenhuma' && (
              <Button onClick={() => setEtapa('confirmar')} className="h-11 shrink-0 self-start bg-enterplak px-8 hover:bg-enterplak-700">
                Conferir placas e finalizar
              </Button>
            )}
          </>
        )}
      </CardContent>

      {/* Etapa 1: conferir placas → colaborador dá o "ok final" */}
      <Dialog open={etapa === 'confirmar'} onOpenChange={(o) => { if (!o) setEtapa('nenhuma') }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Placas encaixadas — conferir</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Confira as placas do produto e siga para bipar o produto final.</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PMO</TableHead>
                  <TableHead>Nº de Série</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {componentes.map((pm) => (
                  <TableRow key={pm}>
                    <TableCell className="font-medium">{pm}</TableCell>
                    <TableCell className="font-mono">{linhas[pm]?.sn ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEtapa('nenhuma')}>Voltar</Button>
            <Button onClick={() => setEtapa('produto')} className="bg-enterplak hover:bg-enterplak-700">
              Placas OK — bipar produto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Etapa 2: bipar o Nº de Série do produto final */}
      <Dialog open={etapa === 'produto'} onOpenChange={(o) => { if (!o) setEtapa('confirmar') }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Produto final</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="produtoSN">Bipe o Nº de Série do produto final</Label>
            <Input
              id="produtoSN"
              ref={produtoRef}
              value={produtoSN}
              onChange={(e) => { setProdutoSN(e.target.value); if (erroProduto) setErroProduto('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onRegistrar(e.currentTarget.value) } }}
              placeholder="Bipe o SN do produto final"
              autoComplete="off"
              className="h-12 text-lg"
              disabled={registrando}
              aria-invalid={erroProduto !== '' || undefined}
            />
            {erroProduto && <p className="text-sm text-red-600">{erroProduto}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEtapa('confirmar')}>Voltar</Button>
            <Button onClick={() => onRegistrar()} disabled={registrando} className="bg-enterplak hover:bg-enterplak-700">
              {registrando ? 'Registrando…' : 'Registrar Integração'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
