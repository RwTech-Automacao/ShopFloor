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
import { rotuloStatusProcesso } from '@/modules/recebimento/domain/status-processo'
import { ProcessoDetalhe } from './processo-detalhe'

interface ProcessoDetalhePageProps {
  params: Promise<{ id: string }>
}

export default async function ProcessoDetalhePage({ params }: ProcessoDetalhePageProps) {
  const { id } = await params

  const processo = await buscarProcesso(id)
  if (!processo) notFound()

  const [sessao, campos] = await Promise.all([getSessao(), carregarCamposFormulario()])

  const chavesLista = [
    ...new Set(
      campos
        .filter((campo) => campo.tipo === 'lista' && campo.listaChave)
        .map((campo) => campo.listaChave as string),
    ),
  ]
  const itensPorLista = await carregarItensPorLista(chavesLista)

  const perfil = sessao?.perfil ?? null
  const podeEditar = podeFazer(perfil, 'editar')
  const podeFinalizar = podeFazer(perfil, 'finalizar')
  const podeExcluir = podeFazer(perfil, 'excluir')
  const podeEditarFinalizado = podeFazer(perfil, 'editar_finalizado')

  // Editável quando aberto/em_conferencia + `editar`; finalizado só com
  // `editar_finalizado`; cancelado é sempre somente-leitura (terminal).
  const editavelPorStatus =
    processo.status === 'aberto' || processo.status === 'em_conferencia'
      ? podeEditar
      : processo.status === 'finalizado'
        ? podeEditarFinalizado
        : false
  const somenteLeitura = !editavelPorStatus

  const valoresIniciais: Record<string, string | number | null> = {}
  const processoRegistro = processo as unknown as Record<string, string | number | null>
  for (const campo of campos) {
    valoresIniciais[campo.campo] = processoRegistro[campo.campo] ?? null
  }

  const status = rotuloStatusProcesso(processo.status)

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
        podeExcluir={podeExcluir}
        podeEditarFinalizado={podeEditarFinalizado}
      />
    </div>
  )
}
