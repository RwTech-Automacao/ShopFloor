'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { contemSeparador, normalizarTexto } from '../domain/codigo-rolo'
import { mensagemErroSetup } from '../domain/mensagens'
import { rotuloEquipamento, type Processo } from '../domain/tipos'
import {
  alternarEquipamento, chamarRpc, inserirComponente, inserirEquipamento, listarEstrutura, removerComponente,
  type ItemEstruturaCadastro,
} from '../infra/setup-repository'

type Falha = { ok: false; erro: string }
const SEM = 'Você não tem permissão para esta ação.'

async function admin() {
  const sessao = await getSessao()
  return sessao && podeNoModulo(sessao.perfil, 'setup', 'administrar') ? sessao : null
}
const processoValido = (p: string): p is Processo => p === 'SMD' || p === 'PTH'

export async function cadastrarEquipamentoAction(_prev: { ok: true } | { erro: string } | undefined, formData: FormData): Promise<{ ok: true } | { erro: string }> {
  if (!(await admin())) return { erro: SEM }
  const processo = String(formData.get('processo') ?? '')
  const linha = normalizarTexto(String(formData.get('linha') ?? ''))
  const bloco = normalizarTexto(String(formData.get('bloco') ?? ''))
  const maquinaDigitada = normalizarTexto(String(formData.get('maquina') ?? ''))
  if (!processoValido(processo) || !linha || !bloco) return { erro: 'Preencha processo, linha e bloco.' }
  // No PTH não existe máquina: o que vier no campo é descartado (o banco exige null).
  const maquina = processo === 'SMD' ? maquinaDigitada : null
  if (processo === 'SMD' && !maquina) return { erro: 'Informe a máquina (obrigatória no SMD).' }
  const r = await inserirEquipamento({ processo, linha, bloco, maquina })
  if (!r.ok) return { erro: r.erro }
  await registrarLog({ entidade: 'st_equipamento', acao: 'criar', descricao: `Equipamento ${processo} · Linha ${linha} · ${rotuloEquipamento({ processo, bloco, maquina })}` })
  revalidatePath('/configuracoes/setup-equipamentos')
  return { ok: true }
}

export async function alternarEquipamentoAction(id: string, ativo: boolean): Promise<{ ok: true } | Falha> {
  if (!(await admin())) return { ok: false, erro: SEM }
  try { await alternarEquipamento(id, ativo) } catch { return { ok: false, erro: 'Não foi possível alterar.' } }
  revalidatePath('/configuracoes/setup-equipamentos')
  return { ok: true }
}

export async function estruturaAtualAction(pmo: string): Promise<{ ok: true; itens: ItemEstruturaCadastro[] } | Falha> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', 'visualizar')) return { ok: false, erro: SEM }
  try { return { ok: true, itens: await listarEstrutura(pmo) } } catch { return { ok: false, erro: 'Não foi possível carregar a estrutura.' } }
}

export async function adicionarComponenteAction(pmo: string, componente: string, processo: string): Promise<{ ok: true } | Falha> {
  const sessao = await admin(); if (!sessao) return { ok: false, erro: SEM }
  const codigo = normalizarTexto(componente)
  if (!pmo.trim() || !codigo || !processoValido(processo)) return { ok: false, erro: 'Informe o código e o processo.' }
  if (contemSeparador(codigo)) return { ok: false, erro: 'O código do componente não pode ter separador (- _ : / ou espaço).' }
  const r = await inserirComponente(pmo.trim(), codigo, processo, sessao.usuarioId)
  if (!r.ok) return r
  await registrarLog({ entidade: 'st_estrutura', acao: 'criar', descricao: `Estrutura ${pmo}: + ${codigo} (${processo})` })
  revalidatePath('/configuracoes/setup-estrutura')
  return { ok: true }
}

export async function removerComponenteAction(pmo: string, componente: string): Promise<{ ok: true } | Falha> {
  if (!(await admin())) return { ok: false, erro: SEM }
  try { await removerComponente(pmo, componente) } catch { return { ok: false, erro: 'Não foi possível remover.' } }
  await registrarLog({ entidade: 'st_estrutura', acao: 'excluir', descricao: `Estrutura ${pmo}: − ${componente}` })
  revalidatePath('/configuracoes/setup-estrutura')
  return { ok: true }
}

export async function importarEstruturaAction(pmo: string, itens: { componente: string; processo: Processo }[]): Promise<{ ok: true; novos: number; atualizados: number; iguais: number } | Falha> {
  if (!(await admin())) return { ok: false, erro: SEM }
  if (itens.length === 0) return { ok: false, erro: 'Nenhum componente para importar.' }
  try {
    const r = await chamarRpc<{ novos: number; atualizados: number; iguais: number }>('st_importar_estrutura', { p_pmo: pmo, p_itens: itens })
    await registrarLog({ entidade: 'st_estrutura', acao: 'importar', descricao: `Estrutura ${pmo} importada: ${r.novos} novos, ${r.atualizados} atualizados`, dados: r })
    revalidatePath('/configuracoes/setup-estrutura')
    return { ok: true, ...r }
  } catch (e) {
    return { ok: false, erro: mensagemErroSetup(e instanceof Error ? e.message : String(e)) }
  }
}
