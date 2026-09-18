'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Permissao } from '@/modules/auth/domain/perfil'
import { mensagemErroSetup } from '../domain/mensagens'
import { normalizarFace } from '../domain/face'
import {
  buscarSetupPorChave, carregarSetup, chamarRpc, listarAlteracoes, listarSetups, listarSetupsParaCopiar, listarTrocas,
  type Alteracao, type ChaveSetup, type FiltroSetups, type FiltroTrocas, type ItemSetup, type SetupResumo, type Troca,
} from '../infra/setup-repository'

type Falha = { ok: false; erro: string }

async function exigir(perm: Permissao): Promise<Falha | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'setup', perm)) return { ok: false, erro: 'Você não tem permissão para esta ação.' }
  return null
}
const falha = (e: unknown): Falha => ({ ok: false, erro: mensagemErroSetup(e instanceof Error ? e.message : String(e)) })

// `colaborador` é o crachá digitado/bipado na tela: texto livre, sem conferência, pode vir vazio
// (mesmo campo da tela de Lançamento do ShopFloor). Quem grava como autor continua sendo o usuário logado.
// O SN de Abertura não é pedido aqui: é informado na liberação (liberarSetup).
export async function abrirSetup(entrada: ChaveSetup & { colaborador?: string; copiarDe?: string }): Promise<{ ok: true; setupId: string; criado: boolean; semFaixa: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ setup_id: string; criado: boolean; sem_faixa: boolean }>('st_abrir_setup', {
      p_pmo: entrada.pmo, p_op: entrada.op, p_equipamento_id: entrada.equipamentoId,
      p_face: entrada.face, p_copiar_de: entrada.copiarDe ?? null,
      p_colaborador: entrada.colaborador ?? '',
    })
    return { ok: true, setupId: r.setup_id, criado: r.criado, semFaixa: r.sem_faixa }
  } catch (e) { return falha(e) }
}

export async function localizarSetup(k: ChaveSetup): Promise<{ ok: true; setup: SetupResumo | null } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  const face = normalizarFace(k.face); if (!face) return { ok: false, erro: 'Face inválida.' }
  try { return { ok: true, setup: await buscarSetupPorChave({ ...k, face }) } } catch (e) { return falha(e) }
}

export async function carregarSetupAction(id: string): Promise<{ ok: true; setup: SetupResumo; itens: ItemSetup[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try {
    const r = await carregarSetup(id)
    return r ? { ok: true, ...r } : { ok: false, erro: 'Setup não encontrado.' }
  } catch (e) { return falha(e) }
}

export async function setupsParaCopiar(k: Omit<ChaveSetup, 'op'> & { excetoOp: string }): Promise<{ ok: true; setups: SetupResumo[] } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try { return { ok: true, setups: await listarSetupsParaCopiar(k) } } catch (e) { return falha(e) }
}

export async function incluirItem(setupId: string, posicao: string, feeder: string, rolo: string, colaborador = ''): Promise<{ ok: true; componente: string; atualizou: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ componente: string; atualizou: boolean }>('st_incluir_item', { p_setup_id: setupId, p_posicao: posicao, p_feeder: feeder, p_rolo: rolo, p_colaborador: colaborador })
    return { ok: true, componente: r.componente, atualizou: r.atualizou }
  } catch (e) { return falha(e) }
}

export async function removerItem(itemId: string): Promise<{ ok: true } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try { await chamarRpc('st_remover_item', { p_item_id: itemId }); return { ok: true } } catch (e) { return falha(e) }
}

export async function editarItem(itemId: string, posicao: string, feeder: string): Promise<{ ok: true } | Falha> {
  const negado = await exigir('administrar'); if (negado) return negado
  try { await chamarRpc('st_editar_item', { p_item_id: itemId, p_posicao: posicao, p_feeder: feeder }); return { ok: true } } catch (e) { return falha(e) }
}

// O SN de Abertura é informado na liberação e conferido com a faixa da OP no banco.
// semFaixa = a OP não tem faixa cadastrada (SN aceito sem conferência; a tela avisa).
export async function liberarSetup(setupId: string, snAbertura: string): Promise<{ ok: true; semFaixa: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ sem_faixa: boolean }>('st_liberar_setup', { p_setup_id: setupId, p_sn_abertura: snAbertura })
    return { ok: true, semFaixa: r.sem_faixa === true }
  } catch (e) { return falha(e) }
}

export async function ultimasTrocas(setupId: string): Promise<{ ok: true; trocas: Troca[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try {
    const r = await listarTrocas({ setupId }, 0, 10)
    return { ok: true, trocas: r.linhas }
  } catch (e) { return falha(e) }
}

export async function trocarRolo(entrada: { setupId: string; posicao: string; feeder: string; roloSaida: string; roloEntrada: string; snInicial: string; colaborador?: string }): Promise<{ ok: true; resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; semFaixa: boolean } | Falha> {
  const negado = await exigir('lancar'); if (negado) return negado
  try {
    const r = await chamarRpc<{ resultado: 'APROVADO' | 'REPROVADO'; motivos: string[]; sem_faixa: boolean }>('st_trocar_rolo', {
      p_setup_id: entrada.setupId, p_posicao: entrada.posicao, p_feeder: entrada.feeder,
      p_rolo_saida: entrada.roloSaida, p_rolo_entrada: entrada.roloEntrada, p_sn_inicial: entrada.snInicial,
      p_colaborador: entrada.colaborador ?? '',
    })
    return { ok: true, resultado: r.resultado, motivos: r.motivos ?? [], semFaixa: r.sem_faixa }
  } catch (e) { return falha(e) }
}

export async function consultarSetups(f: FiltroSetups): Promise<{ ok: true; setups: SetupResumo[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try { return { ok: true, setups: await listarSetups(f) } } catch (e) { return falha(e) }
}

export async function consultarTrocas(f: FiltroTrocas, pagina: number, tamanho = 100): Promise<{ ok: true; linhas: Troca[]; total: number } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try { return { ok: true, ...(await listarTrocas(f, pagina, tamanho)) } } catch (e) { return falha(e) }
}

export async function consultarAlteracoes(setupId: string): Promise<{ ok: true; alteracoes: Alteracao[] } | Falha> {
  const negado = await exigir('visualizar'); if (negado) return negado
  try { return { ok: true, alteracoes: await listarAlteracoes(setupId) } } catch (e) { return falha(e) }
}
