'use client'

import { Fragment, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { PainelResultado, type ChipResultado, type ResultadoAcao } from '@/components/ui/painel-resultado'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { tocarErro } from '@/shared/lib/som-erro'
import { localizarSetup, ultimasTrocas } from '@/modules/setup/application/setup-actions'
import { rotuloEquipamento, rotulosPosicao } from '@/modules/setup/domain/tipos'
import type { Equipamento, OrdemSetup, SetupResumo, Troca } from '@/modules/setup/infra/setup-repository'
import { chaveDaSelecao, SELECAO_VAZIA, SelecaoSetup, selecaoCompleta, type ValorSelecao } from '../../selecao-setup'
import { ModalAbastecimento } from './modal-abastecimento'

function fmtHora(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function Abastecimento({ ordens, equipamentos }: { ordens: OrdemSetup[]; equipamentos: Equipamento[] }) {
  const [selecao, setSelecao] = useState<ValorSelecao>(SELECAO_VAZIA)
  // `localizado` = a busca terminou; `setup` null com `localizado` = não existe setup dessa chave.
  const [setup, setSetup] = useState<SetupResumo | null>(null)
  const [localizado, setLocalizado] = useState(false)
  const [buscando, setBuscando] = useState(false)
  // Os bipes vivem no modal passo a passo; a página só guarda o último crachá para pré-preencher o 1/6.
  const [ultimoColaborador, setUltimoColaborador] = useState('')
  const [modalAberto, setModalAberto] = useState(false)
  const [trocas, setTrocas] = useState<Troca[]>([])
  const [resultado, setResultado] = useState<ResultadoAcao | null>(null)

  // Descarta respostas de uma seleção antiga (o operador trocou a máquina antes de a busca voltar).
  const buscaSeq = useRef(0)

  const completa = selecaoCompleta(selecao)
  const rotulos = rotulosPosicao(setup?.processo ?? (selecao.processo || 'SMD'))
  const liberado = setup !== null && setup.estado === 'liberado'

  function avisar(titulo: string, chips?: ChipResultado[]) {
    setResultado({ tipo: 'aviso', titulo, chips })
    tocarErro()
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
    setModalAberto(false)
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
          // Abre o passo a passo uma vez por setup localizado; depois de fechado, só volta pelo botão.
          if (seq === buscaSeq.current) setModalAberto(true)
        }
      } catch {
        if (seq === buscaSeq.current) avisar('Falha de conexão ao procurar o setup. Verifique a rede, troque a face ou o equipamento e volte pra tentar de novo.')
      } finally {
        if (seq === buscaSeq.current) setBuscando(false)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <SelecaoSetup ordens={ordens} equipamentos={equipamentos} valor={selecao} onChange={mudarSelecao} />
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
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">
                OP {setup.pmo}/{setup.op} · Linha {setup.linha} · {rotuloEquipamento(setup)} · {setup.face}
              </p>
              <p className="text-sm text-muted-foreground">
                {setup.processo} · {setup.totalItens} {setup.totalItens === 1 ? 'item' : 'itens'} no setup
              </p>
            </div>
            <Button
              className="h-11 flex-none bg-enterplak px-4 text-base hover:bg-enterplak-700"
              onClick={() => setModalAberto(true)}
            >
              Abastecer
            </Button>
          </div>

          {/* Fica na página para o operador ler depois de o modal fechar (falha de rede). */}
          <PainelResultado resultado={resultado} />

          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Últimas trocas</h2>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              {/* A lista cresce a cada troca: rola por dentro, com o cabeçalho fixo. */}
              <Table containerClassName="max-h-[24rem] overflow-y-auto">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--color-border)]">
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

          <ModalAbastecimento
            aberto={modalAberto}
            setupId={setup.id}
            rotulos={rotulos}
            colaboradorInicial={ultimoColaborador}
            onFechar={() => setModalAberto(false)}
            onColaboradorUsado={setUltimoColaborador}
            onTrocaRegistrada={() => { void recarregarTrocas(setup.id, buscaSeq.current) }}
            onFalhaConexao={(r) => { setResultado(r); setModalAberto(false) }}
          />
        </div>
      )}
    </div>
  )
}
