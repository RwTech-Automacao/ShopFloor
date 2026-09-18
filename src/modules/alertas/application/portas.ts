import type { Canal, ResultadoEnvio, ResultadoSimples, TipoEnvio } from '../domain/tipos'
import type { ContaDestino, ResultadoAvaliacaoRpc } from '../domain/avaliacao'

/**
 * Tudo que o serviço precisa de um canal. Quem implementa é `infra/canais.ts` (Telegram/Discord);
 * nos testes entra uma porta de mentira — por isso aqui não há nem `fetch`, nem token.
 */
export interface PortaCanal {
  enviar(externoId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>
  removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>
}

/** Canal ausente = sem token configurado neste ambiente. */
export type PortasCanais = Partial<Record<Canal, PortaCanal>>

export interface NovoEnvio {
  ocorrenciaId: string | null
  usuarioId: string
  canal: Canal
  tipo: TipoEnvio
  texto: string
  comBotao: boolean
  resultado: ResultadoEnvio
}

/** Envio que falhou e ainda vale tentar de novo (texto guardado no banco). */
export interface EnvioPendente {
  id: string
  ocorrenciaId: string | null
  canal: Canal
  externoId: string
  texto: string
  comBotao: boolean
  tentativas: number
}

export interface MensagemComBotao {
  envioId: string
  canal: Canal
  mensagemExternaId: string
}

export interface RepositorioEnvios {
  avaliar(): Promise<ResultadoAvaliacaoRpc>
  registrarEnvio(e: NovoEnvio): Promise<void>
  envioParaReenviar(): Promise<EnvioPendente[]>
  registrarReenvio(envio: EnvioPendente, resultado: ResultadoEnvio): Promise<void>
  mensagensComBotao(ocorrenciaId: string): Promise<MensagemComBotao[]>
  marcarSemBotao(envioIds: string[]): Promise<void>
  /** Destinatários x canais da regra da ocorrência que TÊM vínculo. */
  contasDaOcorrencia(ocorrenciaId: string): Promise<ContaDestino[]>
  contaDoUsuario(usuarioId: string, canal: Canal): Promise<ContaDestino | null>
}
