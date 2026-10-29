/** Canais de envio suportados nesta versão. */
export type Canal = 'telegram' | 'discord' | 'email'
export const CANAIS: readonly Canal[] = ['telegram', 'discord', 'email']
export const NOME_CANAL: Record<Canal, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  email: 'E-mail',
}

/**
 * Canais em que a pessoa precisa VINCULAR uma conta (código de vínculo). O e-mail fica de fora de
 * propósito: usa o endereço do login (`usuarios.email`), não há o que vincular nem desvincular.
 */
export const CANAIS_COM_VINCULO: readonly Canal[] = ['telegram', 'discord']

/** Como a janela de avaliação é medida (ver seção 3 da spec). */
export type JanelaTipo = 'tempo' | 'bipes' | 'op' | 'intervalos'

/** Tipos de mensagem gravados em `alerta_envios.tipo`. */
export type TipoEnvio =
  | 'alerta'
  | 'lembrete'
  | 'resolvido'
  | 'normalizou'
  | 'teste'
  | 'resumo'
  /** Fim de EMB (0150): nasce sem ocorrência e sem botão, como o resumo. */
  | 'emb'

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
  return valor === 'telegram' || valor === 'discord' || valor === 'email'
}

/** É um tipo de janela conhecido? */
export function ehJanelaTipo(valor: unknown): valor is JanelaTipo {
  return valor === 'tempo' || valor === 'bipes' || valor === 'op' || valor === 'intervalos'
}

/** Vínculo do usuário logado num canal (o que a tela Meu perfil mostra). */
export interface ContaVinculada {
  canal: Canal
  vinculadoEm: string
}

/** Tipo da regra (specs 2026-09-18 e 2026-10-09). O tipo não muda depois de criado. */
export type TipoRegra = 'aprovacao' | 'tempo' | 'defeito' | 'resumo' | 'emb' | 'parado'
export const TIPOS_REGRA: readonly TipoRegra[] = ['aprovacao', 'tempo', 'defeito', 'resumo', 'emb', 'parado']

export const NOME_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Taxa de aprovação',
  tempo: 'Tempo médio por peça',
  defeito: 'Defeito repetido',
  resumo: 'Resumo diário',
  emb: 'Fim de EMB',
  parado: 'Parado no Almoxarifado',
}

/** A frase de cada cartão da escolha do tipo. */
export const DESCRICAO_TIPO_REGRA: Record<TipoRegra, string> = {
  aprovacao: 'Avisa quando a taxa de aprovação do posto cai abaixo da meta.',
  tempo: 'Avisa quando o tempo médio entre um bipe e o próximo passa do limite.',
  defeito: 'Avisa quando o mesmo defeito se repete várias vezes no posto em pouco tempo.',
  resumo: 'Manda, na hora escolhida, a taxa de aprovação do dia de cada posto.',
  // ⚠️ A segunda metade da frase não é enfeite: TODA EMB que fecha manda mensagem, inclusive a que
  // fecha limpa (decisão 5 da spec, revertida em 14/10/2026). Sem ela o cartão deixaria o gestor
  // achar que a regra só fala quando há problema.
  emb: 'Avisa quando todos os processos de uma EMB terminam, com as divergências de quantidade e as justificativas (ou dizendo que não houve nenhuma).',
  parado: 'Avisa quando caixas, lotes ou peças prontas ficam horas sem dar entrada no Almoxarifado.',
}

/** É um tipo de regra conhecido? */
export function ehTipoRegra(valor: unknown): valor is TipoRegra {
  return (
    valor === 'aprovacao' ||
    valor === 'tempo' ||
    valor === 'defeito' ||
    valor === 'resumo' ||
    valor === 'emb' ||
    valor === 'parado'
  )
}
