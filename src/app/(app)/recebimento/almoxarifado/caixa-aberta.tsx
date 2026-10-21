'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ResultadoAcao } from '@/components/ui/painel-resultado'
import { registrarEntradaAlmoxarifado } from '@/modules/shopfloor/application/almoxarifado-actions'
import {
  codigoConfere,
  FRASE_CAIXA_ERRADA,
  quandoCurto,
  pecasTexto,
  type PendenciaAlmoxarifado,
} from '@/modules/shopfloor/domain/almoxarifado'
import { useDetalhe } from './use-detalhe'

export interface ConfirmacaoCartao {
  quantidade: number
  codigo: string
  divergencia?: string
}

/**
 * Caixa aberta (OP coletiva): o código da caixa em letra grande; bipar esse código confirma a entrada
 * das peças. Trava anti-duplo-Enter no molde do painel antigo: ref síncrono + estado `enviando`, sem
 * transição (o ref cobre o leitor que manda dois Enter antes de o React aplicar o primeiro setState).
 */
export function CaixaAberta({
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
  const hora = quandoCurto(d.em)

  function onBipar() {
    if (enviandoRef.current) {
      onResultado({ tipo: 'aviso', titulo: 'Registrando o bipe anterior — este ainda não contou. Bipe de novo.' })
      return
    }
    if (bipe.trim() === '') return
    if (!codigoConfere(bipe, item.codigo)) {
      onResultado({ tipo: 'aviso', titulo: FRASE_CAIXA_ERRADA })
      return
    }
    const alvo = item.codigo // canônico: o texto digitado pode vir em minúsculas e o banco não normaliza
    enviandoRef.current = true
    setEnviando(true)
    void (async () => {
      try {
        const r = await registrarEntradaAlmoxarifado({ pmo: item.pmo, op: item.op, posto, colaborador, bipe: alvo })
        if (!r.ok) {
          onResultado({ tipo: 'aviso', titulo: r.erro })
          return
        }
        onConfirmado({ quantidade: r.quantidade, codigo: item.codigo, divergencia: r.divergencia })
      } catch {
        onResultado({ tipo: 'aviso', titulo: 'Não foi possível registrar a entrada.' })
      } finally {
        enviandoRef.current = false
        setEnviando(false)
      }
    })()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {`OP ${item.op} · ${item.pmo} · coletiva${hora ? ` · fechada ${hora}` : ''}${d.fechadaPor ? ` por ${d.fechadaPor}` : ''}`}
      </p>
      <p className="break-all font-mono text-3xl font-bold">{item.codigo}</p>
      <p className="text-base">Bipe este código para confirmar a entrada de {pecasTexto(d.pecas)}.</p>
      <Input
        ref={bipeRef}
        value={bipe}
        onChange={(e) => setBipe(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onBipar() } }}
        placeholder="Bipe o código da caixa"
        aria-label="Bipe o código da caixa"
        autoComplete="off"
        autoFocus
        className="h-12 max-w-md text-lg"
        disabled={enviando}
      />
      <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        {d.sns.length > 0 && <p>Dentro da caixa: {d.sns.join(', ')}</p>}
        <p>{d.postoAnterior ? `Posto anterior: ${d.postoAnterior.posto} concluído` : 'Sem posto anterior'}</p>
        <p>
          OP {item.op}: {d.recebidasOp}
          {d.qtdOp !== null ? ` de ${d.qtdOp}` : ''} peças já no Almoxarifado
        </p>
      </div>
      <div>
        <Button type="button" variant="outline" onClick={onVoltar} disabled={enviando}>‹ Voltar à lista</Button>
      </div>
    </div>
  )
}
