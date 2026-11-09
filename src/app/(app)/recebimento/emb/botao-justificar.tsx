'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  JustificarDivergenciaDialog,
  type AlvoJustificativa,
} from '../processos/justificar-divergencia-dialog'

/**
 * O botão de uma linha do relatório da EMB que abre a MESMA janela de justificativa do Fluxo e dos
 * Processos. A página só o mostra a quem tem `recebimento.administrar`. Depois de salvar, a página
 * (server component, `force-dynamic`) é recarregada pelo `router.refresh()`: a justificativa, quem
 * justificou, o contador "N sem justificativa" e o destaque da linha vêm do banco, sem otimismo.
 */
export function BotaoJustificar({ alvo }: { alvo: AlvoJustificativa }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const justificada = alvo.texto.trim() !== ''
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={justificada ? 'outline' : 'default'}
        className={justificada ? undefined : 'bg-enterplak hover:bg-enterplak-700'}
        aria-label={`${justificada ? 'Editar justificativa' : 'Justificar'} do processo Nº ${alvo.numero}`}
        onClick={() => setAberto(true)}
      >
        {justificada ? 'Editar' : 'Justificar'}
      </Button>
      {aberto && (
        <JustificarDivergenciaDialog
          key={alvo.id}
          alvo={alvo}
          podeJustificar
          onFechar={() => setAberto(false)}
          onSalvo={() => router.refresh()}
        />
      )}
    </>
  )
}
