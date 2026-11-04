'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** De quanto em quanto tempo a tela relê o estado do envio ao Compels (a rodada da fila roda a cada minuto). */
const INTERVALO_MS = 30_000

/**
 * Relê a parte do servidor da página (o quadro do envio ao Compels) de tempos em tempos, só com a aba
 * visível. Não renderiza nada: o estado dos cartões é do cliente e não é perdido no `refresh()`.
 */
export function AtualizarSozinho() {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, INTERVALO_MS)
    return () => clearInterval(id)
  }, [router])
  return null
}
