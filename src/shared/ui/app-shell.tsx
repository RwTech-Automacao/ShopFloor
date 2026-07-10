'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Settings,
  Menu,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { NAV_ITENS } from './nav-config'
import { sair } from '@/modules/auth/application/actions'
import { cn } from '@/lib/utils'

const ICONES: Record<string, LucideIcon> = {
  home: LayoutDashboard,
  recebimento: Inbox,
  configuracoes: Settings,
}

function iniciais(texto: string): string {
  const partes = texto.trim().split(/[\s@.]+/).filter(Boolean)
  const a = partes[0]?.[0] ?? '?'
  const b = partes.length > 1 ? (partes[1]?.[0] ?? '') : ''
  return (a + b).toUpperCase()
}

export function AppShell({
  nome,
  email,
  perfilNome,
  chavesVisiveis,
  children,
}: {
  nome: string
  email: string
  perfilNome: string
  chavesVisiveis: string[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileAberto, setMobileAberto] = useState(false)
  const itens = NAV_ITENS.filter((i) => chavesVisiveis.includes(i.chave))

  const ehAtivo = (href: string) => {
    const secao = '/' + (href.split('/')[1] ?? '')
    return pathname.startsWith(secao)
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Image
          src="/Logo_Docs.png"
          alt="Enterplak"
          width={132}
          height={44}
          priority
          style={{ height: 'auto' }}
          className="brightness-0 invert"
        />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-foreground/45 uppercase">
          Menu
        </p>
        {itens.map((item) => {
          const Icone = ICONES[item.chave] ?? LayoutDashboard
          const ativo = ehAtivo(item.href)
          return (
            <Link
              key={item.chave}
              href={item.href}
              onClick={() => setMobileAberto(false)}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                ativo
                  ? 'bg-sidebar-accent text-white shadow-sm'
                  : 'text-sidebar-foreground/80 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icone className="size-[18px] shrink-0" />
              {item.rotulo}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white">
            {iniciais(nome || email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{nome || email}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{perfilNome}</p>
          </div>
          <form action={sair}>
            <button
              type="submit"
              aria-label="Sair"
              className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar fixa (desktop) */}
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>

      {/* Drawer (mobile) */}
      {mobileAberto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileAberto(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar}</div>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileAberto(true)}
            className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="lg:hidden">
            <Image
              src="/Logo_Docs.png"
              alt="Enterplak"
              width={110}
              height={37}
              style={{ height: 'auto' }}
            />
          </div>
          <div className="flex-1" />
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
