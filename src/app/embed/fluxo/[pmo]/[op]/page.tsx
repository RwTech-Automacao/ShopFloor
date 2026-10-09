import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { listarOrdens } from '@/modules/shopfloor/infra/fluxo-repository'
import { listarTodasOrdens } from '@/modules/shopfloor/infra/pesquisa-repository'
import { FluxoForm } from '@/app/(app)/shopfloor/fluxo/fluxo-form'
import { lerModoTv } from '@/shared/lib/modo-tv'
import { EmbedPonte } from '../../../embed-ponte'
import { origemDashboard, type CodigoErroEmbed, type TipoMensagemEmbed } from '@/shared/lib/mensagem-embed'

/**
 * O Fluxo da OP embutido no Dashboard Enterplak: `/embed/fluxo/<pmo>/<op>`.
 *
 * É a tela REAL do ShopFloor — o mesmo `FluxoForm` da rota `/shopfloor/fluxo`, só com a OP fixa e o
 * seletor oculto. Nada de cópia: melhoria no Fluxo aparece no dashboard sozinha.
 *
 * A tela busca TUDO por Server Action, que é POST pra própria URL `/embed/...` — então o cookie de
 * sessão do embed (`Path=/embed`) vai junto e nada falta. ⚠️ Não introduzir `fetch('/api/...')`,
 * `<Link>`, `href` nem `router.push` aqui: sairiam do prefixo e levariam a sessão errada (ou
 * nenhuma). `?modo=tv` é só layout: nada de rede nova.
 */
export default async function FluxoEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ pmo: string; op: string }>
  searchParams: Promise<{ modo?: string | string[] }>
}) {
  const cru = await params
  // `?modo=tv`: o Dashboard manda quando ELE está em tela cheia. Só liga o layout — a tela cheia
  // do navegador continua do Dashboard (o Fluxo não a pede nem a larga). `embed` vai SEMPRE: é ele
  // (não o ?modo=tv) que esconde Filtro/Zoom/Defeitos até o hover.
  const modoTv = lerModoTv((await searchParams).modo)
  // ⚠️ Os segmentos chegam codificados: a OP do ShopFloor tem `/` no nome (2340/26) e viaja como
  // `2340%2F26`. Sem o decode nenhuma OP casaria com o banco.
  const pmo = decodificar(cru.pmo)
  const op = decodificar(cru.op)
  const origem = origemDashboard()

  const sessao = await getSessao()
  // Sem sessão a página responde 200 (o middleware NÃO redireciona `/embed/*`, por desenho): quem
  // decide o que fazer é o dashboard, avisado pela ponte.
  if (!sessao) {
    return (
      <Aviso
        origem={origem}
        tipo="sf-embed:login-required"
        titulo="Conectando…"
        texto="Abrindo a sessão do dashboard no ShopFloor."
      />
    )
  }
  if (!podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return (
      <Aviso
        origem={origem}
        tipo="sf-embed:error"
        codigo="forbidden"
        titulo="Acesso restrito"
        texto="Esta conta não tem permissão para ver o fluxo das OPs."
      />
    )
  }

  if (pmo === null || op === null) return <OpNaoEncontrada origem={origem} />

  const [ops, ordensDashboard] = await Promise.all([listarOrdens(), listarTodasOrdens()])
  if (!ops.some((o) => o.pmo === pmo && o.op === op)) return <OpNaoEncontrada origem={origem} />

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <FluxoForm ops={ops} ordensDashboard={ordensDashboard} opFixa={{ pmo, op }} ocultarSeletor embed modoTv={modoTv} />
      <EmbedPonte origem={origem} tipo="sf-embed:ready" />
    </div>
  )
}

/** Decodifica o segmento da URL; `null` quando vem mal formado (`%E0%A4%A` e companhia). */
function decodificar(valor: string): string | null {
  try {
    return decodeURIComponent(valor)
  } catch {
    return null
  }
}

function OpNaoEncontrada({ origem }: { origem: string }) {
  return (
    <Aviso
      origem={origem}
      tipo="sf-embed:error"
      codigo="op-not-found"
      titulo="OP não encontrada"
      texto="Esta OP não existe mais no ShopFloor. Atualize a lista de OPs no dashboard."
    />
  )
}

/** Tela simples (sem menu, sem cabeçalho) + o aviso ao pai. */
function Aviso({
  origem,
  tipo,
  codigo,
  titulo,
  texto,
}: {
  origem: string
  tipo: TipoMensagemEmbed
  codigo?: CodigoErroEmbed
  titulo: string
  texto: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-base font-semibold text-tinta">{titulo}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{texto}</p>
      <EmbedPonte origem={origem} tipo={tipo} codigo={codigo} />
    </div>
  )
}
