import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type {
  EnvioEstoqueReservado,
  LoteEstoqueReservado,
  RepositorioEstoqueEnvios,
  ResultadoEnvioEstoque,
} from '../application/enviar-estoque'

/**
 * A infra da fila de estoque: a reserva do lote (RPC) e a gravação do resultado na linha. Nada de
 * regra aqui — a regra da ordem do par mora no filtro da `sf_estoque_reservar` (0132) e o laço mora
 * em `application/enviar-estoque.ts`.
 *
 * O client é o de SERVICE ROLE, que ignora RLS de propósito: quem chama é o cron (Task 4) e o
 * Reenviar da tela, que não têm sessão de usuário nenhuma — e a `sf_estoque_reservar` é concedida
 * SÓ ao `service_role`, porque reservar conta tentativa e esconde a linha por 15 min.
 */

/**
 * Quanto "no passado" fica o `reservado_em` de uma linha adiada por espera. A reserva só vence após 15
 * min, então 10 min atrás = a linha volta a ser elegível em ~5 min.
 */
const ESPERA_ADIADA_MS = 10 * 60 * 1000

/** Erro grande não ajuda ninguém na tela e incha a linha: guarda o começo, que é onde está o motivo. */
const LIMITE_ERRO = 500

const OPERACOES: readonly EnvioEstoqueReservado['operacao'][] = ['entrada', 'estorno']
const TIPOS: readonly EnvioEstoqueReservado['tipo'][] = ['caixa', 'serie']

function ehOperacao(v: unknown): v is EnvioEstoqueReservado['operacao'] {
  return typeof v === 'string' && (OPERACOES as readonly string[]).includes(v)
}

function ehTipo(v: unknown): v is EnvioEstoqueReservado['tipo'] {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v)
}

/**
 * Converte uma linha devolvida pela `sf_estoque_reservar`. Devolve `null` para a linha que este
 * código não entende (uma `operacao` ou um `tipo` novos no banco, id/chave vazios, quantidade que
 * não é número positivo) — quem chama conclui essa linha como FALHA, em vez de só pular.
 */
export function lerEnvioEstoque(bruto: unknown): EnvioEstoqueReservado | null {
  const l = (bruto ?? {}) as Record<string, unknown>
  const id = String(l.id ?? '')
  const chave = String(l.chave ?? '')
  const quantidade = Number(l.quantidade ?? 0)
  if (id === '' || chave === '') return null
  if (!ehOperacao(l.operacao) || !ehTipo(l.tipo)) return null
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null
  return {
    id,
    chave,
    operacao: l.operacao,
    pmo: String(l.pmo ?? ''),
    op: String(l.op ?? ''),
    posto: String(l.posto ?? ''),
    tipo: l.tipo,
    bipe: String(l.bipe ?? ''),
    serieNorm: String(l.serie_norm ?? ''),
    quantidade,
    tentativas: Number(l.tentativas ?? 0) || 0,
    criadoEm: String(l.criado_em ?? ''),
  }
}

export function criarRepositorioEstoqueEnvios(
  sb: SupabaseClient = createServiceSupabase(),
): RepositorioEstoqueEnvios {
  /**
   * Linha reservada que este código não entende: em vez de só pular (e ela voltar a cada 15 min sem
   * nunca registrar nada, ocupando lugar no lote para sempre), conclui como FALHA com o motivo. A
   * tentativa já foi contada na reserva — na 5ª ela sai da fila e aparece na tela de pendências, que
   * é onde alguém vê que existe uma linha com defeito de dado.
   */
  async function concluirIlegivel(bruto: unknown): Promise<void> {
    const l = (bruto ?? {}) as Record<string, unknown>
    const id = typeof l.id === 'string' ? l.id : ''
    console.error('[estoque] linha da fila ilegível (operacao/tipo/quantidade desconhecidos)', id)
    if (id === '') return
    try {
      const { error } = await sb
        .from('sf_estoque_envios')
        .update({
          ok: false,
          erro: `Linha ilegível: operacao/tipo/quantidade inesperados (${String(l.operacao ?? '')}/${String(l.tipo ?? '')}/${String(l.quantidade ?? '')})`
            .slice(0, LIMITE_ERRO),
          reservado_em: null,
        })
        .eq('id', id)
        .eq('tentativas', Number(l.tentativas ?? 0) || 0)
        .is('cancelado_em', null)
      if (error) console.error(`[estoque] concluir linha ilegível ${id} falhou:`, error.message)
    } catch (e) {
      console.error(`[estoque] concluir linha ilegível ${id} falhou:`, e instanceof Error ? e.message : e)
    }
  }

  return {
    async reservarPendentes(limite: number): Promise<LoteEstoqueReservado> {
      const { data, error } = await sb.rpc('sf_estoque_reservar', { p_limite: limite })
      if (error) throw new Error(`sf_estoque_reservar: ${error.message}`)
      const envios: EnvioEstoqueReservado[] = []
      let ilegiveis = 0
      for (const bruto of (data ?? []) as unknown[]) {
        const envio = lerEnvioEstoque(bruto)
        if (envio) envios.push(envio)
        else {
          // Concluída como falha aqui (é este arquivo que sabe escrever na linha), mas CONTADA pra
          // quem chama: a linha ilegível é uma falha da rodada e ocupou lugar no lote. Devolver só as
          // legíveis escondia as duas coisas — o resumo dizia `falhas: 0` e o laço achava o lote
          // incompleto. Ver LoteEstoqueReservado, em application/enviar-estoque.ts.
          ilegiveis += 1
          await concluirIlegivel(bruto)
        }
      }
      return { envios, ilegiveis }
    },

    async concluirEnvio(envio: EnvioEstoqueReservado, resultado: ResultadoEnvioEstoque) {
      const { data, error } = await sb
        .from('sf_estoque_envios')
        .update({
          ok: resultado.ok,
          erro: resultado.ok ? null : resultado.erro.slice(0, LIMITE_ERRO),
          // o CHECK da 0132 é ok = (enviado_em is not null): os dois andam sempre juntos
          enviado_em: resultado.ok ? new Date().toISOString() : null,
          // Solta a reserva: se falhou (e ainda tem tentativa), a próxima rodada pega de novo. Isso
          // NÃO "destoca" a linha para a sf_estoque_reverter — a marca que decide lá é
          // `tentativas > 0`, que nunca volta atrás (a reserva viva é só a outra metade dela).
          //
          // EXCEÇÃO, a espera (`aguardar`): NADA chegou ao ERP (a recusa veio antes de qualquer
          // gravação), então a linha continua "intocada" de verdade: devolve a tentativa cobrada na
          // reserva e a esconde por ~5 min (elegível quando `reservado_em` passa de 15 min atrás, e
          // aqui ele fica 10 min no passado). Sem isso, esperar o empenho gastaria as 5 tentativas.
          ...(!resultado.ok && resultado.aguardar
            ? {
                tentativas: Math.max(envio.tentativas - 1, 0),
                reservado_em: new Date(Date.now() - ESPERA_ADIADA_MS).toISOString(),
              }
            : { reservado_em: null }),
        })
        .eq('id', envio.id)
        // Cerca: se a reserva desta rodada venceu e outra rodada re-reservou a linha (tentativas
        // subiu), esta escrita atrasada não pode sobrescrever o resultado da outra.
        .eq('tentativas', envio.tentativas)
        // ⚠️ A 0132 manda incluir isto, e o motivo é um CHECK: `cancelado_em is null or not ok`. Um
        // cancelamento que caia entre a reserva e esta escrita faria `ok = true` numa linha cancelada
        // estourar o check na cara do servidor. Hoje isso só é alcançável por edição à mão no SQL
        // Editor (a sf_estoque_reverter não cancela linha tocada — ver A ASSIMETRIA na 0132), e é a
        // diferença entre uma linha ignorada com um aviso no log e uma rodada derrubada.
        .is('cancelado_em', null)
        .select('id')
      if (error) throw new Error(`sf_estoque_envios: ${error.message}`)
      if ((data ?? []).length === 0) {
        console.error(
          `[estoque] envio ${envio.chave}: resultado descartado (linha re-reservada por outra rodada ou cancelada no meio)`,
        )
      }
    },
  }
}

/**
 * Quantas peças desta OP JÁ CHEGARAM ao Compels (`sf_estoque_enviado`, 0153): entradas entregues menos
 * estornos entregues, sem contar a própria linha que está sendo enviada. É o "o que mandamos antes" que a
 * integração compara com o que o ERP mostra apontado.
 */
export function criarSomaEnviada(
  sb: SupabaseClient = createServiceSupabase(),
): (pmo: string, op: string, excetoId: string) => Promise<number> {
  return async (pmo, op, excetoId) => {
    const { data, error } = await sb.rpc('sf_estoque_enviado', { p_pmo: pmo, p_op: op, p_exceto: excetoId })
    if (error) throw new Error(`sf_estoque_enviado: ${error.message}`)
    const n = Number(data ?? 0)
    if (!Number.isFinite(n) || n < 0) throw new Error(`sf_estoque_enviado devolveu um valor inválido: ${String(data)}`)
    return n
  }
}

