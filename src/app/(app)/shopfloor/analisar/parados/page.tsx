import Link from 'next/link'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { SemPermissao } from '@/shared/ui/sem-permissao'
import { lerPecasParadasTela, lerRegraParado } from '@/modules/alertas/infra/relatorio-parados-repository'
import { lerFiltros, queryDosFiltros } from '@/modules/alertas/domain/parados-filtros'
import { ParadosTela } from './parados-tela'

export const dynamic = 'force-dynamic'

const formatadorHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

/**
 * "Peças paradas": o estado de AGORA, com os filtros da própria tela (tempo, situação da OP, posto, tipo de
 * parada, agrupar por OP ou por posto, ordenar). O link da mensagem do alerta (`?regra=<id>`) abre com os
 * filtros preenchidos com os da regra; enquanto o `?regra=` estiver na URL, as PMOs e o turno da regra também
 * valem (a lista bate com a mensagem). "Limpar" volta aos filtros padrão.
 */
export default async function ParadosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return <SemPermissao descricao="Você não tem permissão para ver as peças paradas." />
  }

  const params = await searchParams
  const bruto = Array.isArray(params.regra) ? params.regra[0] : params.regra
  const pedida = bruto?.trim() ?? ''
  const regra = pedida !== '' ? await lerRegraParado(pedida) : null
  const filtros = lerFiltros(params, regra)
  const turnos = regra?.turnos ?? []
  const agora = new Date()
  const sns = await lerPecasParadasTela(
    { horas: filtros.horas, situacao: filtros.situacao, pmos: regra?.pmos ?? [], turnos }, agora,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-tinta">Peças paradas</h2>
        {pedida !== '' && regra === null && (
          <p className="text-sm text-muted-foreground">
            A regra do link não existe mais. A tela abriu com os filtros padrão.
          </p>
        )}
        {regra && (
          <p className="text-sm text-muted-foreground">
            Aberta pelo alerta &quot;{regra.nome || 'sem nome'}&quot;: filtros preenchidos com os da regra
            {regra.pmos.length > 0 ? ` · só PMOs ${regra.pmos.join(', ')}` : ''}
            {turnos.length > 0 ? ' · tempo em horas de expediente' : ''}.{' '}
            <Link href="/shopfloor/analisar/parados" className="text-enterplak underline-offset-2 hover:underline">
              Limpar
            </Link>
          </p>
        )}
        <p className="text-xs text-muted-foreground">Situação de agora ({formatadorHora.format(agora)}).</p>
      </div>
      <ParadosTela
        key={queryDosFiltros(filtros, regra?.id ?? null)}
        sns={sns}
        turnos={turnos}
        agora={agora}
        filtros={filtros}
        regraId={regra?.id ?? null}
      />
    </div>
  )
}
