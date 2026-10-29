'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ResultadoAcao } from '@/components/ui/painel-resultado'
import { confirmarLoteAlmoxarifado } from '@/modules/shopfloor/application/almoxarifado-actions'
import {
  amostraCompleta,
  conferirBipeAmostra,
  quandoCurto,
  pecasTexto,
  type NecessidadeLote,
  type PendenciaAlmoxarifado,
} from '@/modules/shopfloor/domain/almoxarifado'
import type { ConfirmacaoCartao } from './caixa-aberta'
import { useDetalhe } from './use-detalhe'

/**
 * Lote aberto (OP individual): TODOS os SNs do lote como etiquetas; o operador bipa cada um deles (os N
 * distintos) e confirma. A Tabela NQA não vale aqui (decisão de 21/10). Nada vai ao banco até o "Confirmar lote".
 */
export function LoteAberto({
  item,
  colaborador,
  posto,
  onResultado,
  onConfirmado,
  onVoltar,
}: {
  item: PendenciaAlmoxarifado
  colaborador: string
  posto: string
  onResultado: (r: ResultadoAcao) => void
  onConfirmado: (c: ConfirmacaoCartao) => void
  onVoltar: () => void
}) {
  const estado = useDetalhe(item)
  const [bipe, setBipe] = useState('')
  const [amostra, setAmostra] = useState<string[]>([])
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false)
  const bipeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (estado.tipo === 'ok' && !enviando) bipeRef.current?.focus()
  }, [estado.tipo, enviando])

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
  const lote: NecessidadeLote = {
    loteId: item.loteId ?? '',
    rotulo: item.codigo,
    pecas: d.pecas,
    amostra: d.amostra,
    sns: d.sns,
    jaLancadas: d.jaLancadas,
    aprovadoEm: d.em,
  }
  const total = lote.sns.length
  const hora = quandoCurto(d.em)
  const completa = amostraCompleta(lote, amostra)

  function onBipar() {
    if (enviandoRef.current) return
    const r = conferirBipeAmostra(lote, amostra, bipe)
    if (r.ok) {
      setAmostra(r.bipados)
      setBipe('')
      return
    }
    if (r.motivo === 'vazio') return
    onResultado({
      tipo: 'aviso',
      titulo: r.motivo === 'fora_do_lote'
        ? `A peça ${r.sn} não é deste lote.`
        : `A peça ${r.sn} já foi bipada neste lote.`,
    })
  }

  function onConfirmar() {
    if (!completa || enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    const bipados = amostra
    void (async () => {
      try {
        const r = await confirmarLoteAlmoxarifado({
          pmo: item.pmo, op: item.op, posto, colaborador, loteId: lote.loteId, amostra: bipados,
        })
        if (!r.ok) {
          onResultado({ tipo: 'aviso', titulo: r.erro })
          return
        }
        onConfirmado({ quantidade: r.quantidade, codigo: r.lote || item.codigo })
      } catch {
        onResultado({ tipo: 'aviso', titulo: 'Não foi possível confirmar o lote.' })
      } finally {
        enviandoRef.current = false
        setEnviando(false)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {`OP ${item.op} · ${item.pmo} · individual${hora ? ` · aprovado ${hora}` : ''}`}
      </p>
      <p className="break-all font-mono text-xl font-bold">
        Lote {item.codigo} · <span className="text-primary">{pecasTexto(d.pecas)}</span>
      </p>
      <p className="text-base">{`Bipe os ${total} números de série do lote:`}</p>
      <ul aria-label="Números de série do lote" className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
        {lote.sns.map((sn) => {
          const bip = amostra.includes(sn)
          return (
            <li
              key={sn}
              className={`rounded-full border px-2.5 py-1 font-mono text-sm ${
                bip
                  ? 'border-green-600 bg-green-100 font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300'
                  : 'border-border bg-card'
              }`}
            >
              {bip ? `✔ ${sn}` : sn}
            </li>
          )
        })}
      </ul>
      <Input
        ref={bipeRef}
        value={bipe}
        onChange={(e) => setBipe(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
        placeholder="Bipe um número de série do lote"
        aria-label="Bipe um número de série do lote"
        autoComplete="off"
        autoFocus
        className="h-12 max-w-md text-lg"
        disabled={enviando}
      />
      <p className="text-sm text-muted-foreground">Bipadas: {amostra.length} de {total}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onConfirmar} disabled={enviando || !completa}>Confirmar lote</Button>
        <Button type="button" variant="outline" onClick={onVoltar} disabled={enviando}>‹ Voltar à lista</Button>
      </div>
    </div>
  )
}
