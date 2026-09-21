'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { alertasLiberados } from './liberacao'
import {
  resumoLimite,
  resumoPmos,
  validarPrevia,
  validarRegra,
  type EntradaPrevia,
  type EntradaRegra,
} from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { resumoJanela } from '../domain/janela'
import { NOME_TIPO_REGRA } from '../domain/tipos'
import {
  atualizarRegra,
  definirRegraAtiva,
  excluirRegra,
  inserirRegra,
  listarOcorrencias,
  previaRegra,
  resolverOcorrenciaComoAdmin,
} from '../infra/regras-repository'
import { criarDependenciasAlertas } from '../infra/fabrica'
import { avaliarEEnviar, entregarPendentes, removerBotoesDaOcorrencia, type ResumoAvaliacao } from './enviar-alertas'

const SEM_PERMISSAO = 'Você não tem permissão para configurar alertas.'
const RECURSO_INDISPONIVEL = 'Recurso indisponível.'
const ROTA = '/configuracoes/sf-alertas'

/**
 * Além da permissão `shopfloor.administrar`, respeita o lançamento escondido dos Alertas
 * (ALERTAS_LIBERADO_PARA): fora da lista liberada, a ação some mesmo pra quem tem permissão —
 * mesma mensagem genérica das rotas de API, sem entregar que a feature existe.
 */
async function gestor(): Promise<{ ok: true; usuarioId: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (!alertasLiberados(sessao.email)) return { ok: false, erro: RECURSO_INDISPONIVEL }
  return { ok: true, usuarioId: sessao.usuarioId }
}

export async function salvarRegraAction(
  id: string | null,
  entrada: EntradaRegra,
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  try {
    const g = await gestor()
    if (!g.ok) return { ok: false, erro: g.erro }

    const v = validarRegra(entrada)
    if (!v.ok) return { ok: false, erro: v.erro }

    if (id) {
      const r = await atualizarRegra(id, v.valor)
      if (!r.ok) return { ok: false, erro: r.erro }
      await registrarLog({
        entidade: 'alerta_regra',
        entidadeId: id,
        acao: 'alterar_campo',
        descricao: `Regra de alerta "${v.valor.nome}" alterada`,
        dados: v.valor,
      })
      revalidatePath(ROTA)
      return { ok: true, id }
    }

    const r = await inserirRegra(v.valor)
    if (!r.ok) return { ok: false, erro: r.erro }
    await registrarLog({
      entidade: 'alerta_regra',
      entidadeId: r.id,
      acao: 'criar',
      descricao:
        `Regra de alerta "${v.valor.nome}" criada (${NOME_TIPO_REGRA[v.valor.tipo]}; ${v.valor.postos.join(', ')}; ` +
        `${resumoJanela({ tipo: v.valor.janelaTipo, valor: v.valor.janelaValor })}; limite ${resumoLimite(v.valor)}; ` +
        `PMOs: ${resumoPmos(v.valor.pmos)})`,
      dados: v.valor,
    })
    revalidatePath(ROTA)
    return { ok: true, id: r.id }
  } catch (e) {
    console.error('[alertas] salvar regra:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível salvar a regra agora.' }
  }
}

export async function excluirRegraAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const g = await gestor()
    if (!g.ok) return { ok: false, erro: g.erro }
    const r = await excluirRegra(id)
    if (!r.ok) return { ok: false, erro: r.erro }
    await registrarLog({
      entidade: 'alerta_regra',
      entidadeId: id,
      acao: 'excluir',
      descricao: 'Regra de alerta excluída (exclusão lógica — o histórico de ocorrências continua)',
    })
    revalidatePath(ROTA)
    return { ok: true }
  } catch (e) {
    console.error('[alertas] excluir regra:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível excluir a regra agora.' }
  }
}

export async function alternarRegraAtivaAction(
  id: string,
  ativa: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const g = await gestor()
    if (!g.ok) return { ok: false, erro: g.erro }
    const r = await definirRegraAtiva(id, ativa)
    if (!r.ok) return { ok: false, erro: r.erro }
    await registrarLog({
      entidade: 'alerta_regra',
      entidadeId: id,
      acao: 'alterar_campo',
      descricao: `Regra de alerta ${ativa ? 'ativada' : 'desativada'}`,
      dados: { ativa },
    })
    revalidatePath(ROTA)
    return { ok: true }
  } catch (e) {
    console.error('[alertas] alternar regra ativa:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível alterar a regra agora.' }
  }
}

export async function previaRegraAction(
  entrada: EntradaPrevia,
): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
  try {
    const g = await gestor()
    if (!g.ok) return { ok: false, erro: g.erro }
    const v = validarPrevia(entrada)
    if (!v.ok) return { ok: false, erro: v.erro }
    return await previaRegra(v.valor)
  } catch (e) {
    console.error('[alertas] prévia da regra:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível calcular a prévia agora.' }
  }
}

export async function listarOcorrenciasAction(
  filtro: FiltroOcorrencias,
): Promise<{ ok: true; ocorrencias: OcorrenciaLinha[] } | { ok: false; erro: string }> {
  const g = await gestor()
  if (!g.ok) return { ok: false, erro: g.erro }
  try {
    return { ok: true, ocorrencias: await listarOcorrencias(filtro) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as ocorrências agora.' }
  }
}

export async function resolverOcorrenciaAction(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const g = await gestor()
    if (!g.ok) return { ok: false, erro: g.erro }

    // alerta_resolver_admin resolve E enfileira o "✅ resolvido por" para os destinatários (menos
    // quem resolveu), na mesma transação.
    const r = await resolverOcorrenciaComoAdmin(id)
    if (!r.ok) return { ok: false, erro: r.erro }

    // Tira o botão das mensagens já entregues e adianta a entrega do aviso que está na fila. Falha
    // aqui NÃO desfaz a resolução e não perde o aviso: o cron entrega na próxima rodada.
    try {
      const { portas, repo } = criarDependenciasAlertas()
      await removerBotoesDaOcorrencia(portas, repo, id)
      if (!r.resolucao.jaResolvida) await entregarPendentes(portas, repo, { ocorrenciaId: id })
    } catch (e) {
      console.error('[alertas] avisar resolução pela tela:', e instanceof Error ? e.message : e)
    }

    await registrarLog({
      entidade: 'alerta_ocorrencia',
      entidadeId: id,
      acao: 'mudar_status',
      descricao: `Ocorrência de alerta (${r.resolucao.posto}) marcada como resolvida`,
    })
    revalidatePath(ROTA)
    return { ok: true }
  } catch (e) {
    console.error('[alertas] resolver ocorrência:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível resolver a ocorrência agora.' }
  }
}

/**
 * "Avaliar agora": a mesma lógica do cron, para testar sem esperar os 5 minutos.
 * Rodar junto com o cron é seguro: a avaliação tem trava (a segunda volta `ocupado`) e a ENTREGA
 * sai da fila por reserva atômica (`alerta_reservar_envios`, `for update skip locked` + reserva de
 * 15 min) — duas rodadas nunca pegam a mesma linha, então não há envio em dobro.
 */
export async function avaliarAgoraAction(): Promise<
  { ok: true; resumo: ResumoAvaliacao } | { ok: false; erro: string }
> {
  const g = await gestor()
  if (!g.ok) return { ok: false, erro: g.erro }
  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resumo = await avaliarEEnviar(portas, repo)
    revalidatePath(ROTA)
    return { ok: true, resumo }
  } catch (e) {
    console.error('[alertas] avaliar agora:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível avaliar agora (banco indisponível?).' }
  }
}
