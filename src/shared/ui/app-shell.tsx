'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  Home,
  Inbox,
  Factory,
  FileStack,
  Cog,
  LineChart,
  Upload,
  ClipboardList,
  FileDown,
  Tags,
  ImageDown,
  Users,
  ShieldCheck,
  List,
  SlidersHorizontal,
  Columns3,
  Settings,
  Settings2,
  Bug,
  Wrench,
  Waypoints,
  TriangleAlert,
  Table2,
  History,
  ScrollText,
  Info,
  ChevronDown,
  Menu,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Lock,
  MonitorCog,
  type LucideIcon,
} from 'lucide-react'
import { sair } from '@/modules/auth/application/actions'
import { podeNoModulo, type Modulo, type Perfil, type Permissao } from '@/modules/auth/domain/perfil'
import { cn } from '@/lib/utils'
import { useKiosk } from './kiosk/kiosk-context'
import { KioskTabs } from './kiosk/kiosk-tabs'
import { KioskGuard } from './kiosk/kiosk-guard'
import { KioskExitDialog } from './kiosk/kiosk-exit-dialog'
import { KioskSetupDialog } from './kiosk/kiosk-setup-dialog'

interface Folha {
  chave: string
  rotulo: string
  href: string
  icone: LucideIcon
  perm: Permissao
}

// Itens sujeitos ao gate fino por módulo (menu lateral).
interface FolhaModular extends Folha {
  modulo: Modulo
}

const HOME: Folha = { chave: 'home', rotulo: 'Home', href: '/home', icone: Home, perm: 'visualizar' }

const RECEBIMENTO: FolhaModular[] = [
  { chave: 'importar', rotulo: 'Importar Planilha', href: '/recebimento/importar', icone: Upload, modulo: 'recebimento', perm: 'importar' },
  { chave: 'processos', rotulo: 'Processos', href: '/recebimento/processos', icone: ClipboardList, modulo: 'recebimento', perm: 'visualizar' },
  { chave: 'importacoes', rotulo: 'Importações', href: '/recebimento/importacoes', icone: FileDown, modulo: 'recebimento', perm: 'visualizar' },
  { chave: 'etiquetas', rotulo: 'Etiquetas', href: '/recebimento/etiquetas', icone: Tags, modulo: 'recebimento', perm: 'gerar_etiqueta' },
  { chave: 'exportar-fotos', rotulo: 'Exportar Fotos', href: '/recebimento/exportar-fotos', icone: ImageDown, modulo: 'recebimento', perm: 'administrar' },
]

const SHOPFLOOR: FolhaModular[] = [
  { chave: 'operar', rotulo: 'Operação', href: '/shopfloor/operar', icone: Cog, modulo: 'shopfloor', perm: 'lancar' },
  { chave: 'analisar', rotulo: 'Análise', href: '/shopfloor/analisar', icone: LineChart, modulo: 'shopfloor', perm: 'visualizar' },
  { chave: 'registros', rotulo: 'Registros', href: '/shopfloor/registros', icone: History, modulo: 'shopfloor', perm: 'visualizar' },
  { chave: 'op-ordens', rotulo: 'Ordens de Produção', href: '/shopfloor/ordens', icone: FileStack, modulo: 'shopfloor', perm: 'administrar' },
]

// Itens de Configurações que ficam "soltos" acima do accordion.
const CONFIG_TOPO: FolhaModular[] = [
  { chave: 'usuarios', rotulo: 'Usuários', href: '/configuracoes/usuarios', icone: Users, modulo: 'sistema', perm: 'administrar' },
  { chave: 'perfis', rotulo: 'Perfis', href: '/configuracoes/perfis', icone: ShieldCheck, modulo: 'sistema', perm: 'administrar' },
]

// Configurações específicas do módulo de Recebimento, agrupadas num accordion.
const CONFIG_RECEBIMENTO: FolhaModular[] = [
  { chave: 'listas', rotulo: 'Listas Suspensas', href: '/configuracoes/listas', icone: List, modulo: 'recebimento', perm: 'administrar' },
  { chave: 'campos', rotulo: 'Campos', href: '/configuracoes/campos', icone: SlidersHorizontal, modulo: 'recebimento', perm: 'administrar' },
  { chave: 'colunas', rotulo: 'Colunas da Lista', href: '/configuracoes/colunas', icone: Columns3, modulo: 'recebimento', perm: 'administrar' },
  { chave: 'criticidade', rotulo: 'Criticidade', href: '/configuracoes/criticidade', icone: TriangleAlert, modulo: 'recebimento', perm: 'administrar' },
  { chave: 'nqa', rotulo: 'Tabela NQA', href: '/configuracoes/nqa', icone: Table2, modulo: 'recebimento', perm: 'administrar' },
]

// Configurações específicas do módulo ShopFloor, agrupadas num accordion.
const CONFIG_SHOPFLOOR: FolhaModular[] = [
  { chave: 'sf-postos', rotulo: 'Postos', href: '/configuracoes/sf-postos', icone: Waypoints, modulo: 'shopfloor', perm: 'administrar' },
  { chave: 'sf-defeitos', rotulo: 'Defeitos', href: '/configuracoes/sf-defeitos', icone: Bug, modulo: 'shopfloor', perm: 'administrar' },
  { chave: 'sf-consertos', rotulo: 'Consertos', href: '/configuracoes/sf-consertos', icone: Wrench, modulo: 'shopfloor', perm: 'administrar' },
]

// Itens de Configurações que ficam "soltos" abaixo do accordion. Logs do
// sistema não é específico de um módulo de negócio — trata-se como 'sistema'.
const CONFIG_BASE: FolhaModular[] = [
  { chave: 'logs', rotulo: 'Logs do Sistema', href: '/configuracoes/logs', icone: ScrollText, modulo: 'sistema', perm: 'administrar' },
]

const CONFIG_TODOS: FolhaModular[] = [...CONFIG_TOPO, ...CONFIG_RECEBIMENTO, ...CONFIG_SHOPFLOOR, ...CONFIG_BASE]

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
  perfil,
  exportarFotosVisivel,
  children,
}: {
  nome: string
  email: string
  perfilNome: string
  perfil: Perfil
  exportarFotosVisivel: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [mobileAberto, setMobileAberto] = useState(false)
  const [menuRecolhido, setMenuRecolhido] = useState(false)
  const { ligado: kioskLigado } = useKiosk()
  const [setupAberto, setSetupAberto] = useState(false)
  const [exitAberto, setExitAberto] = useState(false)
  useEffect(() => {
    if (localStorage.getItem('sf:menu-recolhido') === '1') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMenuRecolhido(true)
    }
  }, [])
  useEffect(() => {
    localStorage.setItem('sf:menu-recolhido', menuRecolhido ? '1' : '0')
  }, [menuRecolhido])
  const pode = (item: FolhaModular) => podeNoModulo(perfil, item.modulo, item.perm)

  const recebimentoVisivel = RECEBIMENTO.filter(
    (i) => pode(i) && (i.chave !== 'exportar-fotos' || exportarFotosVisivel),
  )
  // Gate "de área": qualquer admin (em algum módulo) abre o accordion; os
  // itens internos filtram fino por módulo logo abaixo.
  const podeConfig = perfil.permissoes.administrar === true
  const configTopo = podeConfig ? CONFIG_TOPO.filter(pode) : []
  const configRec = podeConfig ? CONFIG_RECEBIMENTO.filter(pode) : []
  const configSf = podeConfig ? CONFIG_SHOPFLOOR.filter(pode) : []
  const configBase = podeConfig ? CONFIG_BASE.filter(pode) : []
  const temConfig = configTopo.length + configRec.length + configSf.length + configBase.length > 0
  const recebimentoAtivo = pathname.startsWith('/recebimento')
  const [recAberto, setRecAberto] = useState(recebimentoAtivo)
  const shopfloorVisivel = SHOPFLOOR.filter(pode)
  const shopfloorAtivo = pathname.startsWith('/shopfloor')
  const [shopfloorAberto, setShopfloorAberto] = useState(shopfloorAtivo)
  const configAtivo = CONFIG_TODOS.some((i) => ehAtivo(pathname, i.href))
  const [configAberto, setConfigAberto] = useState(configAtivo)
  const configRecAtivo = CONFIG_RECEBIMENTO.some((i) => ehAtivo(pathname, i.href))
  const [configRecAberto, setConfigRecAberto] = useState(configRecAtivo)
  const configSfAtivo = CONFIG_SHOPFLOOR.some((i) => ehAtivo(pathname, i.href))
  const [configSfAberto, setConfigSfAberto] = useState(configSfAtivo)

  const tituloPagina =
    [HOME, ...RECEBIMENTO, ...SHOPFLOOR, ...CONFIG_TODOS, AJUDA]
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

        {shopfloorVisivel.length > 0 && (
          <>
            {rotuloGrupo('Fluxo de Processos')}
            <button
              type="button"
              onClick={() => setShopfloorAberto((v) => !v)}
              className={cn(linkClasse(false), 'w-full justify-between')}
            >
              <span className="flex items-center gap-3">
                <Factory className="size-[18px] shrink-0" />
                Fluxo de Processos
              </span>
              <ChevronDown className={cn('size-4 transition-transform', shopfloorAberto && 'rotate-180')} />
            </button>
            {shopfloorAberto && (
              <div className="mt-1 space-y-1 border-l border-border pl-3 ml-4">
                {shopfloorVisivel.map((i) => (
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

                {configSf.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfigSfAberto((v) => !v)}
                      className={cn(linkClasse(false), 'w-full justify-between')}
                    >
                      <span className="flex items-center gap-3">
                        <Settings2 className="size-[18px] shrink-0" />
                        Ajustes ShopFloor
                      </span>
                      <ChevronDown className={cn('size-4 transition-transform', configSfAberto && 'rotate-180')} />
                    </button>
                    {configSfAberto && (
                      <div className="mt-1 space-y-1 border-l border-border pl-3 ml-4">
                        {configSf.map((i) => (
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
        {podeConfig && !kioskLigado && (
          <button
            type="button"
            onClick={() => setSetupAberto(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <MonitorCog className="size-[18px] shrink-0" /> Ativar modo quiosque
          </button>
        )}
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
      <KioskGuard />
      <KioskExitDialog aberto={exitAberto} onFechar={() => setExitAberto(false)} />
      {podeConfig && <KioskSetupDialog aberto={setupAberto} onFechar={() => setSetupAberto(false)} />}

      {!kioskLigado && (
        <aside
          className={cn(
            'hidden shrink-0 overflow-hidden transition-[width] duration-200 lg:block',
            menuRecolhido ? 'lg:w-0' : 'lg:w-64',
          )}
        >
          {sidebar}
        </aside>
      )}

      {!kioskLigado && mobileAberto && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={fechaMobile} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar}</div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
          {!kioskLigado && (
            <>
              <button
                type="button"
                onClick={() => setMenuRecolhido((v) => !v)}
                className="-ml-1 hidden rounded-md p-2 text-muted-foreground hover:bg-accent lg:inline-flex"
                aria-label={menuRecolhido ? 'Mostrar menu' : 'Recolher menu'}
              >
                {menuRecolhido ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
              </button>
              <button
                type="button"
                onClick={() => setMobileAberto(true)}
                className="-ml-1 rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
                aria-label="Abrir menu"
              >
                <Menu className="size-5" />
              </button>
            </>
          )}
          <h1 className="text-[15px] font-semibold text-foreground">{tituloPagina}</h1>
          {kioskLigado && (
            <button
              type="button"
              onClick={() => setExitAberto(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Lock className="size-4" /> Sair do quiosque
            </button>
          )}
        </header>

        <KioskTabs />

        {/* pb inclui --kb-inset: quando o teclado virtual (Windows) abre, o conteúdo ganha espaço
            de rolagem e o campo focado (ex.: filtro de defeito do acordeão) sobe acima do teclado. */}
        <main className="flex-1 overflow-y-auto p-4 pb-[calc(1rem+var(--kb-inset,0px))] scroll-pb-[var(--kb-inset,0px)] sm:p-6 sm:pb-[calc(1.5rem+var(--kb-inset,0px))] lg:p-8 lg:pb-[calc(2rem+var(--kb-inset,0px))]">
          {children}
        </main>
      </div>
    </div>
  )
}
