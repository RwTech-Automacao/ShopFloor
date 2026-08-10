'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

interface KioskState {
  ligado: boolean
  abas: string[]
}
interface KioskCtx extends KioskState {
  rotaInicial: string
  ativar: (abas: string[]) => void
  sair: () => void
}

const CHAVE = 'sf:kiosk'
const Ctx = createContext<KioskCtx | null>(null)

function ler(): KioskState {
  try {
    const raw = localStorage.getItem(CHAVE)
    if (raw) {
      const p = JSON.parse(raw) as { ligado?: unknown; abas?: unknown }
      if (p.ligado === true && Array.isArray(p.abas) && p.abas.length > 0) {
        return { ligado: true, abas: p.abas.map(String) }
      }
    }
  } catch {
    /* localStorage indisponível ou JSON inválido → destravado */
  }
  return { ligado: false, abas: [] }
}

export function KioskProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<KioskState>({ ligado: false, abas: [] })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstado(ler())
  }, [])

  function ativar(abas: string[]) {
    const st: KioskState = { ligado: true, abas }
    localStorage.setItem(CHAVE, JSON.stringify(st))
    setEstado(st)
    document.documentElement.requestFullscreen?.().catch(() => {}) // gesto do clique cobre
  }
  function sair() {
    localStorage.removeItem(CHAVE)
    setEstado({ ligado: false, abas: [] })
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  }

  const rotaInicial = estado.abas[0] ?? '/shopfloor/operar/lancamento'
  return <Ctx.Provider value={{ ...estado, rotaInicial, ativar, sair }}>{children}</Ctx.Provider>
}

export function useKiosk(): KioskCtx {
  return (
    useContext(Ctx) ?? {
      ligado: false,
      abas: [],
      rotaInicial: '/shopfloor/operar/lancamento',
      ativar: () => {},
      sair: () => {},
    }
  )
}
