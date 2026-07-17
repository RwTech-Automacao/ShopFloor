import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { listarAnexosComUrl } from '@/modules/recebimento/infra/anexo-repository'
import { carregarItensPorLista } from '@/modules/recebimento/infra/campo-comercial-repository'
import {
  buscarProcesso,
  carregarCamposFormulario,
} from '@/modules/recebimento/infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '@/modules/recebimento/infra/referencias-repository'
import { ESTADO_GRID_PADRAO, decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import { vizinhosDaLista } from '@/modules/recebimento/domain/vizinhos'
import {
  TETO_VIZINHOS,
  carregarCatalogoColunas,
  listarIdsGrid,
} from '@/modules/recebimento/infra/processo-repository'
import { buscarNomesUsuarios } from '@/modules/usuarios/infra/usuario-admin-repository'
import { ProcessoDetalhe } from './processo-detalhe'

interface ProcessoDetalhePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ g?: string; i?: string }>
}

export default async function ProcessoDetalhePage({ params, searchParams }: ProcessoDetalhePageProps) {
  const { id } = await params
  const { g, i } = await searchParams

  const processo = await buscarProcesso(id)
  if (!processo) notFound()

  // Contexto do grid. Sem `?g=` (link direto/favorito), cai no padrão da lista — as
  // setas seguem vivas, navegando tudo em número desc.
  const catalogo = await carregarCatalogoColunas()
  const estado = g
    ? decodificarEstadoGrid(
        g,
        catalogo.map((c) => c.campo),
      )
    : ESTADO_GRID_PADRAO
  const tiposPorCampo = Object.fromEntries(catalogo.map((c) => [c.campo, c.tipo]))

  // A posição que a linha ocupava quando o link foi gerado. Só é usada se o processo
  // tiver saído do filtro (ex.: você o finalizou) — aí ela diz de onde continuar.
  const posicao = i !== undefined && /^\d+$/.test(i) ? Number(i) : null

  // Fail-safe: erro na consulta não pode derrubar a página do processo — as setas só
  // desabilitam.
  let ids: string[] = []
  try {
    ids = await listarIdsGrid(estado, tiposPorCampo)
  } catch {
    ids = []
  }
  // Veio mais que o teto → a lista está truncada e não dá para saber os vizinhos.
  const { anterior, proximo } =
    ids.length > TETO_VIZINHOS
      ? { anterior: null, proximo: null }
      : vizinhosDaLista(ids, id, posicao)

  const [sessao, campos, fornecedoresCriticos, nqa, anexos] = await Promise.all([
    getSessao(),
    carregarCamposFormulario(),
    carregarCriticidade(),
    carregarTabelaNqa(),
    listarAnexosComUrl(id),
  ])

  const chavesLista = [
    ...new Set(
      campos
        .filter((campo) => campo.tipo === 'lista' && campo.listaChave)
        .map((campo) => campo.listaChave as string),
    ),
  ]
  const itensPorLista = await carregarItensPorLista(chavesLista)

  // Nomes dos responsáveis por seção (exibição somente-leitura). São uuids
  // de `usuarios` carimbados por `salvarSecaoProcesso` — resolvidos aqui com
  // uma única consulta para os ids presentes.
  const idsResponsaveis = [
    ...new Set(
      [processo.responsavel_recebimento, processo.responsavel_qualidade].filter(
        (id): id is string => !!id,
      ),
    ),
  ]
  const nomesUsuarios =
    idsResponsaveis.length > 0 ? await buscarNomesUsuarios(idsResponsaveis) : {}
  const responsavelRecebimento = processo.responsavel_recebimento
    ? (nomesUsuarios[processo.responsavel_recebimento] ?? null)
    : null
  const responsavelQualidade = processo.responsavel_qualidade
    ? (nomesUsuarios[processo.responsavel_qualidade] ?? null)
    : null

  const perfil = sessao?.perfil ?? null
  const podeEditar = podeFazer(perfil, 'editar')
  const podeFinalizar = podeFazer(perfil, 'finalizar')
  const podeEditarFinalizado = podeFazer(perfil, 'editar_finalizado')

  // Editável só em aberto/em_conferencia (+ `editar`). Em status terminal
  // (Aprovado/Reprovado ou qualquer outro resultado) o processo é
  // SOMENTE-LEITURA — para editar é preciso Reabrir (ação separada, gateada por
  // `editar_finalizado`). `editar_finalizado` não permite mais editar o
  // concluído direto; agora só habilita o Reabrir.
  const editavelPorStatus =
    processo.status === 'aberto' || processo.status === 'em_conferencia'
      ? podeEditar
      : false
  const somenteLeitura = !editavelPorStatus

  const valoresIniciais: Record<string, string | number | null> = {}
  const processoRegistro = processo as unknown as Record<string, string | number | null>
  for (const campo of campos) {
    valoresIniciais[campo.campo] = processoRegistro[campo.campo] ?? null
  }

  const status = rotuloStatusProcesso(processo.status)
  const usuarioAtual = sessao?.nome || sessao?.email || ''

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/recebimento/processos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-enterplak hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Voltar para Processos
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Processo #{processo.numero}</h1>
          <Badge className={status.className}>{status.rotulo}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Fornecedor:{' '}
          <span className="font-medium text-foreground">{processo.fornecedor || '—'}</span>
        </p>
      </div>

      <ProcessoDetalhe
        processoId={processo.id}
        status={processo.status}
        campos={campos}
        itensPorLista={itensPorLista}
        valoresIniciais={valoresIniciais}
        somenteLeitura={somenteLeitura}
        podeFinalizar={podeFinalizar}
        podeEditarFinalizado={podeEditarFinalizado}
        fornecedoresCriticos={fornecedoresCriticos}
        nqa={nqa}
        usuarioAtual={usuarioAtual}
        responsavelRecebimento={responsavelRecebimento}
        responsavelQualidade={responsavelQualidade}
        anterior={anterior}
        proximo={proximo}
        g={g ?? ''}
        anexos={anexos}
      />
    </div>
  )
}
