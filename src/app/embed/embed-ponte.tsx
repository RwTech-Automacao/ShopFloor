'use client'

import { useEffect } from 'react'
import { mensagemEmbed, type CodigoErroEmbed, type TipoMensagemEmbed } from '@/shared/lib/mensagem-embed'

/**
 * Avisa a página PAI (o Dashboard Enterplak) o que aconteceu dentro do iframe: carregou, perdeu a
 * sessão, ou o acesso foi recusado. Não renderiza nada.
 *
 * `origem` vem por prop, do servidor, de propósito: `DASHBOARD_ORIGIN` não é `NEXT_PUBLIC_`, então
 * `process.env` não a traz no bundle do navegador. Origem vazia (variável não configurada) →
 * NENHUMA mensagem: `'*'` entregaria o aviso a qualquer página que estivesse nos embutindo.
 */
export function EmbedPonte({
  origem,
  tipo,
  codigo,
}: {
  origem: string
  tipo: TipoMensagemEmbed
  codigo?: CodigoErroEmbed
}) {
  useEffect(() => {
    if (origem === '') return
    try {
      window.parent.postMessage(mensagemEmbed(tipo, codigo), origem)
    } catch {
      // Pai de outra origem que recusou a mensagem, ou aba fechando: o iframe segue na tela.
    }
  }, [origem, tipo, codigo])

  return null
}
