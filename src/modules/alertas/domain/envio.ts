import {
  ehCanal,
  ehDestinoTipo,
  ehJanelaTipo,
  ehTipoRegra,
  type Canal,
  type DestinoTipo,
  type TipoEnvio,
} from './tipos'
import type { Janela } from './janela'
import {
  textoAlerta,
  textoAlertaDefeito,
  textoAlertaTempo,
  textoLembrete,
  textoLembreteTipo,
  textoNormalizou,
  textoNormalizouDefeito,
  textoNormalizouTempo,
  textoReabertura,
  textoResolvido,
  textoTeste,
} from './mensagens'

/**
 * Uma linha da fila (`alerta_envios`) já RESERVADA por esta rodada (`alerta_reservar_envios`):
 * `tentativas` já conta esta tentativa, e `externoId` é o da conta vinculada de AGORA.
 */
export interface EnvioReservado {
  id: string
  ocorrenciaId: string | null
  /** Null nas linhas de canal: um aviso no canal não é de ninguém. */
  usuarioId: string | null
  canal: Canal
  /** Destino da linha (0123). Linha sem a coluna (banco antigo) é de pessoa. */
  destinoTipo: DestinoTipo
  externoId: string
  tipo: TipoEnvio
  /** O que o banco guardou para montar o texto (ver `textoDoEnvio`). */
  dados: Record<string, unknown>
  comBotao: boolean
  tentativas: number
}

const TIPOS: readonly TipoEnvio[] = ['alerta', 'lembrete', 'resolvido', 'normalizou', 'teste']

function ehTipoEnvio(v: unknown): v is TipoEnvio {
  return typeof v === 'string' && (TIPOS as readonly string[]).includes(v)
}

/**
 * Converte uma linha devolvida pelo `alerta_reservar_envios`. Linha que não reconhece (canal ou
 * tipo novo no banco) volta `null` e é pulada — a reserva vence e ela volta numa rodada futura.
 */
export function lerEnvioReservado(bruto: unknown): EnvioReservado | null {
  const l = (bruto ?? {}) as Record<string, unknown>
  if (!ehCanal(l.canal) || !ehTipoEnvio(l.tipo)) return null
  const id = String(l.id ?? '')
  const externoId = String(l.externo_id ?? '')
  if (id === '' || externoId === '') return null
  const dados = l.dados && typeof l.dados === 'object' && !Array.isArray(l.dados)
    ? (l.dados as Record<string, unknown>)
    : {}
  return {
    id,
    ocorrenciaId: l.ocorrencia_id === null || l.ocorrencia_id === undefined ? null : String(l.ocorrencia_id),
    usuarioId: l.usuario_id === null || l.usuario_id === undefined ? null : String(l.usuario_id),
    canal: l.canal,
    // Banco ainda sem a 0123 (deploy antes da migração): toda linha é de pessoa.
    destinoTipo: ehDestinoTipo(l.destino_tipo) ? l.destino_tipo : 'usuario',
    externoId,
    tipo: l.tipo,
    dados,
    comBotao: l.com_botao === true,
    tentativas: Number(l.tentativas ?? 0) || 0,
  }
}

/** Erro de montagem: a linha não tem os dados que o tipo exige. */
export class DadosEnvioInvalidos extends Error {
  constructor(campo: string) {
    super(`DADOS_INVALIDOS: ${campo}`)
    this.name = 'DadosEnvioInvalidos'
  }
}

function texto(d: Record<string, unknown>, campo: string): string {
  const v = d[campo]
  if (v === null || v === undefined || String(v) === '') throw new DadosEnvioInvalidos(campo)
  return String(v)
}

function textoOuNulo(d: Record<string, unknown>, campo: string): string | null {
  const v = d[campo]
  return v === null || v === undefined ? null : String(v)
}

function numero(d: Record<string, unknown>, campo: string): number {
  const n = Number(d[campo])
  if (d[campo] === null || d[campo] === undefined || !Number.isFinite(n)) throw new DadosEnvioInvalidos(campo)
  return n
}

function data(d: Record<string, unknown>, campo: string): Date {
  const v = new Date(texto(d, campo))
  if (Number.isNaN(v.getTime())) throw new DadosEnvioInvalidos(campo)
  return v
}

/** Data que pode faltar (linha antiga da fila): ausente, vazia ou inválida = null, sem lançar. */
function dataOuNulo(d: Record<string, unknown>, campo: string): Date | null {
  const bruto = textoOuNulo(d, campo)
  if (bruto === null || bruto === '') return null
  const v = new Date(bruto)
  return Number.isNaN(v.getTime()) ? null : v
}

/** Envios que nascem de uma ocorrência — os únicos cujo texto depende do tipo da regra. */
type TipoEnvioOcorrencia = Exclude<TipoEnvio, 'teste' | 'resolvido'>

function janelaDe(d: Record<string, unknown>): Janela {
  const tipo = d.janela_tipo
  if (!ehJanelaTipo(tipo)) throw new DadosEnvioInvalidos('janela_tipo')
  const valor = d.janela_valor === null || d.janela_valor === undefined ? null : numero(d, 'janela_valor')
  return { tipo, valor, pmo: textoOuNulo(d, 'pmo'), op: textoOuNulo(d, 'op') }
}

function textoAprovacao(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const posto = texto(dados, 'posto')
  const aprovados = numero(dados, 'aprovados')
  const reprovados = numero(dados, 'reprovados')
  const abertaEm = data(dados, 'aberta_em')
  const agora = data(dados, 'agora')
  if (tipo === 'normalizou') return textoNormalizou({ posto, aprovados, reprovados, abertaEm, em: agora })
  const base = {
    posto,
    regraNome: texto(dados, 'regra_nome'),
    taxaMinima: numero(dados, 'taxa_minima'),
    aprovados,
    reprovados,
    janela: janelaDe(dados),
    em: agora,
  }
  if (tipo === 'alerta') return textoAlerta(base)
  return textoLembrete({ ...base, abertaEm })
}

function textoTempo(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const posto = texto(dados, 'posto')
  const mediaSeg = numero(dados, 'media_seg')
  if (tipo === 'normalizou') return textoNormalizouTempo({ posto, mediaSeg })
  const agora = data(dados, 'agora')
  const alerta = textoAlertaTempo({
    posto,
    regraNome: texto(dados, 'regra_nome'),
    mediaSeg,
    limiteSeg: numero(dados, 'limite_tempo_seg'),
    pecas: numero(dados, 'pecas'),
    janela: janelaDe(dados),
    em: agora,
  })
  if (tipo === 'alerta') return alerta
  return textoLembreteTipo(alerta, data(dados, 'aberta_em'), agora)
}

function textoDefeito(tipo: TipoEnvioOcorrencia, dados: Record<string, unknown>): string {
  const posto = texto(dados, 'posto')
  const defeito = texto(dados, 'defeito')
  if (tipo === 'normalizou') return textoNormalizouDefeito({ posto, defeito })
  const agora = data(dados, 'agora')
  const alerta = textoAlertaDefeito({
    posto,
    regraNome: texto(dados, 'regra_nome'),
    defeito,
    ocorrencias: numero(dados, 'ocorrencias'),
    limite: numero(dados, 'limite_ocorrencias'),
    janela: janelaDe(dados),
    em: agora,
  })
  if (tipo === 'alerta') return alerta
  return textoLembreteTipo(alerta, data(dados, 'aberta_em'), agora)
}

/**
 * Monta o texto de uma linha da fila a partir dos `dados` gravados pelo banco. A formatação
 * (fuso de São Paulo, taxa truncada, mm:ss, duração) existe SÓ aqui no TS — o SQL guarda os números.
 * Como os dados foram congelados quando a linha nasceu, o reenvio sai idêntico à primeira vez.
 * Lança `DadosEnvioInvalidos` se faltar algo (quem chama trata por item).
 *
 * Chaves (as mesmas do jsonb_build_object do alerta_avaliar da 0115):
 *   comuns (alerta/lembrete/normalizou): regra_tipo, regra_nome, posto, janela_tipo, janela_valor,
 *                                        pmo, op, aberta_em, agora
 *   aprovacao: taxa, taxa_minima, aprovados, reprovados
 *   tempo:     media_seg, limite_tempo_seg, pecas
 *   defeito:   defeito, ocorrencias, limite_ocorrencias
 *   resolvido: posto, resolvida_por_nome, resolvida_em, defeito (opcional — só em regra de defeito)
 *   teste: nome
 *   reabertura (só no 'alerta' que nasce de uma reabertura, 0122): reabertura = true,
 *              resolvida_por_nome, resolvida_em, reaberturas
 * `regra_tipo` ausente = 'aprovacao' (linhas enfileiradas antes da 0115).
 */
export function textoDoEnvio(tipo: TipoEnvio, dados: Record<string, unknown>): string {
  if (tipo === 'teste') return textoTeste(texto(dados, 'nome'))
  if (tipo === 'resolvido') {
    return textoResolvido({
      posto: texto(dados, 'posto'),
      nome: texto(dados, 'resolvida_por_nome'),
      em: data(dados, 'resolvida_em'),
      // Ausente nas linhas antigas da fila (de antes desta correção) e nos tipos sem defeito.
      defeito: textoOuNulo(dados, 'defeito'),
    })
  }

  const regraTipo = dados.regra_tipo === null || dados.regra_tipo === undefined ? 'aprovacao' : dados.regra_tipo
  if (!ehTipoRegra(regraTipo)) throw new DadosEnvioInvalidos('regra_tipo')
  const corpo =
    regraTipo === 'tempo'
      ? textoTempo(tipo, dados)
      : regraTipo === 'defeito'
        ? textoDefeito(tipo, dados)
        : textoAprovacao(tipo, dados)

  // REABERTURA: vale para os três tipos, então o cabeçalho envolve o texto já montado em vez de
  // ser repetido dentro de cada um. Só no 'alerta' — a reabertura sempre enfileira esse tipo.
  if (tipo === 'alerta' && dados.reabertura === true) {
    return textoReabertura(corpo, {
      nome: textoOuNulo(dados, 'resolvida_por_nome') ?? '',
      resolvidaEm: dataOuNulo(dados, 'resolvida_em'),
      em: data(dados, 'agora'),
    })
  }
  return corpo
}
