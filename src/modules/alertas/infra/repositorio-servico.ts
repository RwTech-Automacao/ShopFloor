import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { ehCanal, type Canal, type ResultadoEnvio } from '../domain/tipos'
import { lerResultadoAvaliacao, type ContaDestino } from '../domain/avaliacao'
import { lerEnvioReservado, type EnvioReservado } from '../domain/envio'
import { lerResolucao } from '../domain/resolucao'
import { codigoErroAlerta, mensagemErroAlerta } from '../domain/erros'
import type {
  FiltroReserva,
  MensagemComBotao,
  NovoEnvioDireto,
  RepositorioEnvios,
  RepositorioVinculo,
} from '../application/portas'

const LIMITE_ERRO = 500

interface LinhaConta {
  usuario_id: string
  canal: string
  externo_id: string
}

/**
 * Repositório dos alertas com o client de SERVICE ROLE: ele ignora RLS de propósito — quem chama é
 * o cron e os webhooks, que não têm sessão de usuário nenhuma.
 */
export function criarRepositorioServico(
  sb: SupabaseClient = createServiceSupabase(),
): RepositorioEnvios & RepositorioVinculo {
  async function contas(usuarioIds: string[], canais: Canal[]): Promise<ContaDestino[]> {
    if (usuarioIds.length === 0 || canais.length === 0) return []
    const { data, error } = await sb
      .from('alerta_contas')
      .select('usuario_id, canal, externo_id')
      .in('usuario_id', usuarioIds)
      .in('canal', canais)
    if (error) throw new Error(`alerta_contas: ${error.message}`)
    const saida: ContaDestino[] = []
    for (const linha of (data ?? []) as LinhaConta[]) {
      if (!ehCanal(linha.canal)) continue
      saida.push({ usuarioId: linha.usuario_id, canal: linha.canal, externoId: linha.externo_id })
    }
    return saida
  }

  /**
   * Linha reservada que este código não entende (canal/tipo novo no banco, id/externo_id vazio):
   * em vez de só pular (e ela voltar reservada a cada 15 min sem nunca registrar nada), conclui
   * como FALHA com o motivo. A tentativa já foi contada na reserva — na 3ª ela morre e aparece como
   * falha na aba Ocorrências. Mesma cerca de `tentativas` do `concluirEnvio`.
   */
  async function concluirIlegivel(bruto: unknown): Promise<void> {
    const l = (bruto ?? {}) as Record<string, unknown>
    const id = typeof l.id === 'string' ? l.id : ''
    console.error('[alertas] linha da fila ilegível (canal/tipo desconhecido)', id)
    if (id === '') return
    try {
      const { error } = await sb
        .from('alerta_envios')
        .update({
          ok: false,
          erro: `Linha ilegível: canal/tipo desconhecido (${String(l.canal ?? '')}/${String(l.tipo ?? '')})`
            .slice(0, LIMITE_ERRO),
          reservado_em: null,
        })
        .eq('id', id)
        .eq('tentativas', Number(l.tentativas ?? 0) || 0)
      if (error) console.error(`[alertas] concluir linha ilegível ${id} falhou:`, error.message)
    } catch (e) {
      console.error(`[alertas] concluir linha ilegível ${id} falhou:`, e instanceof Error ? e.message : e)
    }
  }

  return {
    async avaliar() {
      const { data, error } = await sb.rpc('alerta_avaliar')
      if (error) throw new Error(`alerta_avaliar: ${error.message}`)
      return lerResultadoAvaliacao(data)
    },

    async reservarPendentes(f: FiltroReserva): Promise<EnvioReservado[]> {
      const { data, error } = await sb.rpc('alerta_reservar_envios', {
        p_canais: f.canais,
        p_limite: f.limite,
        p_ocorrencia_id: f.ocorrenciaId,
      })
      if (error) throw new Error(`alerta_reservar_envios: ${error.message}`)
      const saida: EnvioReservado[] = []
      for (const bruto of (data ?? []) as unknown[]) {
        const envio = lerEnvioReservado(bruto)
        if (envio) saida.push(envio)
        else await concluirIlegivel(bruto)
      }
      return saida
    },

    async concluirEnvio(envio: EnvioReservado, texto: string, resultado: ResultadoEnvio) {
      const { data, error } = await sb
        .from('alerta_envios')
        .update({
          ok: resultado.ok,
          erro: resultado.ok ? null : resultado.erro.slice(0, LIMITE_ERRO),
          mensagem_externa_id: resultado.ok ? resultado.mensagemExternaId : null,
          texto,
          enviado_em: resultado.ok ? new Date().toISOString() : null,
          // solta a reserva: se falhou (e ainda tem tentativa), a próxima rodada pega de novo
          reservado_em: null,
        })
        .eq('id', envio.id)
        // Cerca: se a reserva desta rodada venceu e outra rodada re-reservou a linha (tentativas
        // subiu), esta escrita atrasada não pode sobrescrever o resultado da outra.
        .eq('tentativas', envio.tentativas)
        .select('id')
      if (error) throw new Error(`alerta_envios: ${error.message}`)
      if ((data ?? []).length === 0) {
        console.error(`[alertas] envio ${envio.id}: resultado descartado (linha re-reservada por outra rodada)`)
      }
    },

    async registrarEnvioDireto(e: NovoEnvioDireto) {
      const { error } = await sb.from('alerta_envios').insert({
        ocorrencia_id: null,
        usuario_id: e.usuarioId,
        canal: e.canal,
        tipo: e.tipo,
        dados: e.dados,
        texto: e.texto,
        com_botao: false,
        mensagem_externa_id: e.resultado.ok ? e.resultado.mensagemExternaId : null,
        ok: e.resultado.ok,
        erro: e.resultado.ok ? null : e.resultado.erro.slice(0, LIMITE_ERRO),
        tentativas: 1,
        enviado_em: e.resultado.ok ? new Date().toISOString() : null,
      })
      // Não derruba nada: a mensagem já foi entregue (ou não); o que falhou foi a auditoria.
      if (error) console.error('[alertas] gravar envio de teste falhou:', error.message)
    },

    async mensagensComBotao(ocorrenciaId: string): Promise<MensagemComBotao[]> {
      const { data, error } = await sb
        .from('alerta_envios')
        .select('id, canal, mensagem_externa_id')
        .eq('ocorrencia_id', ocorrenciaId)
        .eq('com_botao', true)
        .eq('ok', true)
        .not('mensagem_externa_id', 'is', null)
      if (error) throw new Error(`alerta_envios: ${error.message}`)
      const saida: MensagemComBotao[] = []
      for (const l of (data ?? []) as { id: string; canal: string; mensagem_externa_id: string }[]) {
        if (!ehCanal(l.canal)) continue
        saida.push({ envioId: l.id, canal: l.canal, mensagemExternaId: l.mensagem_externa_id })
      }
      return saida
    },

    async marcarSemBotao(envioIds: string[]) {
      if (envioIds.length === 0) return
      const { error } = await sb.from('alerta_envios').update({ com_botao: false }).in('id', envioIds)
      if (error) console.error('[alertas] marcar sem botão falhou:', error.message)
    },

    async contaDoUsuario(usuarioId: string, canal: Canal) {
      const lista = await contas([usuarioId], [canal])
      return lista[0] ?? null
    },

    async vincular(codigo: string, canal: Canal, externoId: string) {
      const { data, error } = await sb.rpc('alerta_vincular', {
        p_codigo: codigo,
        p_canal: canal,
        p_externo_id: externoId,
      })
      // Revisão da Task 2: alerta_vincular NUNCA levanta exceção de regra de negócio (senão a
      // proteção contra força bruta perderia o registro da tentativa — o raise desfaz a
      // transação inteira da chamada). Ela sempre devolve jsonb:
      //   sucesso: {"ok": true, "nome": "..."}
      //   falha:   {"ok": false, "erro": "CANAL_INVALIDO" | "CODIGO_INVALIDO"
      //                                  | "CONTA_JA_VINCULADA" | "MUITAS_TENTATIVAS"}
      // `error` aqui só acontece em falha de sistema (conexão, etc.), não em erro de regra.
      if (error) return { ok: false as const, erro: mensagemErroAlerta(error.message) }
      // `data` null sem `error` não deveria acontecer, mas não pode derrubar o webhook.
      const r = data as { ok: boolean; nome?: string; erro?: string } | null
      if (!r?.ok) return { ok: false as const, erro: mensagemErroAlerta(r?.erro) }
      return { ok: true as const, nome: r.nome ?? '' }
    },

    async usuarioPorConta(canal: Canal, externoId: string) {
      const { data, error } = await sb
        .from('alerta_contas')
        .select('usuario_id')
        .eq('canal', canal)
        .eq('externo_id', externoId)
        .maybeSingle()
      if (error) throw new Error(`alerta_contas: ${error.message}`)
      return (data as { usuario_id: string } | null)?.usuario_id ?? null
    },

    async resolver(ocorrenciaId: string, usuarioId: string) {
      const { data, error } = await sb.rpc('alerta_resolver', {
        p_ocorrencia_id: ocorrenciaId,
        p_usuario_id: usuarioId,
      })
      if (error) {
        return {
          ok: false as const,
          codigo: codigoErroAlerta(error.message),
          erro: mensagemErroAlerta(error.message),
        }
      }
      return { ok: true as const, resolucao: lerResolucao(data) }
    },
  }
}
