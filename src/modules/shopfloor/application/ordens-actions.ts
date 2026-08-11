'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarOrdem } from '../domain/validar-ordem'
import { mensagemOpDuplicada } from '../domain/op-unica'
import { parseReceitaPorPosto, receitaParaLinhas } from '../domain/receita-posto'
import { parseTempoBurninPorPosto, temposParaLinhas } from '../domain/burnin-posto'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  criarOrdem,
  atualizarOrdem,
  excluirOrdem,
  contarRegistros,
  buscarOrdemBase,
  buscarOpEmUso,
  listarPostos,
  type DadosOrdem,
} from '../infra/ordem-repository'

export type ResultadoOrdem = { ok: true; id?: string; pmo?: string; op?: string } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar ordens de produção.'

function lerDados(fd: FormData): DadosOrdem {
  const qtdBruto = String(fd.get('qtd') ?? '').trim()
  return {
    pmo: String(fd.get('pmo') ?? '').trim(),
    op: String(fd.get('op') ?? '').trim(),
    cliente: String(fd.get('cliente') ?? '').trim(),
    qtd: qtdBruto === '' || Number.isNaN(Number(qtdBruto)) ? null : Number(qtdBruto),
    descricao: String(fd.get('descricao') ?? '').trim(),
    acp: String(fd.get('acp') ?? '').trim(),
    status: String(fd.get('status') ?? '').trim() || 'ATIVA',
    sn_ini: String(fd.get('sn_ini') ?? '').trim(),
    sn_fim: String(fd.get('sn_fim') ?? '').trim(),
  }
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
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim, qtd: dados.qtd })
  if (!v.ok) return v
  // OP única global: o número da OP não pode existir em nenhum outro PMO.
  const emUso = await buscarOpEmUso(dados.op)
  if (emUso) return { ok: false, erro: mensagemOpDuplicada(emUso) }
  const postos = await lerPostos(formData)
  const receita = await lerReceita(formData, postos)
  const burnin = await lerBurnin(formData, postos)
  if (!burnin.ok) return { ok: false, erro: burnin.erro }

  let id: string
  try {
    id = await criarOrdem(dados, postos, receita, burnin.rows)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível criar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${dados.pmo}/${dados.op} criada`, dados })
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
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim, qtd: dados.qtd })
  if (!v.ok) return v
  // OP única global: o número não pode colidir com OUTRA OP (exclui a própria).
  const emUso = await buscarOpEmUso(dados.op, id)
  if (emUso) return { ok: false, erro: mensagemOpDuplicada(emUso) }
  const postos = await lerPostos(formData)
  const receita = await lerReceita(formData, postos)
  const burnin = await lerBurnin(formData, postos)
  if (!burnin.ok) return { ok: false, erro: burnin.erro }

  try {
    await atualizarOrdem(id, dados, postos, receita, burnin.rows)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível salvar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'alterar_campo', descricao: `OP ${dados.pmo}/${dados.op} editada`, dados })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id, pmo: dados.pmo, op: dados.op }
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
