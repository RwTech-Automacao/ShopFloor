import { ehCanal, ehJanelaTipo, type Canal, type TipoEnvio } from './tipos'
import { textoAlerta, textoLembrete, textoNormalizou, textoResolvido, textoTeste } from './mensagens'

/**
 * Uma linha da fila (`alerta_envios`) já RESERVADA por esta rodada (`alerta_reservar_envios`):
 * `tentativas` já conta esta tentativa, e `externoId` é o da conta vinculada de AGORA.
 */
export interface EnvioReservado {
  id: string
  ocorrenciaId: string | null
  usuarioId: string
  canal: Canal
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
    usuarioId: String(l.usuario_id ?? ''),
    canal: l.canal,
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

/**
 * Monta o texto de uma linha da fila a partir dos `dados` gravados pelo banco. A formatação
 * (fuso de São Paulo, taxa truncada, duração) existe SÓ aqui no TS — o SQL guarda os números.
 * Como os dados foram congelados quando a linha nasceu, o reenvio sai idêntico à primeira vez.
 * Lança `DadosEnvioInvalidos` se faltar algo (quem chama trata por item).
 *
 * Chaves por tipo (as mesmas do jsonb_build_object da 0113):
 *   alerta/lembrete/normalizou: regra_nome, posto, taxa_minima, aprovados, reprovados,
 *                               janela_tipo, janela_valor, pmo, op, aberta_em, agora (+ taxa)
 *   resolvido: posto, resolvida_por_nome, resolvida_em
 *   teste: nome
 */
export function textoDoEnvio(tipo: TipoEnvio, dados: Record<string, unknown>): string {
  if (tipo === 'teste') return textoTeste(texto(dados, 'nome'))
  if (tipo === 'resolvido') {
    return textoResolvido({
      posto: texto(dados, 'posto'),
      nome: texto(dados, 'resolvida_por_nome'),
      em: data(dados, 'resolvida_em'),
    })
  }

  const posto = texto(dados, 'posto')
  const aprovados = numero(dados, 'aprovados')
  const reprovados = numero(dados, 'reprovados')
  const abertaEm = data(dados, 'aberta_em')
  const agora = data(dados, 'agora')
  if (tipo === 'normalizou') {
    return textoNormalizou({ posto, aprovados, reprovados, abertaEm, em: agora })
  }

  const janelaTipo = dados.janela_tipo
  if (!ehJanelaTipo(janelaTipo)) throw new DadosEnvioInvalidos('janela_tipo')
  const janelaValor = dados.janela_valor === null || dados.janela_valor === undefined
    ? null
    : numero(dados, 'janela_valor')
  const base = {
    posto,
    regraNome: texto(dados, 'regra_nome'),
    taxaMinima: numero(dados, 'taxa_minima'),
    aprovados,
    reprovados,
    janela: { tipo: janelaTipo, valor: janelaValor, pmo: textoOuNulo(dados, 'pmo'), op: textoOuNulo(dados, 'op') },
    em: agora,
  }
  if (tipo === 'alerta') return textoAlerta(base)
  return textoLembrete({ ...base, abertaEm })
}
