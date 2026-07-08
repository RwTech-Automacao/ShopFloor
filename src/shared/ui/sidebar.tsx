import Link from 'next/link'
import Image from 'next/image'
import { itensVisiveis, NAV_ITENS } from './nav-config'
import type { Perfil } from '@/modules/auth/domain/perfil'

export function Sidebar({ perfil }: { perfil: Perfil }) {
  const itens = itensVisiveis(NAV_ITENS, perfil)
  return (
    <aside className="flex w-64 flex-col border-r bg-white">
      <div className="p-6">
        <Image src="/Logo_Docs.png" alt="Enterplak" width={140} height={48} />
      </div>
      <nav className="flex flex-col gap-1 px-3">
        {itens.map((i) => (
          <Link key={i.chave} href={i.href}
            className="rounded-md px-3 py-2 text-sm hover:bg-enterplak-50 hover:text-enterplak">
            {i.rotulo}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
