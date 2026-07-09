import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { EtiquetasCliente } from './etiquetas-cliente'

export default async function EtiquetasPage() {
  const sessao = await getSessao()

  if (!sessao || !podeFazer(sessao.perfil, 'gerar_etiqueta')) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Etiquetas</h1>
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para gerar etiquetas.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Etiquetas</h1>
        <Link href="/recebimento/etiquetas/historico" className="text-sm text-enterplak hover:underline">
          Ver histórico de gerações
        </Link>
      </div>

      <EtiquetasCliente />
    </div>
  )
}
