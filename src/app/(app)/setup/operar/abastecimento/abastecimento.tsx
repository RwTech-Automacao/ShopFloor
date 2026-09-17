'use client'

import { Fragment, useRef, useState, useTransition, type RefObject } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PainelResultado, type ChipResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { tocarErro } from '@/shared/lib/som-erro'
import { localizarSetup, trocarRolo, ultimasTrocas } from '@/modules/setup/application/setup-actions'
import { rotuloEquipamento, rotulosPosicao } from '@/modules/setup/domain/tipos'
import type { Equipamento, OrdemSetup, SetupResumo, Troca } from '@/modules/setup/infra/setup-repository'
import { chaveDaSelecao, SELECAO_VAZIA, SelecaoSetup, selecaoCompleta, type ValorSelecao } from '../../selecao-setup'

const INPUT_BIPE = 'h-11 text-lg uppercase'
const FALHA_CONEXAO_TROCA = 'Falha de conexão. Confira em Últimas trocas se a troca foi registrada antes de reenviar.'

function fmtHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

type Campo = 'posicao' | 'feeder' | 'saida' | 'entrada' | 'sn'
const CAMPOS_VAZIOS: Record<Campo, string> = { posicao: '', feeder: '', saida: '', entrada: '', sn: '' }

export function Abastecimento({ ordens, equipamentos }: { ordens: OrdemSetup[]; equipamentos: Equipamento[] }) {
  const [selecao, setSelecao] = useState<ValorSelecao>(SELECAO_VAZIA)
  // `localizado` = a busca terminou; `setup` null com `localizado` = não existe setup dessa chave.
  const [setup, setSetup] = useState<SetupResumo | null>(null)
  const [localizado, setLocalizado] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [campos, setCampos] = useState<Record<Campo, string>>(CAMPOS_VAZIOS)
  // Fora de `campos` de propósito: CAMPOS_VAZIOS zera os bipes a cada troca aprovada e o crachá
  // do colaborador tem que continuar preenchido (mesmo comportamento do Lançamento do ShopFloor).
  const [colaborador, setColaborador] = useState('')
  const [trocas, setTrocas] = useState<Troca[]>([])
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)
  const [enviando, startEnvio] = useTransition()

  const colaboradorRef = useRef<HTMLInputElement>(null)
  const refs: Record<Campo, RefObject<HTMLInputElement | null>> = {
    posicao: useRef<HTMLInputElement>(null),
    feeder: useRef<HTMLInputElement>(null),
    saida: useRef<HTMLInputElement>(null),
    entrada: useRef<HTMLInputElement>(null),
    sn: useRef<HTMLInputElement>(null),
  }
  // Evita bipe duplo (scanner manda Enter rápido) enquanto a transição ainda não marcou `enviando`.
  const enviandoRef = useRef(false)
  // Descarta respostas de uma seleção antiga (o operador trocou a máquina antes de a busca voltar).
  const buscaSeq = useRef(0)

  const completa = selecaoCompleta(selecao)
  const rotulos = rotulosPosicao(setup?.processo ?? (selecao.processo || 'SMD'))
  const liberado = setup !== null && setup.estado === 'liberado'

  function avisar(titulo: string, chips?: ChipResultado[]) {
    setResultado({ tipo: 'aviso', titulo, chips })
    tocarErro()
  }

  // Sempre seleciona o conteúdo ao focar: o leitor de bipe digita em cima e substitui, em vez de concatenar.
  const focar = (c: Campo) => {
    const el = refs[c].current
    el?.focus()
    el?.select()
  }

  async function recarregarTrocas(setupId: string, seq: number) {
    try {
      const r = await ultimasTrocas(setupId)
      if (seq !== buscaSeq.current) return
      if (r.ok) setTrocas(r.trocas)
    } catch {
      // A lista é só apoio visual: o resultado da troca já está no painel.
    }
  }

  function mudarSelecao(v: ValorSelecao) {
    setSelecao(v)
    setSetup(null)
    setLocalizado(false)
    setTrocas([])
    setResultado(null)
    setCampos(CAMPOS_VAZIOS)
    const seq = ++buscaSeq.current
    if (!selecaoCompleta(v)) { setBuscando(false); return }
    setBuscando(true)
    void (async () => {
      try {
        const r = await localizarSetup(chaveDaSelecao(v))
        if (seq !== buscaSeq.current) return
        if (!r.ok) { avisar(r.erro); return }
        setSetup(r.setup)
        setLocalizado(true)
        if (r.setup?.estado === 'liberado') {
          await recarregarTrocas(r.setup.id, seq)
          if (seq === buscaSeq.current) requestAnimationFrame(() => focar('posicao'))
        }
      } catch {
        if (seq === buscaSeq.current) avisar('Falha de conexão ao procurar o setup. Verifique a rede, troque a face ou o equipamento e volte pra tentar de novo.')
      } finally {
        if (seq === buscaSeq.current) setBuscando(false)
      }
    })()
  }

  function enviar() {
    if (!setup || !liberado || enviando || enviandoRef.current) return
    const v = {
      posicao: campos.posicao.trim(), feeder: campos.feeder.trim(), saida: campos.saida.trim(),
      entrada: campos.entrada.trim(), sn: campos.sn.trim(),
    }
    const vazio = (Object.keys(v) as Campo[]).find((c) => v[c] === '')
    if (vazio) { focar(vazio); return }
    const chips: ChipResultado[] = [
      { rotulo: rotulos.posicao, valor: v.posicao },
      { rotulo: rotulos.feeder, valor: v.feeder },
      { rotulo: 'Saiu', valor: v.saida, mono: true },
      { rotulo: 'Entrou', valor: v.entrada, mono: true },
      { rotulo: 'SN Inicial', valor: v.sn, mono: true },
    ]
    enviandoRef.current = true
    const setupId = setup.id
    const seq = buscaSeq.current
    startEnvio(async () => {
      try {
        let r: Awaited<ReturnType<typeof trocarRolo>>
        try {
          r = await trocarRolo({
            setupId, posicao: v.posicao, feeder: v.feeder, roloSaida: v.saida, roloEntrada: v.entrada, snInicial: v.sn,
            colaborador: colaborador.trim(),
          })
        } catch {
          avisar(FALHA_CONEXAO_TROCA, chips)
          await recarregarTrocas(setupId, seq)
          // Não deixa o foco no SN com tudo preenchido: um Enter reenviaria e geraria um REPROVADO enganoso.
          focar('posicao')
          return
        }
        if (!r.ok) {
          avisar(r.erro, chips)
          focar('saida')
        } else if (r.resultado === 'APROVADO') {
          setResultado({
            tipo: 'ok',
            titulo: 'Troca aprovada — pode seguir',
            chips,
            dica: r.semFaixa ? 'Confira o SN manualmente — a OP não tem faixa de SN cadastrada.' : undefined,
          })
          setCampos(CAMPOS_VAZIOS)
          focar('posicao')
        } else {
          setResultado({ tipo: 'reprova', titulo: 'Troca reprovada — confira o componente', detalhe: r.motivos.join(' '), chips })
          tocarErro()
          // Não limpa: o operador corrige só o que estiver errado.
          focar('saida')
        }
        await recarregarTrocas(setupId, seq)
      } finally {
        enviandoRef.current = false
      }
    })
  }

  const ordemCampos: { campo: Campo; rotulo: string; placeholder?: string }[] = [
    { campo: 'posicao', rotulo: rotulos.posicao },
    { campo: 'feeder', rotulo: rotulos.feeder },
    { campo: 'saida', rotulo: 'Rolo que sai', placeholder: 'CÓDIGO-LOTE' },
    { campo: 'entrada', rotulo: 'Rolo que entra', placeholder: 'CÓDIGO-LOTE' },
    { campo: 'sn', rotulo: 'SN Inicial', placeholder: 'Nº de Série da placa' },
  ]

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <SelecaoSetup ordens={ordens} equipamentos={equipamentos} valor={selecao} onChange={mudarSelecao} desabilitado={enviando} />
      </div>

      {!completa && (
        <p className="text-sm text-muted-foreground">Escolha a OP, o processo, a linha, o bloco (e a máquina, no SMD) e a face para trocar rolo.</p>
      )}

      {completa && buscando && <p className="text-sm text-muted-foreground">Procurando o setup…</p>}

      {completa && !buscando && !localizado && <PainelResultado resultado={resultado} />}

      {completa && !buscando && localizado && setup === null && (
        <p className="rounded-lg border border-border bg-card p-4 text-base text-muted-foreground">
          Não há setup dessa OP nesse equipamento e face.
        </p>
      )}

      {completa && !buscando && setup !== null && !liberado && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="text-base font-semibold">O setup ainda está em montagem. Libere em Montar Setup.</p>
          <p className="mt-1 text-sm">
            A troca de rolo só vale em setup liberado.{' '}
            <Link href="/setup/operar/montar" className="font-medium underline underline-offset-2">Ir para Montar Setup</Link>
          </p>
        </div>
      )}

      {completa && !buscando && setup !== null && liberado && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <p className="text-lg font-semibold">
              OP {setup.pmo}/{setup.op} · Linha {setup.linha} · {rotuloEquipamento(setup)} · {setup.face}
            </p>
            <p className="text-sm text-muted-foreground">
              {setup.processo} · {setup.totalItens} {setup.totalItens === 1 ? 'item' : 'itens'} no setup
            </p>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* Mobile/tablet: painel → bipe → trocas. No lg: bipe à esquerda, painel e trocas à direita. */}
            <div className="lg:col-start-2 lg:row-start-1 empty:hidden">
              <PainelResultado resultado={resultado} />
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:grid-cols-1">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="troca-colaborador">Colaborador</Label>
                <Input
                  id="troca-colaborador"
                  ref={colaboradorRef}
                  value={colaborador}
                  onChange={(e) => setColaborador(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focar('posicao') } }}
                  placeholder="Bipe ou digite o crachá"
                  autoComplete="off"
                  className={INPUT_BIPE}
                />
              </div>
              {ordemCampos.map(({ campo, rotulo, placeholder }, i) => {
                const proximo = ordemCampos[i + 1]?.campo
                return (
                  <div key={campo} className="flex flex-col gap-1.5">
                    <Label htmlFor={`troca-${campo}`}>{rotulo}</Label>
                    <Input
                      id={`troca-${campo}`}
                      ref={refs[campo]}
                      value={campos[campo]}
                      onChange={(e) => setCampos((c) => ({ ...c, [campo]: e.target.value }))}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        if (proximo) focar(proximo)
                        else enviar()
                      }}
                      placeholder={placeholder}
                      autoComplete="off"
                      className={INPUT_BIPE}
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex flex-col gap-2 lg:col-start-2 lg:row-start-2">
              <h2 className="text-base font-semibold">Últimas trocas</h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hora</TableHead>
                      <TableHead>{rotulos.posicao}/{rotulos.feeder}</TableHead>
                      <TableHead>Saiu → Entrou</TableHead>
                      <TableHead>SN</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Operador</TableHead>
                      <TableHead>Colaborador</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trocas.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                          Nenhuma troca registrada nesse setup.
                        </TableCell>
                      </TableRow>
                    )}
                    {trocas.map((t) => {
                      const reprovada = t.resultado === 'REPROVADO'
                      const comMotivos = reprovada && t.motivos.length > 0
                      return (
                        <Fragment key={t.id}>
                          <TableRow className={comMotivos ? 'border-b-0' : undefined}>
                            <TableCell className="whitespace-nowrap">{fmtHora(t.dataHora)}</TableCell>
                            <TableCell className="whitespace-nowrap">{t.posicao} / {t.feeder}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-sm">{t.roloSaida} → {t.roloEntrada}</TableCell>
                            <TableCell className="font-mono text-sm">{t.snInicial}</TableCell>
                            <TableCell>
                              {reprovada ? (
                                <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-medium text-red-800">Reprovado</span>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-medium text-green-800">Aprovado</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{t.operadorNome}</TableCell>
                            <TableCell className="whitespace-nowrap">{t.colaborador || '—'}</TableCell>
                          </TableRow>
                          {comMotivos && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={7} className="whitespace-normal pt-0 text-xs text-red-700">{t.motivos.join(' ')}</TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
