import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { listarPostos } from '@/modules/shopfloor/infra/ordem-repository'
import { listarPerfis, postoEmUsoEmOrdem } from '@/modules/shopfloor/infra/postos-repository'
import { PostosLista } from './postos-lista'

export default async function PostosPage() {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return <SemPermissao descricao="Você não tem permissão para gerenciar postos." />
  }

  const [postosTodos, perfis] = await Promise.all([listarPostos(), listarPerfis()])
  // Manutenção é um posto PARALELO (tela própria de reparo, fora do fluxo) — não entra na gestão de Postos.
  const postos = postosTodos.filter((p) => p.perfil !== 'manutencao')

  const emUso = new Set<string>()
  await Promise.all(
    postos.map(async (p) => {
      if (await postoEmUsoEmOrdem(p.chave)) emUso.add(p.chave)
    }),
  )

  return <PostosLista postos={postos} perfis={perfis} emUso={[...emUso]} />
}
