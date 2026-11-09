'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { ehReativacaoManual, finalizadaPorDoCadastro } from '../domain/finalizacao'
import { validarOrdem } from '../domain/validar-ordem'
import { mensagemOpDuplicada } from '../domain/op-unica'
import { parseReceitaPorPosto, receitaParaLinhas } from '../domain/receita-posto'
import { parseTempoBurninPorPosto, temposParaLinhas } from '../domain/burnin-posto'
import { postoAlmoxarifadoPadrao, rotaDaEdicao, rotaPadraoOpNova } from '../domain/rota-op-nova'
import { mapaPostoPerfil } from '../infra/postos-repository'
import { faixasDe, faixasIguais, lerFaixasDoFormulario, type FaixaSN } from '../domain/faixas-sn'
import {
  criarOrdem,
  atualizarOrdem,
  excluirOrdem,
  contarRegistros,
  buscarOrdemBase,
  buscarOpEmUso,
  listarPostos,
  listarRotaGravada,
  contarSnsForaDasFaixas,
  type DadosOrdem,
} from '../infra/ordem-repository'

/**
 * `confirmarForaDaFaixa`: a edição NÃO foi gravada porque N SNs da OP ficariam fora das faixas novas
 * (ou no PMO/OP antigo). A tela pergunta e reenvia com `confirmar_fora_faixa=1`. É aviso, não trava.
 */
export type ResultadoOrdem =
  | { ok: true; id?: string; pmo?: string; op?: string }
  | { ok: false; erro: string; confirmarForaDaFaixa?: number }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar ordens de produção.'

/**
 * Faixas de SN do formulário (0181): o campo `faixas` (JSON da lista) ou, no formulário antigo, a faixa
 * única de `sn_ini`/`sn_fim`.
 */
function lerFaixas(fd: FormData): FaixaSN[] {
  const json = fd.get('faixas')
  return lerFaixasDoFormulario(json === null ? null : String(json), String(fd.get('sn_ini') ?? ''), String(fd.get('sn_fim') ?? ''))
}

function lerDados(fd: FormData): DadosOrdem {
  const qtdBruto = String(fd.get('qtd') ?? '').trim()
  const status = String(fd.get('status') ?? '').trim() || 'ATIVA'
  // sf_ordens.sn_ini/sn_fim = a PRIMEIRA faixa (0181); a lista inteira vai para sf_ordem_faixas.
  const primeira = lerFaixas(fd)[0] ?? { sn_ini: '', sn_fim: '' }
  return {
    pmo: String(fd.get('pmo') ?? '').trim(),
    op: String(fd.get('op') ?? '').trim(),
    cliente: String(fd.get('cliente') ?? '').trim(),
    qtd: qtdBruto === '' || Number.isNaN(Number(qtdBruto)) ? null : Number(qtdBruto),
    descricao: String(fd.get('descricao') ?? '').trim(),
    acp: String(fd.get('acp') ?? '').trim(),
    status,
    sn_ini: primeira.sn_ini,
    sn_fim: primeira.sn_fim,
    embalagem_individual: fd.get('embalagem_individual') === 'on', // checkbox: 1 produto por caixa
    // Ausente = 1; presente vale como veio (0, vazio ou inválido são recusados por validarOrdem).
    placas_por_painel: fd.has('placas_por_painel') ? Number(fd.get('placas_por_painel')) : 1,
    // Salvar pela tela é decisão de pessoa: FINALIZADA vira 'manual' (a rotina não desfaz); outro
    // status limpa a marca. Nunca lido do formulário, para o cliente não forjar 'rotina'.
    finalizada_por: finalizadaPorDoCadastro(status),
  }
}

/** Posto Almoxarifado do catálogo (pelo recurso do perfil), ou null se não existe. */
async function postoAlmoxarifado(): Promise<string | null> {
  const [catalogo, mapa] = await Promise.all([listarPostos(), mapaPostoPerfil()])
  return postoAlmoxarifadoPadrao(catalogo.map((p) => p.chave), (p) => mapa[p] ?? { recurso: 'nenhum' })
}

/** Fluxo ordenado enviado pelo form (campo `fluxo` = JSON de chaves), validado contra o catálogo. */
async function lerPostos(fd: FormData): Promise<string[]> {
  const catalogo = new Set((await listarPostos()).map((p) => p.chave))
  let bruto: unknown
  try {
    bruto = JSON.parse(String(fd.get('fluxo') ?? '[]'))
  } catch {
    return []
  }
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const fluxo: string[] = []
  for (const item of bruto) {
    const chave = String(item)
    if (catalogo.has(chave) && !vistos.has(chave)) {
      vistos.add(chave)
      fluxo.push(chave)
    }
  }
  return fluxo
}

/** Receita por posto vinda do form; mantém só postos de Integração (perfil) do fluxo. */
async function lerReceita(fd: FormData, postos: string[]): Promise<{ posto: string; pmo: string }[]> {
  const mapa = await mapaPostoPerfil()
  const postosIntegracao = postos.filter((p) => mapa[p]?.recurso === 'integracao')
  if (postosIntegracao.length === 0) return []
  const receita = parseReceitaPorPosto(String(fd.get('componentes') ?? '{}'), postosIntegracao)
  return receitaParaLinhas(receita)
}

/** Tempo mínimo de Burn-in por posto vindo do form; mantém só postos de Burn-in (perfil) do fluxo. */
async function lerBurnin(fd: FormData, postos: string[]): Promise<{ ok: true; rows: { posto: string; tempo_min: number }[] } | { ok: false; erro: string }> {
  const mapa = await mapaPostoPerfil()
  const postosBurnin = postos.filter((p) => mapa[p]?.recurso === 'burnin')
  if (postosBurnin.length === 0) return { ok: true, rows: [] }
  const r = parseTempoBurninPorPosto(String(fd.get('tempo_burnin') ?? '{}'), postosBurnin)
  if (!r.ok) return { ok: false, erro: `Tempo mínimo de Burn-in inválido no posto ${r.posto} (use hhh:mm).` }
  return { ok: true, rows: temposParaLinhas(r.tempos) }
}

/** A pergunta do aviso de SNs fora das faixas novas (ou presos no PMO/OP antigo). */
function mensagemForaDaFaixa(n: number, trocouOp: boolean, base: { pmo: string; op: string }): string {
  const quantos = n === 1 ? '1 registro ficaria' : `${n} registros ficariam`
  return trocouOp
    ? `${quantos} no PMO/OP antigo (${base.pmo}/${base.op}). Salvar mesmo assim?`
    : `${quantos} fora das faixas novas. Salvar mesmo assim?`
}

function ehDuplicidade(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

export async function criarOrdemAction(
  _prev: ResultadoOrdem | undefined,
  formData: FormData,
): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const dados = lerDados(formData)
  const faixas = lerFaixas(formData)
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim, qtd: dados.qtd, placasPorPainel: dados.placas_por_painel, faixas })
  if (!v.ok) return v
  // OP única global: o número da OP não pode existir em nenhum outro PMO.
  const emUso = await buscarOpEmUso(dados.op)
  if (emUso) return { ok: false, erro: mensagemOpDuplicada(emUso) }
  // OP nova: o Almoxarifado é obrigatório e fecha a rota, mesmo que o formulário não o mande.
  const postos = rotaPadraoOpNova(await lerPostos(formData), await postoAlmoxarifado())
  const receita = await lerReceita(formData, postos)
  const burnin = await lerBurnin(formData, postos)
  if (!burnin.ok) return { ok: false, erro: burnin.erro }

  let id: string
  try {
    id = await criarOrdem(dados, postos, receita, burnin.rows, faixas)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível criar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${dados.pmo}/${dados.op} criada`, dados: { ...dados, faixas } })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id, pmo: dados.pmo, op: dados.op }
}

export async function editarOrdemAction(
  _prev: ResultadoOrdem | undefined,
  formData: FormData,
): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const id = String(formData.get('id') ?? '').trim()
  if (id === '') return { ok: false, erro: 'OP inválida.' }
  const dados = lerDados(formData)
  // Reativar na mão (FINALIZADA -> outro status) tira a OP do controle automático para sempre, ou a
  // rotina dos 100% a fecharia de novo em até 5 minutos. O status ANTERIOR vem do banco: o do
  // formulário é do cliente, e a marca é definitiva demais para depender dele.
  const base = await buscarOrdemBase(id)
  // Fail-closed: sem ler a OP gravada não dá para aplicar as travas (buscarOrdemBase devolve null em qualquer erro de leitura).
  if (!base) return { ok: false, erro: 'OP não encontrada.' }
  if (ehReativacaoManual(base.status, dados.status)) dados.reaberta_manual = true
  const faixas = lerFaixas(formData)
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim, qtd: dados.qtd, placasPorPainel: dados.placas_por_painel, faixas })
  if (!v.ok) return v
  // Trava: com registros, mudar as placas por painel faria o histórico (`pecas` gravada com o N
  // antigo) divergir das telas que usam o N atual. O N atual e o par PMO/OP vêm do banco, não do form.
  if (dados.placas_por_painel !== base.placas_por_painel) {
    try {
      if ((await contarRegistros(base.pmo, base.op)) > 0) {
        return { ok: false, erro: 'Esta OP já tem registros; não é possível alterar as placas por painel.' }
      }
    } catch {
      return { ok: false, erro: 'Não foi possível salvar a OP.' }
    }
  }
  // OP única global: o número não pode colidir com OUTRA OP (exclui a própria).
  const emUso = await buscarOpEmUso(dados.op, id)
  if (emUso) return { ok: false, erro: mensagemOpDuplicada(emUso) }
  // Trava do Almoxarifado pela rota GRAVADA (não pelo form): se a OP já o tem, ele não sai e fica por
  // último; OP antiga sem ele segue como veio (nunca acrescentar em OP existente).
  let rotaGravada: string[]
  try {
    rotaGravada = await listarRotaGravada(id)
  } catch {
    return { ok: false, erro: 'Não foi possível salvar a OP.' }
  }
  const rota = rotaDaEdicao(rotaGravada, await lerPostos(formData), await postoAlmoxarifado())
  if (!rota.ok) return rota
  const postos = rota.rota
  const receita = await lerReceita(formData, postos)
  const burnin = await lerBurnin(formData, postos)
  if (!burnin.ok) return { ok: false, erro: burnin.erro }

  // Aviso (não trava): mexer nas faixas ou no PMO/OP de uma OP que já tem registros pode deixar SNs
  // de fora. Conta pelo banco e devolve a pergunta; a tela reenvia com `confirmar_fora_faixa=1`.
  if (formData.get('confirmar_fora_faixa') !== '1') {
    const trocouOp = dados.pmo !== base.pmo || dados.op !== base.op
    const faixasGravadas = faixasDe({ sn_ini: base.sn_ini ?? '', sn_fim: base.sn_fim ?? '', faixas: base.faixas })
    if (trocouOp || !faixasIguais(faixasGravadas, faixas)) {
      let fora: number
      try {
        fora = await contarSnsForaDasFaixas(base.pmo, base.op, trocouOp ? null : faixas)
      } catch {
        return { ok: false, erro: 'Não foi possível salvar a OP.' }
      }
      if (fora > 0) return { ok: false, erro: mensagemForaDaFaixa(fora, trocouOp, base), confirmarForaDaFaixa: fora }
    }
  }

  try {
    await atualizarOrdem(id, dados, postos, receita, burnin.rows, faixas)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível salvar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'alterar_campo', descricao: `OP ${dados.pmo}/${dados.op} editada`, dados: { ...dados, faixas } })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id, pmo: dados.pmo, op: dados.op }
}

/** A OP já tem lançamentos? Consulta leve (um HEAD count) para a tela travar as placas por painel; erro/sem permissão = false (o servidor trava de verdade ao salvar). */
export async function opTemRegistrosAction(id: string): Promise<boolean> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) return false
  const base = await buscarOrdemBase(id)
  if (!base) return false
  try {
    return (await contarRegistros(base.pmo, base.op)) > 0
  } catch {
    return false
  }
}

export async function excluirOrdemAction(id: string): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const base = await buscarOrdemBase(id)
  if (!base) return { ok: false, erro: 'OP não encontrada.' }

  try {
    const registros = await contarRegistros(base.pmo, base.op)
    if (registros > 0) {
      return { ok: false, erro: `Não é possível excluir: a OP já tem ${registros} lançamento(s).` }
    }
    await excluirOrdem(id)
  } catch {
    return { ok: false, erro: 'Não foi possível excluir a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'excluir', descricao: `OP ${base.pmo}/${base.op} excluída` })
  revalidatePath('/shopfloor/ordens')
  return { ok: true }
}
