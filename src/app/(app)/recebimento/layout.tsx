import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { RECEBIMENTO_NAV, itensRecebimentoVisiveis } from '@/shared/ui/recebimento-nav'

export default async function RecebimentoLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) redirect('/home')

  const itens = itensRecebimentoVisiveis(RECEBIMENTO_NAV, sessao.perfil)

  return (
    <div className="flex gap-6">
      <nav className="flex w-56 shrink-0 flex-col gap-1">
        {itens.map((i) => (
          <Link key={i.chave} href={i.href}
            className="rounded-md px-3 py-2 text-sm hover:bg-enterplak-50 hover:text-enterplak">
            {i.rotulo}
          </Link>
        ))}
      </nav>
      <section className="flex-1">{children}</section>
    </div>
  )
}
