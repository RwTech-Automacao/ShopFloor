import { segredoConfere } from '@/modules/alertas/infra/assinatura'
import { carregarOpsEBipes } from '@/modules/shopfloor/infra/ops-ativas-repository'
import { corteParaDias, montarOpsAtivas, validarDias } from '@/modules/shopfloor/domain/ops-ativas'

/** Depende do cabeçalho e do relógio: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

const SEM_CACHE = { 'Cache-Control': 'no-store' } as const

/**
 * `GET /api/dashboard/ops-ativas?dias=<1..365>` — as OPs em andamento, para o Dashboard Enterplak
 * montar a lista de onde se abre o Fluxo embutido.
 *
 * Quem chama é uma função da Vercel (lado do dashboard), não um navegador: a prova é o segredo
 * `DASHBOARD_API_SECRET` em `Authorization: Bearer`, comparado em TEMPO CONSTANTE
 * (`segredoConfere`, o mesmo do cron dos alertas). Sem/errado → 401.
 *
 * ⚠️ Esta rota só executa porque `ehRotaDeDadosDoDashboard` a tira do redirect pro `/login` no
 * `middleware.ts` — o matcher do middleware cobre `/api/*`.
 *
 * `dias` recorta por ATIVIDADE: a OP precisa ter ao menos um bipe em `agora − dias`. Ausente, a
 * lista traz todas as OPs não finalizadas.
 *
 * Somente leitura: nada aqui escreve no banco.
 */
export async function GET(request: Request): Promise<Response> {
  // Ambiente sem o segredo falha o ENDPOINT (503), não a aplicação no boot — o ShopFloor roda em
  // instalações onde o dashboard não existe, e elas não podem deixar de subir por causa disso.
  const esperado = process.env.DASHBOARD_API_SECRET ?? ''
  if (esperado === '') {
    return Response.json(
      { erro: 'API do dashboard não configurada neste ambiente.' },
      { status: 503, headers: SEM_CACHE },
    )
  }

  // Só o formato `Bearer <segredo>`: o segredo cru, sem o prefixo, também é recusado.
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) {
    return Response.json({ erro: 'Não autorizado.' }, { status: 401, headers: SEM_CACHE })
  }

  const dias = validarDias(new URL(request.url).searchParams.get('dias'))
  if (dias === 'invalido') {
    return Response.json(
      { erro: 'O parâmetro "dias" deve ser um número inteiro de 1 a 365.' },
      { status: 400, headers: SEM_CACHE },
    )
  }

  const agora = new Date()
  const corte = dias === null ? null : corteParaDias(agora, dias)

  try {
    const { ordens, bipes } = await carregarOpsEBipes(corte)
    return Response.json(
      { geradoEm: agora.toISOString(), ops: montarOpsAtivas(ordens, bipes, corte !== null) },
      { headers: SEM_CACHE },
    )
  } catch (e) {
    // ⚠️ Só a mensagem do erro, nunca a URL (que carrega a query string) nem o cabeçalho.
    console.error('[dashboard] ops-ativas falhou:', e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503, headers: SEM_CACHE })
  }
}
