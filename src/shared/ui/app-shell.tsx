'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home,
  Inbox,
  Upload,
  ClipboardList,
  FileDown,
  Tags,
  Users,
  ShieldCheck,
  List,
  SlidersHorizontal,
  Settings,
  Settings2,
  TriangleAlert,
  Table2,
  ScrollText,
  Info,
  ChevronDown,
  Menu,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { sair } from '@/modules/auth/application/actions'
import { cn } from '@/lib/utils'

type Perms = Record<string, boolean>

interface Folha {
  chave: string
  rotulo: string
  href: string
  icone: LucideIcon
  perm: string
}
const HOME: Folha = { chave: 'home', rotulo: 'Home', href: '/home', icone: Home, perm: 'visualizar' }

const RECEBIMENTO: Folha[] = [
  { chave: 'importar', rotulo: 'Importar Planilha', href: '/recebimento/importar', icone: Upload, perm: 'importar' },
  { chave: 'processos', rotulo: 'Processos', href: '/recebimento/processos', icone: ClipboardList, perm: 'visualizar' },
  { chave: 'importacoes', rotulo: 'Importações', href: '/recebimento/importacoes', icone: FileDown, perm: 'visualizar' },
  { chave: 'etiquetas', rotulo: 'Etiquetas', href: '/recebimento/etiquetas', icone: Tags, perm: 'gerar_etiqueta' },
]

const CONFIG_PERM = 'administrar'

// Itens de Configurações que ficam "soltos" acima do accordion.
const CONFIG_TOPO: Folha[] = [
  { chave: 'usuarios', rotulo: 'Usuários', href: '/configuracoes/usuarios', icone: Users, perm: 'administrar' },
  { chave: 'perfis', rotulo: 'Perfis', href: '/configuracoes/perfis', icone: ShieldCheck, perm: 'administrar' },
]

// Configurações específicas do módulo de Recebimento, agrupadas num accordion.
const CONFIG_RECEBIMENTO: Folha[] = [
  { chave: 'listas', rotulo: 'Listas Suspensas', href: '/configuracoes/listas', icone: List, perm: 'administrar' },
  { chave: 'campos', rotulo: 'Campos', href: '/configuracoes/campos', icone: SlidersHorizontal, perm: 'administrar' },
  { chave: 'criticidade', rotulo: 'Criticidade', href: '/configuracoes/criticidade', icone: TriangleAlert, perm: 'administrar' },
  { chave: 'nqa', rotulo: 'Tabela NQA', href: '/configuracoes/nqa', icone: Table2, perm: 'administrar' },
]

// Itens de Configurações que ficam "soltos" abaixo do accordion.
const CONFIG_BASE: Folha[] = [
  { chave: 'logs', rotulo: 'Logs do Sistema', href: '/configuracoes/logs', icone: ScrollText, perm: 'administrar' },
]

const CONFIG_TODOS: Folha[] = [...CONFIG_TOPO, ...CONFIG_RECEBIMENTO, ...CONFIG_BASE]

const AJUDA: Folha = { chave: 'sobre', rotulo: 'Sobre o Sistema', href: '/sobre', icone: Info, perm: 'visualizar' }

function iniciais(texto: string): string {
  const p = texto.trim().split(/[\s@.]+/).filter(Boolean)
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? '')).toUpperCase()
}

function ehAtivo(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

export function AppShell({
  nome,
  email,
  perfilNome,
  permissoes,
  children,
}: {
  nome: string
  email: string
  perfilNome: string
  permissoes: Perms
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileAberto, setMobileAberto] = useState(false)
  const pode = (perm: string) => permissoes[perm] === true

  const recebimentoVisivel = RECEBIMENTO.filter((i) => pode(i.perm))
  const podeConfig = pode(CONFIG_PERM)
  const configTopo = podeConfig ? CONFIG_TOPO.filter((i) => pode(i.perm)) : []
  const configRec = podeConfig ? CONFIG_RECEBIMENTO.filter((i) => pode(i.perm)) : []
  const configBase = podeConfig ? CONFIG_BASE.filter((i) => pode(i.perm)) : []
  const temConfig = configTopo.length + configRec.length + configBase.length > 0
  const recebimentoAtivo = pathname.startsWith('/recebimento')
  const [recAberto, setRecAberto] = useState(recebimentoAtivo)
  const configAtivo = CONFIG_TODOS.some((i) => ehAtivo(pathname, i.href))
  const [configAberto, setConfigAberto] = useState(configAtivo)
  const configRecAtivo = CONFIG_RECEBIMENTO.some((i) => ehAtivo(pathname, i.href))
  const [configRecAberto, setConfigRecAberto] = useState(configRecAtivo)

  const tituloPagina =
    [HOME, ...RECEBIMENTO, ...CONFIG_TODOS, AJUDA]
      .filter((i) => ehAtivo(pathname, i.href))
      .sort((a, b) => b.href.length - a.href.length)[0]?.rotulo ?? 'ShopFloor'

  const fechaMobile = () => setMobileAberto(false)

  const linkClasse = (ativo: boolean) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      ativo
        ? 'bg-primary text-primary-foreground shadow-sm'
        : 'text-foreground/75 hover:bg-accent hover:text-accent-foreground',
    )

  const rotuloGrupo = (t: string) => (
    <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t}</p>
  )

  const sidebar = (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Image src="/Logo_Docs.png" alt="Enterplak" width={130} height={44} priority style={{ height: 'auto' }} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <Link href={HOME.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, HOME.href))}>
          <HOME.icone className="size-[18px] shrink-0" />
          {HOME.rotulo}
        </Link>

        {recebimentoVisivel.length > 0 && (
          <>
            {rotuloGrupo('Recebimento')}
            <button
              type="button"
              onClick={() => setRecAberto((v) => !v)}
              className={cn(linkClasse(false), 'w-full justify-between')}
            >
              <span className="flex items-center gap-3">
                <Inbox className="size-[18px] shrink-0" />
                Recebimento
              </span>
              <ChevronDown className={cn('size-4 transition-transform', recAberto && 'rotate-180')} />
            </button>
            {recAberto && (
              <div className="mt-1 space-y-1 border-l border-border pl-3 ml-4">
                {recebimentoVisivel.map((i) => (
                  <Link key={i.chave} href={i.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, i.href))}>
                    <i.icone className="size-[18px] shrink-0" />
                    {i.rotulo}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        {temConfig && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setConfigAberto((v) => !v)}
              className={cn(linkClasse(false), 'w-full justify-between')}
            >
              <span className="flex items-center gap-3">
                <Settings className="size-[18px] shrink-0" />
                Configurações
              </span>
              <ChevronDown className={cn('size-4 transition-transform', configAberto && 'rotate-180')} />
            </button>
            {configAberto && (
              <div className="mt-1 space-y-1">
                {configTopo.map((i) => (
                  <Link key={i.chave} href={i.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, i.href))}>
                    <i.icone className="size-[18px] shrink-0" />
                    {i.rotulo}
                  </Link>
                ))}

                {configRec.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfigRecAberto((v) => !v)}
                      className={cn(linkClasse(false), 'w-full justify-between')}
                    >
                      <span className="flex items-center gap-3">
                        <Settings2 className="size-[18px] shrink-0" />
                        Ajustes Recebimento
                      </span>
                      <ChevronDown className={cn('size-4 transition-transform', configRecAberto && 'rotate-180')} />
                    </button>
                    {configRecAberto && (
                      <div className="mt-1 space-y-1 border-l border-border pl-3 ml-4">
                        {configRec.map((i) => (
                          <Link key={i.chave} href={i.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, i.href))}>
                            <i.icone className="size-[18px] shrink-0" />
                            {i.rotulo}
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {configBase.map((i) => (
                  <Link key={i.chave} href={i.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, i.href))}>
                    <i.icone className="size-[18px] shrink-0" />
                    {i.rotulo}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sobre é visível a todos os usuários logados (fica fora do guard de
            admin de /configuracoes, na rota /sobre). */}
        {rotuloGrupo('Ajuda')}
        <Link href={AJUDA.href} onClick={fechaMobile} className={linkClasse(ehAtivo(pathname, AJUDA.href))}>
          <AJUDA.icone className="size-[18px] shrink-0" />
          {AJUDA.rotulo}
        </Link>
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {iniciais(nome || email)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{nome || email}</p>
            <p className="truncate text-xs text-muted-foreground">{perfilNome}</p>
          </div>
          <form action={sair}>
            <button
              type="submit"
              aria-label="Sair"
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>

      {mobileAberto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={fechaMobile} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileAberto(true)}
            className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="text-[15px] font-semibold text-foreground">{tituloPagina}</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
