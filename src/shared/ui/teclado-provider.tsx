'use client'

import { useEffect } from 'react'

// Mantém `--kb-inset` (em :root) igual à altura do teclado virtual e rola o campo focado
// pra cima dele. Alvo: mini PC Windows (Edge/Chromium) com teclado touch que SOBREPÕE a página.
// Caminho 1: VirtualKeyboard API (Edge) — geometria exata. Caminho 2 (fallback): visualViewport.
// Sem teclado na tela, o inset fica 0 e nada muda. Não renderiza nada.

interface VirtualKeyboardLike {
  overlaysContent: boolean
  boundingRect: DOMRectReadOnly
  addEventListener(type: 'geometrychange', cb: () => void): void
  removeEventListener(type: 'geometrychange', cb: () => void): void
}

export function TecladoProvider() {
  useEffect(() => {
    const root = document.documentElement
    const setInset = (px: number) => root.style.setProperty('--kb-inset', `${Math.max(0, Math.round(px))}px`)

    // Ao focar um campo editável, traz ele pro centro da área visível (acima do teclado).
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (el && el.matches('input, textarea, [contenteditable="true"]')) {
        // pequeno atraso: espera o teclado abrir/o layout assentar antes de rolar.
        setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
      }
    }
    document.addEventListener('focusin', onFocus)

    const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
    if (vk) {
      vk.overlaysContent = true // assumimos o controle (o browser para de auto-rolar; nós rolamos)
      const onGeo = () => setInset(vk.boundingRect?.height ?? 0)
      vk.addEventListener('geometrychange', onGeo)
      return () => {
        vk.removeEventListener('geometrychange', onGeo)
        document.removeEventListener('focusin', onFocus)
      }
    }

    // Fallback: quando o teclado redimensiona a viewport visual, o inset é a diferença.
    const vv = window.visualViewport
    if (vv) {
      const onResize = () => setInset(window.innerHeight - vv.height - vv.offsetTop)
      vv.addEventListener('resize', onResize)
      vv.addEventListener('scroll', onResize)
      return () => {
        vv.removeEventListener('resize', onResize)
        vv.removeEventListener('scroll', onResize)
        document.removeEventListener('focusin', onFocus)
      }
    }

    return () => document.removeEventListener('focusin', onFocus)
  }, [])

  return null
}
