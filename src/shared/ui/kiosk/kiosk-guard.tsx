'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useKiosk } from './kiosk-context'
import { abaPermitida } from './abas'

/** Com o kiosk ligado, redireciona qualquer rota fora das abas permitidas pra rota inicial. */
export function KioskGuard() {
  const { ligado, abas, rotaInicial } = useKiosk()
  const pathname = usePathname()
  const router = useRouter()
  useEffect(() => {
    if (ligado && !abaPermitida(pathname, abas)) router.replace(rotaInicial)
  }, [ligado, abas, pathname, rotaInicial, router])
  return null
}
