'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { calcularCamposCalculados, type CampoCalc } from '../domain/calculos'
import { converterValor } from '../domain/conversao'
import {
  atualizarProcesso,
  buscarProcesso,
  carregarCamposFormulario,
  type PatchProcesso,
} from '../infra/processo-detalhe-repository'
import { carregarCriticidade, carregarTabelaNqa } from '../infra/referencias-repository'

export type ResultadoSalvarProcesso = { ok: true } | { ok: false; erro: string }

/**
 * Salva as edições de um processo de recebimento.
 *
 * Regras de permissão (checadas ANTES de qualquer leitura/gravação — o RLS
 * de `processos_update` é só o backstop, não o único portão):
 * - precisa de `editar`;
 * - se o processo já está `finalizado`, precisa também de `editar_finalizado`;
 * - `cancelado` nunca é editável, mesmo por quem administra.
 *
 * Só os campos presentes em `configuracao_campos` (ativos) são aceitos;
 * cada valor é validado/convertido pelo tipo do campo via `converterValor`
 * (campos do tipo `lista` aceitam o valor-texto tal como enviado — a
 * validação contra os itens da lista é responsabilidade da UI/select).
 *
 * Campos `calculado=true` (atraso, divergencia, critico, amostral,
 * responsavel_contagem) nunca são aceitos do cliente: qualquer valor
 * enviado para eles é descartado, e o servidor os recomputa
 * autoritativamente com `calcularCamposCalculados`, a partir dos valores
 * atuais do processo mesclados com as edições aceitas. O resultado
 * sobrescreve o patch antes de gravar.
 *
 * Se o processo ainda estava `aberto`, a primeira edição promove
 * automaticamente o status para `em_conferencia` (fica registrado como uma
 * segunda entrada de log `mudar_status`, além do `alterar_campo` da edição).
 */
export async function salvarProcesso(
  id: string,
  valores: Record<string, unknown>,
): Promise<ResultadoSalvarProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para editar processos.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }

  if (processo.status === 'cancelado') {
    return { ok: false, erro: 'Um processo cancelado não pode ser editado.' }
  }
  if (processo.status === 'finalizado' && !podeFazer(sessao.perfil, 'editar_finalizado')) {
    return { ok: false, erro: 'Você não tem permissão para editar um processo finalizado.' }
  }

  const campos = await carregarCamposFormulario()
  const camposPorNome = new Map(campos.map((c) => [c.campo, c]))
  const camposCalculados: CampoCalc[] = campos
    .filter((c) => c.calculado)
    .map((c) => ({ campo: c.campo, formula: c.formula, formulaConfig: c.formulaConfig }))

  const novosValores: Record<string, string | number | null> = {}
  const camposAlterados: string[] = []

  for (const [campo, bruto] of Object.entries(valores)) {
    const config = camposPorNome.get(campo)
    if (!config) continue // ignora campos desconhecidos/inativos vindos do form
    // Campos calculados são recomputados autoritativamente pelo servidor
    // logo abaixo — o valor enviado pelo cliente para eles é sempre
    // ignorado, nunca gravado.
    if (config.calculado) continue

    const resultado = converterValor(bruto, config.tipo)
    if (!resultado.ok) {
      return { ok: false, erro: `${config.rotulo}: ${resultado.erro}` }
    }
    novosValores[campo] = resultado.valor
    camposAlterados.push(campo)
  }

  // Recomputo autoritativo dos campos calculados: usa os valores atuais do
  // processo mesclados com as edições aceitas (não-calculadas) acima, nunca
  // o que o cliente eventualmente tenha enviado para um campo calculado.
  const valoresAtuais = processo as unknown as Record<string, unknown>
  const valoresParaCalculo: Record<string, unknown> = { ...valoresAtuais, ...novosValores }

  const [fornecedoresCriticos, nqa] = await Promise.all([carregarCriticidade(), carregarTabelaNqa()])

  const resultadoCalculo = calcularCamposCalculados(valoresParaCalculo, camposCalculados, {
    fornecedoresCriticos,
    nqa,
    usuarioAtual: sessao.nome || sessao.email,
    valoresAtuais,
  })

  const camposCalculadosAlterados: string[] = []
  for (const [campo, valor] of Object.entries(resultadoCalculo)) {
    // As colunas dos campos calculados (atraso, divergencia, critico,
    // amostral, responsavel_contagem) são todas texto — o domínio de
    // cálculo pode devolver number (diferenca_dias/diferenca_numerica/
    // tabela_nqa), que precisa virar string antes de entrar no patch.
    novosValores[campo] = typeof valor === 'number' ? String(valor) : valor
    camposCalculadosAlterados.push(campo)
  }

  const diff = calcularDiff(
    processo as unknown as Record<string, unknown>,
    novosValores,
    [...camposAlterados, ...camposCalculadosAlterados],
  )

  const eraAberto = processo.status === 'aberto'
  // Os valores já foram validados/convertidos linha a linha acima conforme
  // o `tipo` configurado de cada campo — o cast alinha o Record dinâmico ao
  // shape estático de `PatchProcesso` (o repositório ainda filtra por
  // coluna gravável em runtime, então isto não abre nenhuma coluna extra).
  const patch: PatchProcesso = {
    ...(novosValores as PatchProcesso),
    atualizado_por: sessao.usuarioId,
  }
  if (eraAberto) patch.status = 'em_conferencia'

  try {
    await atualizarProcesso(id, patch)
  } catch {
    return { ok: false, erro: 'Não foi possível salvar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Processo #${processo.numero} alterado`,
    dados: diff,
  })

  if (eraAberto) {
    await registrarLog({
      entidade: 'processo',
      entidadeId: id,
      acao: 'mudar_status',
      descricao: `Processo #${processo.numero}: aberto → em_conferencia`,
      dados: { de: 'aberto', para: 'em_conferencia' },
    })
  }

  revalidatePath(`/recebimento/processos/${id}`)
  return { ok: true }
}
