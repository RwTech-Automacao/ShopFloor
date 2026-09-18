import type { Canal, ResultadoEnvio, ResultadoSimples } from '../domain/tipos'
import type { ContaDestino, ResultadoAvaliacaoRpc } from '../domain/avaliacao'
import type { EnvioReservado } from '../domain/envio'

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

/**
 * Envio que NÃO passa pela fila e já nasce final: só o "Enviar teste" do Meu perfil (a pessoa
 * precisa do resultado na hora, e teste que falhou não é reenviado).
 */
export interface NovoEnvioDireto {
  usuarioId: string
  canal: Canal
  tipo: 'teste'
  texto: string
  dados: Record<string, unknown>
  resultado: ResultadoEnvio
}

export interface FiltroReserva {
  /** Só os canais que este ambiente consegue entregar (os outros ficam pendentes). */
  canais: Canal[]
  limite: number
  /** Restringe a uma ocorrência (webhook do "Resolvido"); null = a fila inteira. */
  ocorrenciaId: string | null
}

export interface MensagemComBotao {
  envioId: string
  canal: Canal
  mensagemExternaId: string
}

export interface RepositorioEnvios {
  /** `alerta_avaliar()`: decide e enfileira no banco, numa transação só. */
  avaliar(): Promise<ResultadoAvaliacaoRpc>
  /** `alerta_reservar_envios()`: pega um lote da fila de forma atômica (novas antes de reenvios). */
  reservarPendentes(filtro: FiltroReserva): Promise<EnvioReservado[]>
  /**
   * Grava o resultado NA PRÓPRIA LINHA reservada (ok/erro/mensagem_externa_id/texto/enviado_em) e
   * solta a reserva. Lança em erro de banco — quem chama trata por item.
   */
  concluirEnvio(envio: EnvioReservado, texto: string, resultado: ResultadoEnvio): Promise<void>
  /** Grava um envio direto (teste). Não lança: a mensagem já saiu, o que falhou foi a auditoria. */
  registrarEnvioDireto(e: NovoEnvioDireto): Promise<void>
  mensagensComBotao(ocorrenciaId: string): Promise<MensagemComBotao[]>
  marcarSemBotao(envioIds: string[]): Promise<void>
  contaDoUsuario(usuarioId: string, canal: Canal): Promise<ContaDestino | null>
}
