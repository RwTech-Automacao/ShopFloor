'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { postoCancelavel, ehEntradaDeCaixaAlmoxarifado } from '../domain/cancelamento'
import {
  lerRegistroParaCancelar,
  ehUltimoBipe,
  chamarSfCancelar,
  chamarSfCancelarCaixa,
  contarPecasDaEntradaDeCaixa,
} from '../infra/cancelamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'
import { estadoCaixaDoRegistro } from '../infra/caixa-repository'

const SEM_PERMISSAO = 'Você não tem permissão para cancelar.'

/**
 * Informação da entrada de CAIXA do Almoxarifado, quando é o caso: o código e quantas peças o
 * cancelamento vai levar. A presença deste campo é o que faz a tela oferecer "cancelar a caixa
 * inteira" no lugar de "cancelar lançamento" — a entrada foi um gesto, o desfazer é um gesto.
 */
export interface CaixaDoRegistro {
  numeroCaixa: string
  pecas: number
}

export interface CancelavelInfo {
  podeCancelar: boolean
  motivo?: string
  aviso?: string
  caixa?: CaixaDoRegistro
}

/** Checagem pro botão (UX): dá pra cancelar este bipe? Fail-closed.
 *  `aviso` = consequência que o gestor precisa saber ANTES de confirmar (hoje só a embalagem tem).
 *  `caixa` = é uma entrada de caixa do Almoxarifado, e o desfazer dela é a caixa inteira. */
export async function cancelavelInfo(id: string): Promise<CancelavelInfo> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { podeCancelar: false, motivo: 'Sem permissão para cancelar.' }
  }
  try {
    const reg = await lerRegistroParaCancelar(id)
    if (!reg) return { podeCancelar: false, motivo: 'Registro não encontrado.' }
    const perfil = (await mapaPostoPerfil())[reg.posto]
    if (!postoCancelavel(perfil?.recurso)) {
      return { podeCancelar: false, motivo: 'Este posto não pode ser cancelado por aqui.' }
    }
    // O LIFO é POR PEÇA, e aqui só a linha clicada é conferida — inclusive na entrada de caixa, onde o
    // cancelamento vai levar as N. É de propósito: esta checagem é UX (habilita o botão), e o
    // Almoxarifado é o último posto da linha, então cada linha dele é o último bipe da sua própria
    // peça. Quem confere as N, dentro da trava, é a 0131 — e a recusa dela (NAO_E_ULTIMO) chega
    // traduzida no diálogo.
    if (!(await ehUltimoBipe(reg.pmo, reg.op, reg.numeroSerieNorm, id))) {
      return { podeCancelar: false, motivo: 'Só o bipe mais recente deste SN pode ser cancelado — cancele o mais recente primeiro.' }
    }
    if (ehEntradaDeCaixaAlmoxarifado(perfil?.recurso, reg.numeroCaixa)) {
      // Best-effort: falhar a contagem não pode bloquear o cancelamento (a RPC conta de novo, dentro
      // da trava, e é o número dela que a tela mostra no fim).
      const pecas = await contarPecasDaEntradaDeCaixa(reg.pmo, reg.op, reg.posto, reg.numeroCaixa)
        .catch(() => 0)
      return { podeCancelar: true, caixa: { numeroCaixa: reg.numeroCaixa, pecas } }
    }
    return { podeCancelar: true, aviso: await avisoDaEmbalagem(reg, perfil?.recurso) }
  } catch {
    return { podeCancelar: false, motivo: 'Não foi possível verificar.' }
  }
}

/**
 * Aviso da EMBALAGEM: a peça sai da caixa e, se a caixa já estava fechada, ela REABRE — o código
 * muda quando fechar de novo (a quantidade mudou), então a folha impressa precisa ser reimpressa.
 * Sem caixa em sf_caixas (embalagem individual) não há nada a avisar.
 */
async function avisoDaEmbalagem(
  reg: { pmo: string; op: string; posto: string; numeroCaixa: string },
  recurso: string | null | undefined,
): Promise<string | undefined> {
  if (recurso !== 'caixa') return undefined
  // Best-effort: é só texto de UX. Falhar aqui não pode bloquear o cancelamento (a RPC decide).
  const cx = await estadoCaixaDoRegistro(reg.pmo, reg.op, reg.posto, reg.numeroCaixa).catch(() => null)
  if (!cx) return undefined
  if (!cx.fechada) return `A peça sai da caixa CX${cx.seq} (ainda aberta) e a vaga fica livre pra outra peça.`
  return `A caixa CX${cx.seq} já está FECHADA: cancelar vai REABRIR a caixa. Ela vai aparecer como reaberta na tela de Lançamento. O código da caixa leva a quantidade: se ela fechar de novo com outra quantidade, o código muda — reimprima a folha.`
}

/** Executa o cancelamento (gestor). Motivo obrigatório. */
export async function cancelarLancamento(
  id: string, motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (motivo.trim() === '') return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  const r = await chamarSfCancelar(id, motivo.trim())
  if (r.ok) return { ok: true }
  return { ok: false, erro: mensagemErroRpc(r.erro, 'Não foi possível cancelar o lançamento.') }
}

/**
 * Cancela a CAIXA INTEIRA de uma entrada do Almoxarifado (0131): as N linhas de uma vez, com um
 * motivo só. A entrada foi um gesto — o bipe do código da caixa —, então o desfazer também é.
 *
 * Devolve quantas peças saíram pra a tela dizer "14 peças canceladas". O número vem da RPC (contado
 * dentro da trava, depois de apagar), não da contagem que o diálogo mostrou antes de confirmar.
 */
export async function cancelarCaixaAlmoxarifado(
  id: string, motivo: string,
): Promise<{ ok: true; canceladas: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }
  if (motivo.trim() === '') return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  const r = await chamarSfCancelarCaixa(id, motivo.trim())
  if (r.ok) return { ok: true, canceladas: r.canceladas }
  return { ok: false, erro: mensagemErroRpc(r.erro, 'Não foi possível cancelar a caixa.') }
}

/**
 * Tradução dos códigos que a RPC de cancelamento levanta (`raise exception`) — as duas usam os
 * mesmos, então a tabela é uma só.
 *
 * NAO_E_ULTIMO na caixa inteira quer dizer que ALGUMA das N peças tem bipe posterior: a 0131 recusa a
 * caixa toda em vez de cancelar "as que dá", porque meio dentro/meio fora é justamente o estado que
 * ela existe pra matar.
 */
function mensagemErroRpc(msg: string, fallback: string): string {
  if (msg.includes('NAO_E_ULTIMO')) return 'Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.'
  if (msg.includes('POSTO_NAO_CANCELAVEL')) return 'Este posto não pode ser cancelado por aqui.'
  if (msg.includes('NAO_E_ENTRADA_DE_CAIXA')) return 'Este registro não é uma entrada de caixa — use Cancelar lançamento.'
  if (msg.includes('MOTIVO_OBRIGATORIO')) return 'Informe o motivo do cancelamento.'
  if (msg.includes('SEM_PERMISSAO')) return SEM_PERMISSAO
  if (msg.includes('NAO_ENCONTRADO')) return 'Registro não encontrado (talvez já cancelado).'
  return fallback
}
