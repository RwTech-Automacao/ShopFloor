import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { carregarItensPorLista } from '@/modules/recebimento/infra/campo-comercial-repository'
import {
  buscarProcesso,
  carregarCamposFormulario,
} from '@/modules/recebimento/infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '@/modules/recebimento/infra/referencias-repository'
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import { buscarNomesUsuarios } from '@/modules/usuarios/infra/usuario-admin-repository'
import { ProcessoDetalhe } from './processo-detalhe'

interface ProcessoDetalhePageProps {
  params: Promise<{ id: string }>
}

export default async function ProcessoDetalhePage({ params }: ProcessoDetalhePageProps) {
  const { id } = await params

  const processo = await buscarProcesso(id)
  if (!processo) notFound()

  const [sessao, campos, fornecedoresCriticos, nqa] = await Promise.all([
    getSessao(),
    carregarCamposFormulario(),
    carregarCriticidade(),
    carregarTabelaNqa(),
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

  // Editável quando aberto/em_conferencia + `editar`; em status terminal
  // (finalizado, ou qualquer outro resultado dinâmico) só com
  // `editar_finalizado`.
  const editavelPorStatus =
    processo.status === 'aberto' || processo.status === 'em_conferencia'
      ? podeEditar
      : podeEditarFinalizado
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
      />
    </div>
  )
}
