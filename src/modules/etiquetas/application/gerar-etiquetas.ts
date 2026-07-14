'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { elegivelParaEtiqueta, gerarCsv, gerarEtiquetasDoProcesso, type LinhaEtiqueta, type ProcessoEtiqueta } from '../domain/partnumber'
import {
  buscarProcessosParaEtiqueta,
  carregarProcessosPorId,
  registrarGeracao,
  type FiltroTipoEtiqueta,
} from '../infra/etiqueta-repository'

export type ResultadoGerarEtiquetas =
  | {
      ok: true
      csv: string
      fileName: string
      totalEtiquetas: number
      totalProcessos: number
      ignorados: number
    }
  | { ok: false; erro: string }

function carimboDataHora(agora: Date): string {
  // Componentes no fuso de Brasília (o servidor roda em UTC na Vercel), para o
  // nome do arquivo refletir o horário local de quem gerou as etiquetas.
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${parte('year')}${parte('month')}${parte('day')}_${parte('hour')}${parte('minute')}${parte('second')}`
}

/**
 * Gera as etiquetas dos processos selecionados, autoritativamente no
 * servidor: os dados usados no cálculo do part number vêm de
 * `carregarProcessosPorId` (banco), nunca do que o cliente eventualmente
 * tenha enviado sobre cada processo — o cliente só manda os `id`s.
 *
 * Exige a permissão `gerar_etiqueta`. Processos incompletos (sem código,
 * pedido ou documento válidos — ver `gerarEtiquetasDoProcesso`) são
 * ignorados e contados em `ignorados`; se nenhuma etiqueta sobrar, retorna
 * erro em vez de um CSV vazio.
 *
 * Em caso de sucesso, registra a geração em `geracoes_etiquetas`
 * (histórico/auditoria) e loga a ação (`registrarLog`), usando o id da
 * geração como `entidadeId`.
 */
export async function gerarEtiquetas({
  processoIds,
  filtroTipo,
  filtroValor,
}: {
  processoIds: string[]
  filtroTipo: FiltroTipoEtiqueta
  filtroValor: string
}): Promise<ResultadoGerarEtiquetas> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'gerar_etiqueta')) {
    return { ok: false, erro: 'Você não tem permissão para gerar etiquetas.' }
  }

  if (processoIds.length === 0) {
    return { ok: false, erro: 'Selecione ao menos um processo.' }
  }

  const processos = await carregarProcessosPorId(processoIds)

  const linhas: LinhaEtiqueta[] = []
  let ignorados = 0
  for (const processo of processos) {
    if (!elegivelParaEtiqueta(processo).elegivel) {
      ignorados += 1
      continue
    }
    linhas.push(...gerarEtiquetasDoProcesso(processo).etiquetas)
  }

  if (linhas.length === 0) {
    return { ok: false, erro: 'Nenhuma etiqueta a gerar (processos não concluídos ou com campos incompletos).' }
  }

  const csv = gerarCsv(linhas)
  const fileName = `Etiquetas_partnumber_${carimboDataHora(new Date())}.csv`

  const geracaoId = await registrarGeracao({
    filtroTipo,
    filtroValor,
    totalProcessos: processos.length,
    totalEtiquetas: linhas.length,
    processoIds,
    usuarioId: sessao.usuarioId,
    usuarioNome: sessao.nome || sessao.email,
  })

  await registrarLog({
    entidade: 'etiqueta',
    entidadeId: geracaoId,
    acao: 'gerar_etiqueta',
    descricao: `Geração de ${linhas.length} etiqueta(s) de ${processos.length} processo(s)`,
    dados: { totalEtiquetas: linhas.length, totalProcessos: processos.length },
  })

  return {
    ok: true,
    csv,
    fileName,
    totalEtiquetas: linhas.length,
    totalProcessos: processos.length,
    ignorados,
  }
}

/**
 * Busca processos candidatos para a tela de geração de etiquetas. Exige
 * `gerar_etiqueta` ou `visualizar` — quem só visualiza pode conferir a
 * prévia, mas não gerar (checado em `gerarEtiquetas`). O cliente computa a
 * prévia do part number a partir do domínio puro (`gerarEtiquetasDoProcesso`).
 */
export async function buscarEtiquetas(
  tipo: FiltroTipoEtiqueta,
  termo: string,
): Promise<{ ok: true; processos: ProcessoEtiqueta[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !(podeFazer(sessao.perfil, 'gerar_etiqueta') || podeFazer(sessao.perfil, 'visualizar'))) {
    return { ok: false, erro: 'Você não tem permissão para consultar processos.' }
  }

  const processos = await buscarProcessosParaEtiqueta({ tipo, termo })
  return { ok: true, processos }
}
