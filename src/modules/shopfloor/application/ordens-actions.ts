'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarOrdem } from '../domain/validar-ordem'
import {
  criarOrdem,
  atualizarOrdem,
  excluirOrdem,
  contarRegistros,
  buscarOrdemBase,
  listarPostos,
  type DadosOrdem,
} from '../infra/ordem-repository'

export type ResultadoOrdem = { ok: true; id?: string } | { ok: false; erro: string }

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

/** Componentes (receita) enviados pelo form (campo `componentes` = JSON de strings). */
function lerComponentes(fd: FormData): string[] {
  let bruto: unknown
  try {
    bruto = JSON.parse(String(fd.get('componentes') ?? '[]'))
  } catch {
    return []
  }
  if (!Array.isArray(bruto)) return []
  const vistos = new Set<string>()
  const out: string[] = []
  for (const item of bruto) {
    const v = String(item).trim()
    if (v !== '' && !vistos.has(v.toLowerCase())) {
      vistos.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out
}

function ehDuplicidade(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505'
}

export async function criarOrdemAction(
  _prev: ResultadoOrdem | undefined,
  formData: FormData,
): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const dados = lerDados(formData)
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim })
  if (!v.ok) return v
  const postos = await lerPostos(formData)
  const componentes = postos.includes('Integração') ? lerComponentes(formData) : []

  let id: string
  try {
    id = await criarOrdem(dados, postos, componentes)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível criar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'criar', descricao: `OP ${dados.pmo}/${dados.op} criada`, dados })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id }
}

export async function editarOrdemAction(
  _prev: ResultadoOrdem | undefined,
  formData: FormData,
): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

  const id = String(formData.get('id') ?? '').trim()
  if (id === '') return { ok: false, erro: 'OP inválida.' }
  const dados = lerDados(formData)
  const v = validarOrdem({ pmo: dados.pmo, op: dados.op, cliente: dados.cliente, snIni: dados.sn_ini, snFim: dados.sn_fim })
  if (!v.ok) return v
  const postos = await lerPostos(formData)
  const componentes = postos.includes('Integração') ? lerComponentes(formData) : []

  try {
    await atualizarOrdem(id, dados, postos, componentes)
  } catch (e) {
    if (ehDuplicidade(e)) return { ok: false, erro: 'Já existe uma OP com esse PMO e número.' }
    return { ok: false, erro: 'Não foi possível salvar a OP.' }
  }

  await registrarLog({ entidade: 'sf_ordem', entidadeId: id, acao: 'alterar_campo', descricao: `OP ${dados.pmo}/${dados.op} editada`, dados })
  revalidatePath('/shopfloor/ordens')
  return { ok: true, id }
}

export async function excluirOrdemAction(id: string): Promise<ResultadoOrdem> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) return { ok: false, erro: SEM_PERMISSAO }

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
