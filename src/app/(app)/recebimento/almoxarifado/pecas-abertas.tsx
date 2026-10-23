'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ResultadoAcao } from '@/components/ui/painel-resultado'
import { registrarEntradaAlmoxarifado } from '@/modules/shopfloor/application/almoxarifado-actions'
import { quandoCurto, pecasTexto, type PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'
import type { ConfirmacaoCartao } from './caixa-aberta'
import { useDetalheRecarregavel } from './use-detalhe'

const MAX_BIPES = 10
const FALHA_BIPE = 'Não foi possível registrar a entrada.'

interface BipeAceito { sn: string; em: string }

/**
 * Peças avulsas (OP individual sem NQA no posto anterior): a entrada é peça por peça, bipando o número de série
 * de cada uma. As recusas (posto anterior não concluído, peça já lançada…) são da RPC; aqui só se mostra a frase.
 * `onConfirmado` não é usado: o cartão continua aberto entre os bipes (a tela recarrega a lista ao voltar).
 */
export function PecasAbertas({
  item,
  colaborador,
  posto,
  onResultado,
  onVoltar,
}: {
  item: PendenciaAlmoxarifado
  colaborador: string
  posto: string
  onResultado: (r: ResultadoAcao) => void
  onConfirmado?: (c: ConfirmacaoCartao) => void
  onVoltar: () => void
}) {
  const { estado, recarregar } = useDetalheRecarregavel(item)
  const [bipe, setBipe] = useState('')
  const [aceitos, setAceitos] = useState<BipeAceito[]>([])
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false)
  const bipeRef = useRef<HTMLInputElement>(null)

  const pronto = estado.tipo === 'ok' && estado.detalhe.pecas > 0
  useEffect(() => {
    if (pronto && !enviando) bipeRef.current?.focus()
  }, [pronto, enviando])

  if (estado.tipo === 'carregando') return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (estado.tipo === 'erro') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">{estado.erro}</p>
        <Button type="button" variant="outline" onClick={onVoltar}>Voltar à lista</Button>
      </div>
    )
  }

  const d = estado.detalhe

  function onBipar() {
    const lido = bipe.trim()
    if (lido === '' || enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    void (async () => {
      try {
        const r = await registrarEntradaAlmoxarifado({
          pmo: item.pmo, op: item.op, posto, colaborador, bipe: lido,
        })
        if (!r.ok) {
          onResultado({ tipo: 'aviso', titulo: r.erro })
          return
        }
        setAceitos((a) => [{ sn: lido, em: new Date().toISOString() }, ...a].slice(0, MAX_BIPES))
        setBipe('')
        onResultado({
          tipo: 'ok',
          titulo: pecasTexto(r.quantidade),
          detalhe: r.divergencia,
          chips: [{ rotulo: 'Nº Série', valor: lido, mono: true }],
        })
        await recarregar()
      } catch {
        onResultado({ tipo: 'aviso', titulo: FALHA_BIPE })
      } finally {
        enviandoRef.current = false
        setEnviando(false)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {`OP ${item.op} · ${item.pmo} · individual · sem NQA no posto anterior`}
      </p>
      <p className="text-xl font-bold">
        Peças avulsas · <span className="text-primary">{pecasTexto(d.pecas)}</span> esperando
      </p>
      {d.pecas > 0 ? (
        <>
          <p className="text-base">Bipe o número de série de cada peça que chegou.</p>
          <Input
            ref={bipeRef}
            value={bipe}
            onChange={(e) => setBipe(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
            placeholder="Bipe o número de série da peça"
            aria-label="Bipe o número de série da peça"
            autoComplete="off"
            autoFocus
            className="h-12 max-w-md text-lg"
            disabled={enviando}
          />
        </>
      ) : (
        <p className="text-base">Todas as peças desta OP já deram entrada.</p>
      )}
      <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        <p>
          OP {item.op}: {d.recebidasOp}
          {d.qtdOp !== null ? ` de ${d.qtdOp}` : ''} peças já no Almoxarifado
        </p>
        <p>{d.postoAnterior ? `Posto anterior: ${d.postoAnterior.posto} concluído` : 'Sem posto anterior'}</p>
      </div>
      {aceitos.length > 0 && (
        <ul aria-label="Últimos bipes aceitos" className="flex flex-col gap-1 text-sm">
          {aceitos.map((b, i) => (
            <li key={`${b.sn}-${i}`} className="flex gap-3">
              <span className="font-mono">{b.sn}</span>
              <span className="text-muted-foreground">{quandoCurto(b.em)}</span>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="button" variant="outline" onClick={onVoltar} disabled={enviando}>‹ Voltar à lista</Button>
      </div>
    </div>
  )
}
