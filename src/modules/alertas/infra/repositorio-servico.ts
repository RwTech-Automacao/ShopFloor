import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { ehCanal, type Canal, type ResultadoEnvio } from '../domain/tipos'
import { lerResultadoAvaliacao, type ContaDestino } from '../domain/avaliacao'
import type {
  EnvioPendente,
  MensagemComBotao,
  NovoEnvio,
  RepositorioEnvios,
} from '../application/portas'

const LIMITE_ERRO = 500
const JANELA_REENVIO_MS = 24 * 60 * 60 * 1000

interface LinhaConta {
  usuario_id: string
  canal: string
  externo_id: string
}

interface LinhaPendente {
  id: string
  ocorrencia_id: string | null
  usuario_id: string
  canal: string
  tipo: string
  texto: string
  com_botao: boolean
  tentativas: number
  alerta_ocorrencias: { estado: string } | null
}

/**
 * Repositório dos alertas com o client de SERVICE ROLE: ele ignora RLS de propósito — quem chama é
 * o cron e os webhooks, que não têm sessão de usuário nenhuma.
 */
export function criarRepositorioServico(
  sb: SupabaseClient = createServiceSupabase(),
): RepositorioEnvios {
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

  return {
    async avaliar() {
      const { data, error } = await sb.rpc('alerta_avaliar')
      if (error) throw new Error(`alerta_avaliar: ${error.message}`)
      return lerResultadoAvaliacao(data)
    },

    async registrarEnvio(e: NovoEnvio) {
      const { error } = await sb.from('alerta_envios').insert({
        ocorrencia_id: e.ocorrenciaId,
        usuario_id: e.usuarioId,
        canal: e.canal,
        tipo: e.tipo,
        texto: e.texto,
        com_botao: e.comBotao,
        mensagem_externa_id: e.resultado.ok ? e.resultado.mensagemExternaId : null,
        ok: e.resultado.ok,
        erro: e.resultado.ok ? null : e.resultado.erro.slice(0, LIMITE_ERRO),
        tentativas: 1,
      })
      // Não derruba a rodada: a mensagem já foi entregue; o que falhou foi a auditoria.
      if (error) console.error('[alertas] gravar envio falhou:', error.message)
    },

    async envioParaReenviar() {
      const desde = new Date(Date.now() - JANELA_REENVIO_MS).toISOString()
      const { data, error } = await sb
        .from('alerta_envios')
        .select('id, ocorrencia_id, usuario_id, canal, tipo, texto, com_botao, tentativas, alerta_ocorrencias(estado)')
        .eq('ok', false)
        .lt('tentativas', 3)
        .neq('tipo', 'teste')
        .gte('criado_em', desde)
        .order('criado_em', { ascending: true })
        .limit(100)
      if (error) throw new Error(`alerta_envios: ${error.message}`)

      const linhas = (data ?? []) as unknown as LinhaPendente[]
      const uteis = linhas.filter((l) => {
        if (!ehCanal(l.canal)) return false
        // Alerta/lembrete de ocorrência que já foi resolvida ou normalizou virou notícia velha.
        if (l.tipo === 'alerta' || l.tipo === 'lembrete') return l.alerta_ocorrencias?.estado === 'aberta'
        return true
      })
      if (uteis.length === 0) return []

      const canaisUsados = [...new Set(uteis.map((l) => l.canal))].filter(ehCanal)
      const mapa = new Map<string, string>()
      for (const c of await contas([...new Set(uteis.map((l) => l.usuario_id))], canaisUsados)) {
        mapa.set(`${c.usuarioId}|${c.canal}`, c.externoId)
      }

      const pendentes: EnvioPendente[] = []
      for (const l of uteis) {
        const externoId = mapa.get(`${l.usuario_id}|${l.canal}`)
        if (!externoId || !ehCanal(l.canal)) continue // desvinculou no meio: não há pra onde reenviar
        pendentes.push({
          id: l.id,
          ocorrenciaId: l.ocorrencia_id,
          canal: l.canal,
          externoId,
          texto: l.texto,
          comBotao: l.com_botao,
          tentativas: l.tentativas,
        })
      }
      return pendentes
    },

    async registrarReenvio(envio: EnvioPendente, resultado: ResultadoEnvio) {
      const { error } = await sb
        .from('alerta_envios')
        .update({
          ok: resultado.ok,
          erro: resultado.ok ? null : resultado.erro.slice(0, LIMITE_ERRO),
          mensagem_externa_id: resultado.ok ? resultado.mensagemExternaId : null,
          tentativas: envio.tentativas + 1,
        })
        .eq('id', envio.id)
      if (error) console.error('[alertas] atualizar reenvio falhou:', error.message)
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

    async contasDaOcorrencia(ocorrenciaId: string) {
      const { data, error } = await sb
        .from('alerta_ocorrencias')
        .select('alerta_regras(destinatarios, canais)')
        .eq('id', ocorrenciaId)
        .maybeSingle()
      if (error) throw new Error(`alerta_ocorrencias: ${error.message}`)
      const regra = (data as { alerta_regras: { destinatarios: string[]; canais: string[] } | null } | null)
        ?.alerta_regras
      if (!regra) return []
      return contas(regra.destinatarios ?? [], (regra.canais ?? []).filter(ehCanal))
    },

    async contaDoUsuario(usuarioId: string, canal: Canal) {
      const lista = await contas([usuarioId], [canal])
      return lista[0] ?? null
    },
  }
}
