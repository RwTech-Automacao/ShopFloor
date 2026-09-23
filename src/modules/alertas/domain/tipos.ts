/** Canais de envio suportados nesta versão. */
export type Canal = 'telegram' | 'discord'
export const CANAIS: readonly Canal[] = ['telegram', 'discord']
export const NOME_CANAL: Record<Canal, string> = { telegram: 'Telegram', discord: 'Discord' }

/** Como a janela de avaliação é medida (ver seção 3 da spec). */
export type JanelaTipo = 'tempo' | 'bipes' | 'op'

/** Tipos de mensagem gravados em `alerta_envios.tipo`. */
export type TipoEnvio = 'alerta' | 'lembrete' | 'resolvido' | 'normalizou' | 'teste'

/** Estados de uma ocorrência (`alerta_ocorrencias.estado`). */
export type EstadoOcorrencia = 'aberta' | 'resolvida' | 'normalizada'

/**
 * Para onde uma linha da fila vai (`alerta_envios.destino_tipo`, 0123): a conversa privada de um
 * responsável ou o canal do Discord do sistema. O texto é o mesmo nos dois.
 */
export type DestinoTipo = 'usuario' | 'canal'

/** O destino já resolvido pela fila: a reserva devolve o endereço pronto, seja de quem for. */
export interface DestinoEnvio {
  tipo: DestinoTipo
  /** Chat/usuário do canal (pessoa) ou id do canal do Discord. */
  externoId: string
}

/** É um tipo de destino conhecido? (linha vinda do banco) */
export function ehDestinoTipo(valor: unknown): valor is DestinoTipo {
  return valor === 'usuario' || valor === 'canal'
}

/**
 * Resultado de um envio. O `mensagemExternaId` é `"<chat|canal>:<id da mensagem>"` — guardamos os
 * dois pedaços porque tanto o Telegram quanto o Discord exigem o par para EDITAR a mensagem depois
 * (tirar o botão quando a ocorrência é resolvida).
 */
export type ResultadoEnvio = { ok: true; mensagemExternaId: string } | { ok: false; erro: string }

export type ResultadoSimples = { ok: true } | { ok: false; erro: string }

/** É um canal conhecido? (entrada vinda de formulário/banco) */
export function ehCanal(valor: unknown): valor is Canal {
  return valor === 'telegram' || valor === 'discord'
}

/** É um tipo de janela conhecido? */
export function ehJanelaTipo(valor: unknown): valor is JanelaTipo {
  return valor === 'tempo' || valor === 'bipes' || valor === 'op'
}

/** Vínculo do usuário logado num canal (o que a tela Meu perfil mostra). */
export interface ContaVinculada {
  canal: Canal
  vinculadoEm: string
}

/** Tipo da regra (spec 2026-09-18). O tipo não muda depois de criado. */
export type TipoRegra = 'aprovacao' | 'tempo' | 'defeito'
export const TIPOS_REGRA: readonly TipoRegra[] = ['aprovacao', 'tempo', 'defeito']

export const NOME_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de aprovação',
  tempo: 'Tempo médio por peça',
  defeito: 'Defeito repetido',
}

/** A frase de cada cartão da escolha do tipo. */
export const DESCRICAO_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Avisa quando a taxa de aprovação do posto cai abaixo da meta.',
  tempo: 'Avisa quando o tempo médio entre um bipe e o próximo passa do limite.',
  defeito: 'Avisa quando o mesmo defeito se repete várias vezes no posto em pouco tempo.',
}

/** É um tipo de regra conhecido? */
export function ehTipoRegra(valor: unknown): valor is TipoRegra {
  return valor === 'aprovacao' || valor === 'tempo' || valor === 'defeito'
}
