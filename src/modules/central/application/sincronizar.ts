import { montarFoto } from '../domain/foto'
import type { EnviadorFoto, LeitorFoto } from './portas'

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * O resultado distingue ONDE parou, pra rota converter no status HTTP certo:
 *   'leitura'  (banco do ShopFloor falhou)    -> 503, nada foi enviado.
 *   'montagem' (linha fora do contrato — bug do banco/migração) -> 500, nada foi enviado.
 *   'envio'    (Central inalcançável/timeout) -> 502, a Central pode nunca ter recebido nada.
 *   'central'  (a Central respondeu — 200, 409, 500...) -> a rota decide 200 ou 502 pelo `status`.
 */
export type ResultadoSincronizacao =
  | { etapa: 'leitura'; ok: false; erro: string }
  | { etapa: 'montagem'; ok: false; erro: string }
  | { etapa: 'envio'; ok: false; erro: string }
  | { etapa: 'central'; ok: true; status: number; corpo: unknown }

/**
 * Lê a foto do banco do ShopFloor (leitor) e manda pra Central (enviador). Nunca lança: qualquer
 * falha vira um resultado com a `etapa` onde parou — quem chama (a rota) decide o status HTTP.
 */
export async function sincronizar(
  leitor: LeitorFoto,
  enviador: EnviadorFoto,
  agora: () => Date = () => new Date(),
): Promise<ResultadoSincronizacao> {
  let recebimentos, ordens
  try {
    ;[recebimentos, ordens] = await Promise.all([leitor.lerRecebimentos(), leitor.lerOrdens()])
  } catch (e) {
    return { etapa: 'leitura', ok: false, erro: mensagemDe(e) }
  }

  let foto
  try {
    foto = montarFoto(recebimentos, ordens, agora())
  } catch (e) {
    return { etapa: 'montagem', ok: false, erro: mensagemDe(e) }
  }

  try {
    const resposta = await enviador.enviar(foto)
    return { etapa: 'central', ok: true, status: resposta.status, corpo: resposta.corpo }
  } catch (e) {
    return { etapa: 'envio', ok: false, erro: mensagemDe(e) }
  }
}
