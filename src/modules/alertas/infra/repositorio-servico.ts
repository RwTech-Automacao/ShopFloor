import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import { canalDiscordDoSistema } from './canais'
import { ehCanal, type Canal, type ResultadoEnvio } from '../domain/tipos'
import { lerResultadoAvaliacao, type ContaDestino } from '../domain/avaliacao'
import { lerEnvioReservado, type EnvioReservado } from '../domain/envio'
import { blocoCandidato, lerIntervaloDoBanco, type Intervalo } from '../domain/intervalos'
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
 * Regra de janela por blocos, como o PostgREST entrega. `janela_valor` (o PASSO em minutos) fica
 * `unknown` DE PROPÓSITO: o tipo dele é afirmado em `blocosDaRodada`, não suposto aqui.
 */
interface LinhaRegraBloco {
  id: string
  janela_tipo: string
  janela_valor: unknown
}

interface LinhaIntervaloBloco {
  regra_id: string
  inicio: string | null
  fim: string | null
}

/**
 * Repositório dos alertas com o client de SERVICE ROLE: ele ignora RLS de propósito — quem chama é
 * o cron e os webhooks, que não têm sessão de usuário nenhuma.
 */
export function criarRepositorioServico(
  sb: SupabaseClient = createServiceSupabase(),
  env: NodeJS.ProcessEnv = process.env,
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

  /**
   * O mapa `p_blocos` da rodada: {"<regra_id>": {inicio, fim}} com SÓ as regras de janela
   * 'intervalos' cujo bloco FECHOU agora. Regra ausente do mapa é PULADA pelo banco (não abre, não
   * insiste, não normaliza, não encosta no bloco_reportado).
   *
   * ⚠️ POR QUE A CONTA DE HORÁRIO MORA AQUI, E NÃO NO SQL: é o MESMO padrão do `p_canal_discord`
   * logo abaixo — o que o banco não tem como saber (ou não tem como testar) chega pronto do
   * servidor. Ladrilhar o intervalo pelo passo, resolver o fuso America/Sao_Paulo num processo que
   * roda em UTC e decidir "só o bloco que fechou HOJE" são contas que erram em silêncio; em
   * `domain/intervalos.ts` elas têm 100+ testes rodando em quatro fusos, e SQL neste projeto não
   * tem teste de unidade nenhum. A 0139 declara a mesma coisa do lado de lá: nenhum `now()`,
   * `current_date` ou `at time zone` aparece nela.
   *
   * Duas consultas no total — as regras e os intervalos de TODAS elas —, nunca uma por regra.
   * Erro de leitura não derruba a rodada: as outras três janelas não podem parar porque esta
   * falhou, e o que acontece fica no log.
   */
  async function blocosDaRodada(agora: Date): Promise<Record<string, { inicio: string; fim: string }>> {
    const mapa: Record<string, { inicio: string; fim: string }> = {}

    const { data, error } = await sb
      .from('alerta_regras')
      .select('id, janela_tipo, janela_valor')
      .eq('ativa', true)
      .is('excluida_em', null)
      .eq('janela_tipo', 'intervalos')
    if (error) {
      console.error('[alertas] ler as regras da janela por blocos falhou:', error.message)
      return mapa
    }
    // O filtro vai no `where` E aqui: regra de outra janela não pode entrar no mapa nem se um dia
    // a consulta mudar — no banco a chave dela faria o ramo 'intervalos' medir a faixa errada.
    const regras = ((data ?? []) as LinhaRegraBloco[]).filter((r) => r.janela_tipo === 'intervalos')
    if (regras.length === 0) return mapa

    const { data: linhas, error: erroIntervalos } = await sb
      .from('alerta_regra_intervalos')
      .select('regra_id, inicio, fim')
      .in('regra_id', regras.map((r) => r.id))
      .order('inicio')
    if (erroIntervalos) {
      console.error('[alertas] ler os intervalos do turno falhou:', erroIntervalos.message)
      return mapa
    }
    const porRegra = new Map<string, Intervalo[]>()
    for (const l of (linhas ?? []) as LinhaIntervaloBloco[]) {
      const intervalo = lerIntervaloDoBanco(l.inicio, l.fim)
      if (!intervalo) continue
      const lista = porRegra.get(l.regra_id)
      if (lista) lista.push(intervalo)
      else porRegra.set(l.regra_id, [intervalo])
    }

    for (const r of regras) {
      const intervalos = porRegra.get(r.id) ?? []
      if (intervalos.length === 0) {
        // Regra de janela por blocos sem turno cadastrado nunca tem bloco: ela não alertaria mais,
        // e sem este log ninguém saberia por quê.
        console.error(`[alertas] regra ${r.id}: janela por blocos SEM intervalo cadastrado — nada a avaliar`)
        continue
      }
      const passo = r.janela_valor
      // ⚠️ O PASSO TEM QUE SER NÚMERO. Hoje `janela_valor` é `int` e o PostgREST entrega number;
      // no dia em que a coluna virar `numeric` ou `bigint` ele passa a entregar STRING, e
      // `blocoCandidato` devolve null para o que não é inteiro >= 1 — null é indistinguível de
      // "nenhum bloco fechou", então os alertas desta janela parariam PARA SEMPRE sem um log. Por
      // isso o tipo é AFIRMADO aqui, e o que não é número vira barulho no log em vez de silêncio.
      if (typeof passo !== 'number' || !Number.isInteger(passo) || passo < 1) {
        console.error(
          `[alertas] regra ${r.id}: janela_valor não chegou como inteiro de minutos ` +
            `(${typeof passo}: ${String(passo)}) — bloco NÃO calculado`,
        )
        continue
      }
      const bloco = blocoCandidato(intervalos, passo, agora)
      // Null aqui é o caso NORMAL: fora do turno, ou antes do primeiro bloco fechar.
      if (!bloco) continue
      mapa[r.id] = { inicio: bloco.inicio.toISOString(), fim: bloco.fim.toISOString() }
    }
    return mapa
  }

  return {
    async avaliar() {
      // Os dois parâmetros vêm do SERVIDOR pelo mesmo motivo (ver `blocosDaRodada`):
      // - o id do canal mora no servidor, não no banco: o avaliar recebe e congela na linha da
      //   fila (0123). Null = ambiente sem canal, e nenhuma linha de canal é enfileirada;
      // - o bloco que fechou é conta de horário, e ela mora no TS, onde tem teste.
      const { data, error } = await sb.rpc('alerta_avaliar', {
        p_canal_discord: canalDiscordDoSistema(env),
        p_blocos: await blocosDaRodada(new Date()),
      })
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
        destino_tipo: 'usuario',
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

    async resolver(ocorrenciaId: string, usuarioId: string, explicacao?: string) {
      const { data, error } = await sb.rpc('alerta_resolver', {
        p_ocorrencia_id: ocorrenciaId,
        p_usuario_id: usuarioId,
        // Sem texto o parâmetro nem vai: o default do banco ('') faz o papel, e o telegram, que
        // ainda não pergunta nada, segue chamando exatamente como antes.
        ...(explicacao ? { p_explicacao: explicacao } : {}),
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
