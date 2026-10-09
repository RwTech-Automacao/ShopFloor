import type { ResumoFinalizacao } from '../domain/finalizacao'

/**
 * Teto de tempo da rotina. O cron chama com `curl -m 60` e os alertas já podem ter gasto até 40 s
 * entregando a fila: a finalização não pode ser o que estoura a chamada.
 */
export const LIMITE_FINALIZACAO_MS = 15_000

export type ResultadoFinalizacao = ({ ok: true } & ResumoFinalizacao) | { ok: false; erro: string }

export interface OpcoesFinalizacao {
  limiteMs?: number
  log?: (mensagem: string) => void
  logErro?: (mensagem: string) => void
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Roda a finalização automática CONTENDO qualquer falha: esta função NUNCA lança.
 *
 * Existe para que um defeito na finalização (banco fora, função ausente, resposta estranha, demora)
 * não consiga calar os alertas, que são críticos. Pode atrasar o encerramento de uma OP; não pode
 * mudar a resposta do cron. Cobre erro síncrono, rejeição, valor que não é Error, teto de tempo e
 * até o `log` que lança.
 */
export async function rodarFinalizacaoContida(
  sincronizar: () => Promise<ResumoFinalizacao>,
  opcoes: OpcoesFinalizacao = {},
): Promise<ResultadoFinalizacao> {
  const limiteMs = opcoes.limiteMs ?? LIMITE_FINALIZACAO_MS
  const log = opcoes.log ?? ((m: string) => console.info(m))
  const logErro = opcoes.logErro ?? ((m: string) => console.error(m))
  const seguro = (f: (m: string) => void, m: string) => {
    try { f(m) } catch { /* o log não pode derrubar o cron */ }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const teto = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(() => rejeitar(new Error(`passou do tempo (${limiteMs} ms)`)), limiteMs)
    })
    // Promise.resolve().then(...) captura inclusive o erro SÍNCRONO de `sincronizar`.
    const resumo = await Promise.race([Promise.resolve().then(sincronizar), teto])
    if (resumo.finalizadas > 0 || resumo.reabertas > 0) {
      seguro(log, `[finalizacao] ${resumo.finalizadas} finalizada(s), ${resumo.reabertas} reaberta(s)`)
    }
    return { ok: true, ...resumo }
  } catch (e) {
    const erro = mensagemDe(e)
    seguro(logErro, `[finalizacao] falhou (os alertas não foram afetados): ${erro}`)
    return { ok: false, erro }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
