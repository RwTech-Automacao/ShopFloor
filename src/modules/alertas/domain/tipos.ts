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
