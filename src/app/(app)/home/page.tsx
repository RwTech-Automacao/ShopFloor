import Link from 'next/link'
import { ArrowRight, Inbox, Workflow, type LucideIcon } from 'lucide-react'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer, type Permissao } from '@/modules/auth/domain/perfil'

interface Atalho {
  titulo: string
  descricao: string
  href: string
  icone: LucideIcon
  permissao: Permissao
}

const ATALHOS: Atalho[] = [
  {
    titulo: 'Recebimento',
    descricao: 'Importe planilhas, confira e acompanhe os processos de recebimento.',
    href: '/recebimento/processos',
    icone: Inbox,
    permissao: 'visualizar',
  },
  {
    titulo: 'Fluxo de Processos',
    descricao: 'Lançamento por posto, integração, manutenção e rastreio das placas.',
    href: '/shopfloor/lancamento',
    icone: Workflow,
    permissao: 'lancar',
  },
]

export default async function HomePage() {
  const sessao = await getSessao()
  const primeiroNome = (sessao?.nome || sessao?.email || '').split(/[\s@]/)[0]
  const atalhos = ATALHOS.filter((a) => podeFazer(sessao?.perfil ?? null, a.permissao))

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Bem-vindo, {primeiroNome} <span className="align-middle">👋</span>
      </h1>
      <p className="mt-1 text-muted-foreground">Selecione uma área para começar.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {atalhos.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          >
            <div className="flex size-11 items-center justify-center rounded-lg bg-accent text-primary">
              <a.icone className="size-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground">{a.titulo}</h2>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">{a.descricao}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              Acessar
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
