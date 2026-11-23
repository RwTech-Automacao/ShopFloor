'use client'

import { useLinkStatus } from 'next/link'

/**
 * Bolinha girando ao lado do rótulo de um `<Link>` enquanto a navegação dele está pendente: confirma o clique na
 * hora, mesmo quando a tela nova demora (o `loading.tsx` ainda não pré-carregado, rede lenta, servidor ocupado).
 *
 * Precisa estar DENTRO do `<Link>` (o `useLinkStatus` lê o estado do Link mais próximo). O elemento está sempre
 * no DOM, com tamanho fixo, e só a opacidade muda: assim o rótulo não "pula" ao clicar. O `delay-100` evita o
 * pisca-pisca nas navegações rápidas (já pré-carregadas), em que o pendente dura poucos milissegundos.
 */
export function IndicadorLinkPendente({ className = '' }: { className?: string }) {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden
      data-pendente={pending ? 'sim' : 'nao'}
      className={`inline-block size-3 shrink-0 rounded-full border-2 border-current border-t-transparent transition-opacity motion-reduce:animate-none ${
        pending ? 'animate-spin opacity-70 delay-100' : 'opacity-0'
      } ${className}`}
    />
  )
}
