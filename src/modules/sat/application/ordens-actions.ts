'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Permissao } from '@/modules/auth/domain/perfil'
import { mensagemDoErro } from '../domain/erros'
import { validarCorrecaoEtapa, validarDefeito, validarLaudo, validarPeca, validarTrocaNs } from '../domain/ordem'
import type { PecaSugerida } from '../domain/estrutura'
import { ErroDoBanco } from '../infra/repository'
import {
  adicionarDefeito, adicionarPeca, corrigirEtapa, enviarQualidade, iniciarManutencao, kitsConhecidos, pecasMaisUsadas,
  produtoDaOrdem, removerDefeito, removerPeca, salvarLaudo, trocarNs,
} from '../infra/ordens-repository'
import { CompelsIndisponivel, leiturasDoCompels } from '../infra/estrutura-compels'
import { pecasSugeridas, type CamadasPecas } from './pecas-sugeridas'

/**
 * Ações da ordem de serviço do SAT (spec 2026-11-26, entrega 1). A permissão é conferida aqui ANTES de tudo e de
 * novo no banco (funções da 0198), que também confere a etapa. Nada aqui grava no Compels: só lê (lista de peças).
 */
export type ResultadoAcao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'
const PEDIDO_INVALIDO = 'Pedido inválido.'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idOk = (id: unknown): id is string => typeof id === 'string' && UUID.test(id)
const textoOk = (t: unknown, max: number): t is string => typeof t === 'string' && t.length <= max

async function pode(perm: Permissao): Promise<boolean> {
  const sessao = await getSessao()
  return !!sessao && podeNoModulo(sessao.perfil, 'sat', 'visualizar') && podeNoModulo(sessao.perfil, 'sat', perm)
}

function falha(e: unknown, generica: string): { ok: false; erro: string } {
  if (e instanceof ErroDoBanco) return { ok: false, erro: mensagemDoErro(e.message, generica) }
  console.error('[sat]', generica, e instanceof Error ? e.message : e)
  return { ok: false, erro: generica }
}

async function gravar(ordemId: string, generica: string, grava: () => Promise<void>): Promise<ResultadoAcao<null>> {
  try {
    await grava()
  } catch (e) {
    return falha(e, generica)
  }
  revalidatePath(`/sat/ordens/${ordemId}`)
  revalidatePath('/sat/ordens')
  return { ok: true, valor: null }
}

export async function iniciarManutencaoAction(ordemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível abrir a manutenção.', () => iniciarManutencao(ordemId))
}

export async function adicionarDefeitoAction(ordemId: string, defeitoId: string, solucao: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(solucao, 5000)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarDefeito({ defeitoId, solucao })
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível lançar o defeito.', () => adicionarDefeito(ordemId, v.valor.defeitoId, v.valor.solucao))
}

export async function removerDefeitoAction(ordemId: string, itemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !idOk(itemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível remover o defeito.', () => removerDefeito(itemId))
}

export async function adicionarPecaAction(
  ordemId: string, p: { codigo: string; descricao: string; quantidade: string },
): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !p || typeof p !== 'object' || !textoOk(p.codigo, 100) || !textoOk(p.descricao, 1000) ||
      !textoOk(p.quantidade, 20)) {
    return { ok: false, erro: PEDIDO_INVALIDO }
  }
  const v = validarPeca(p)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível lançar a peça.', () => adicionarPeca(ordemId, v.valor))
}

export async function removerPecaAction(ordemId: string, itemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !idOk(itemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível remover a peça.', () => removerPeca(itemId))
}

export async function salvarLaudoAction(ordemId: string, laudo: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(laudo, 10000)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarLaudo(laudo)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível salvar o laudo.', () => salvarLaudo(ordemId, v.valor))
}

export async function trocarNsAction(ordemId: string, ns: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(ns, 500)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarTrocaNs(ns)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível trocar o número de série.', () => trocarNs(ordemId, v.valor))
}

export async function enviarQualidadeAction(ordemId: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  return gravar(ordemId, 'Não foi possível enviar para a qualidade.', () => enviarQualidade(ordemId))
}

/** O administrador corrige a etapa (qualquer uma desta entrega), com motivo no histórico. */
export async function corrigirEtapaAction(ordemId: string, etapa: string, motivo: string): Promise<ResultadoAcao<null>> {
  if (!(await pode('administrar'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId) || !textoOk(etapa, 40) || !textoOk(motivo, 2000)) return { ok: false, erro: PEDIDO_INVALIDO }
  const v = validarCorrecaoEtapa(etapa, motivo)
  if (!v.ok) return v
  return gravar(ordemId, 'Não foi possível corrigir a etapa.', () => corrigirEtapa(ordemId, v.valor.etapa, v.valor.motivo))
}

/** As camadas 1–3 da lista de peças, pelo produto da OS (estrutura e pais em cache de 7 dias). */
export async function pecasSugeridasAction(ordemId: string): Promise<ResultadoAcao<CamadasPecas>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(ordemId)) return { ok: false, erro: PEDIDO_INVALIDO }
  try {
    const produto = await produtoDaOrdem(ordemId)
    if (produto === null) return { ok: false, erro: mensagemDoErro('ORDEM_NAO_ENCONTRADA') }
    const compels = leiturasDoCompels()
    return {
      ok: true,
      valor: await pecasSugeridas(produto, {
        maisUsadas: pecasMaisUsadas, kitsConhecidos,
        estrutura: (c) => compels.estrutura(c), paisDoItem: (id) => compels.paisDoItem(id),
      }),
    }
  } catch (e) {
    return falha(e, 'Não foi possível montar a lista de peças.')
  }
}

/** Camada 4: busca no cadastro de itens do Compels (só leitura). */
export async function buscarItensAction(termo: string): Promise<ResultadoAcao<PecaSugerida[]>> {
  if (!(await pode('manutencao'))) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof termo !== 'string') return { ok: false, erro: PEDIDO_INVALIDO }
  const t = termo.trim()
  if (t.length < 2 || t.length > 60) return { ok: false, erro: 'Digite ao menos 2 letras para buscar.' }
  try {
    return { ok: true, valor: await leiturasDoCompels().buscarItens(t) }
  } catch (e) {
    if (e instanceof CompelsIndisponivel) return { ok: false, erro: 'O Compels não está disponível neste ambiente.' }
    return falha(e, 'Não foi possível buscar no Compels agora.')
  }
}
