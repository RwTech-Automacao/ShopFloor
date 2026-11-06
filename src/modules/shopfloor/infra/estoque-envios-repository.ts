import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ehEstoqueDestino, type EstoqueDestino } from '@/modules/compels/domain/estoque-destino'
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

/** Quanto tempo uma linha em espera fica fora da fila (`adiado_ate`) antes de tentar de novo. */
const ESPERA_ADIADA_MS = 5 * 60 * 1000

/** Erro grande não ajuda ninguém na tela e incha a linha: guarda o começo, que é onde está o motivo. */
const LIMITE_ERRO = 500

const OPERACOES: readonly EnvioEstoqueReservado['operacao'][] = ['entrada', 'estorno']
// 'lote' (0156): o lote do NQA individual vai ao Compels numa linha só, com a quantidade do lote.
const TIPOS: readonly EnvioEstoqueReservado['tipo'][] = ['caixa', 'serie', 'lote']

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
    estoque: ehEstoqueDestino(l.estoque) ? l.estoque : 'PA',
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

  /**
   * O estoque de destino (0175) de cada linha reservada. Lido da própria tabela por uma consulta pequena, e não
   * devolvido pela `sf_estoque_reservar`: mudar o `returns table` dela seria drop+create de uma função crítica
   * (o cron a chama a cada minuto), e esta leitura é por chave primária.
   *
   * ⚠️ Se a leitura falhar, as linhas NÃO seguem com o PA por omissão: uma EINTER mandada ao PA é estoque no
   * lugar errado do ERP, e sem aviso. Elas esperam (a tentativa devolvida, 5 min adiadas) e a próxima rodada
   * tenta de novo. A única exceção é a coluna ainda não existir (app novo antes da migração 0175): então toda
   * linha é PA, porque não há outra coisa que ela pudesse ser.
   */
  async function comEstoque(lidos: EnvioEstoqueReservado[], ilegiveis: number): Promise<LoteEstoqueReservado> {
    if (lidos.length === 0) return { envios: [], ilegiveis }
    const { data, error } = await sb
      .from('sf_estoque_envios')
      .select('id, estoque')
      .in('id', lidos.map((e) => e.id))
    if (error) {
      const semColuna = error.code === '42703' || /column .*estoque.* does not exist/i.test(error.message ?? '')
      if (semColuna) return { envios: lidos.map((e) => ({ ...e, estoque: 'PA' as const })), ilegiveis }
      const erro = `Não foi possível ler o estoque de destino da linha: ${error.message}`
      console.error(`[estoque] ${erro}`)
      for (const e of lidos) {
        try {
          await repo.concluirEnvio(e, { ok: false, erro, aguardar: true })
        } catch (x) {
          console.error(`[estoque] devolver a linha ${e.id} falhou:`, x instanceof Error ? x.message : x)
        }
      }
      return { envios: [], ilegiveis }
    }
    const porId = new Map<string, EstoqueDestino>()
    for (const l of (data ?? []) as { id: string; estoque: unknown }[]) {
      if (ehEstoqueDestino(l.estoque)) porId.set(l.id, l.estoque)
    }
    return { envios: lidos.map((e) => ({ ...e, estoque: porId.get(e.id) ?? 'PA' })), ilegiveis }
  }

  const repo: RepositorioEstoqueEnvios = {
    async reservarPendentes(limite: number): Promise<LoteEstoqueReservado> {
      const { data, error } = await sb.rpc('sf_estoque_reservar', { p_limite: limite })
      if (error) throw new Error(`sf_estoque_reservar: ${error.message}`)
      const lidos: EnvioEstoqueReservado[] = []
      let ilegiveis = 0
      for (const bruto of (data ?? []) as unknown[]) {
        const envio = lerEnvioEstoque(bruto)
        if (envio) lidos.push(envio)
        else {
          // Concluída como falha aqui (é este arquivo que sabe escrever na linha), mas CONTADA pra
          // quem chama: a linha ilegível é uma falha da rodada e ocupou lugar no lote. Devolver só as
          // legíveis escondia as duas coisas — o resumo dizia `falhas: 0` e o laço achava o lote
          // incompleto. Ver LoteEstoqueReservado, em application/enviar-estoque.ts.
          ilegiveis += 1
          await concluirIlegivel(bruto)
        }
      }
      return comEstoque(lidos, ilegiveis)
    },

    async concluirEnvio(envio: EnvioEstoqueReservado, resultado: ResultadoEnvioEstoque) {
      const { data, error } = await sb
        .from('sf_estoque_envios')
        .update({
          ok: resultado.ok,
          erro: resultado.ok ? null : resultado.erro.slice(0, LIMITE_ERRO),
          // Só quando há aviso: um envio normal não toca na coluna (0169), então nada muda enquanto a migração
          // não chegou — o que quebra, nesse caso, é só a linha que carrega aviso.
          ...(resultado.ok && resultado.aviso ? { aviso: resultado.aviso.slice(0, LIMITE_ERRO) } : {}),
          // Regravada a CADA FALHA/ESPERA (0170): a espera esperada de ontem (OP ainda não liberada) não pode
          // esconder a falha de hoje. Só nas falhas, de propósito: um envio que deu certo NÃO toca na coluna,
          // então, se o app subir um instante antes da migração, a fila continua concluindo as entradas — só as
          // falhas deixam de ser gravadas nessa janela. Linha enviada nunca entra no alerta de erro.
          ...(!resultado.ok ? { erro_esperado: resultado.esperado === true } : {}),
          // o CHECK da 0132 é ok = (enviado_em is not null): os dois andam sempre juntos
          enviado_em: resultado.ok ? new Date().toISOString() : null,
          // Solta a reserva: se falhou (e ainda tem tentativa), a próxima rodada pega de novo. Isso
          // NÃO "destoca" a linha para a sf_estoque_reverter — a marca que decide lá é
          // `tentativas > 0`, que nunca volta atrás (a reserva viva é só a outra metade dela).
          //
          //
          // EXCEÇÃO, a espera (`aguardar`): NADA chegou ao ERP (a recusa veio antes de qualquer
          // gravação), então a linha continua "intocada" de verdade: devolve a tentativa cobrada na
          // reserva e a adia por ~5 min na coluna `adiado_ate` (a reserva só pega linha com adiado_ate
          // vencido). Sem isso, esperar o empenho gastaria as 5 tentativas. Não se usa `reservado_em`
          // para adiar: ele é lido pelo cancelamento e pela tela como "uma rodada está entregando".
          ...(!resultado.ok && resultado.aguardar
            ? {
                tentativas: Math.max(envio.tentativas - 1, 0),
                reservado_em: null,
                adiado_ate: new Date(Date.now() + ESPERA_ADIADA_MS).toISOString(),
              }
            : { reservado_em: null, adiado_ate: null }),
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
  return repo
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

/**
 * O PONTO DE PARTIDA de cada OP do Compels (migração 0168): o apontado que ela já tinha lá quando a
 * integração gravou pela primeira vez. `op` é o número do Compels (só dígitos).
 */
export interface BaseDaOp {
  /** `null` = ainda não guardado. */
  ler(op: string): Promise<number | null>
  /** Guarda uma vez; se já existe, não troca (o primeiro número guardado é o que vale). */
  guardar(op: string, base: number): Promise<void>
}

export function criarBaseDaOp(sb: SupabaseClient = createServiceSupabase()): BaseDaOp {
  return {
    async ler(op) {
      const { data, error } = await sb.from('sf_compels_op_base').select('base').eq('op', op).maybeSingle()
      if (error) throw new Error(`sf_compels_op_base: ${error.message}`)
      if (!data) return null
      const n = Number((data as { base: unknown }).base)
      if (!Number.isFinite(n) || n < 0) throw new Error(`sf_compels_op_base devolveu um valor inválido para a OP ${op}`)
      return n
    },
    async guardar(op, base) {
      const { error } = await sb
        .from('sf_compels_op_base')
        .upsert({ op, base }, { onConflict: 'op', ignoreDuplicates: true })
      if (error) throw new Error(`sf_compels_op_base: ${error.message}`)
    },
  }
}
