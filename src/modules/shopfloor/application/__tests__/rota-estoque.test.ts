// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { entregarEstoquePendente, criarRepositorioEstoqueEnvios, repoFalso } = vi.hoisted(() => {
  const repoFalso = { reservarPendentes: vi.fn(), concluirEnvio: vi.fn() }
  return {
    repoFalso,
    criarRepositorioEstoqueEnvios: vi.fn(() => repoFalso),
    entregarEstoquePendente: vi.fn(async () => ({ enviados: 4, falhas: 1 })),
  }
})
vi.mock('@/modules/shopfloor/application/enviar-estoque', () => ({ entregarEstoquePendente }))
vi.mock('@/modules/shopfloor/infra/estoque-envios-repository', () => ({ criarRepositorioEstoqueEnvios }))

// O último metro e a comparação em tempo constante entram DE VERDADE: é o que o teste tem para
// afirmar que a rota liga o laço no envio real ao Compels (sem modo seco) e que o segredo é
// comparado pela função que já existe.
import { enviarMovimentacaoCompels } from '@/modules/shopfloor/infra/compels'
import { POST } from '@/app/api/shopfloor/estoque/route'

const SEGREDO = 'segredo-de-mentira-do-cron'

function pedido(cabecalhos: Record<string, string> = {}) {
  return new Request('https://shopfloor.enterplak.com.br/api/shopfloor/estoque', {
    method: 'POST',
    headers: cabecalhos,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  entregarEstoquePendente.mockResolvedValue({ enviados: 4, falhas: 1 })
  vi.stubEnv('ESTOQUE_CRON_SECRET', SEGREDO)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('POST /api/shopfloor/estoque', () => {
  it('sem segredo configurado no ambiente devolve 503 e não toca na fila', async () => {
    vi.stubEnv('ESTOQUE_CRON_SECRET', '')
    const res = await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ erro: 'Envio de estoque não configurado neste ambiente.' })
    expect(entregarEstoquePendente).not.toHaveBeenCalled()
    expect(criarRepositorioEstoqueEnvios).not.toHaveBeenCalled()
  })

  it('sem cabeçalho de autorização devolve 401 e não toca na fila', async () => {
    const res = await POST(pedido())
    expect(res.status).toBe(401)
    expect(entregarEstoquePendente).not.toHaveBeenCalled()
  })

  it('segredo errado devolve 401', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro-qualquer' }))
    expect(res.status).toBe(401)
    expect(entregarEstoquePendente).not.toHaveBeenCalled()
  })

  it('segredo certo sem o prefixo Bearer devolve 401', async () => {
    const res = await POST(pedido({ authorization: SEGREDO }))
    expect(res.status).toBe(401)
    expect(entregarEstoquePendente).not.toHaveBeenCalled()
  })

  /**
   * DENTES DA COMPARAÇÃO EM TEMPO CONSTANTE: um prefixo do segredo (mais curto) e o segredo com
   * sobra (mais longo) têm que dar 401 como qualquer outro palpite errado. É o que pega dois erros
   * reais — um `startsWith` no lugar da comparação, e a comparação SEM o teste de tamanho (o
   * `timingSafeEqual` do Node ESTOURA com buffers de tamanhos diferentes, e aí a resposta viraria
   * 500, que conta para quem está adivinhando como "esse tinha o tamanho certo").
   */
  it('segredo de tamanho diferente devolve 401, e não 500', async () => {
    for (const palpite of [SEGREDO.slice(0, 5), `${SEGREDO}-sobra`]) {
      const res = await POST(pedido({ authorization: `Bearer ${palpite}` }))
      expect(res.status).toBe(401)
    }
    expect(entregarEstoquePendente).not.toHaveBeenCalled()
  })

  it('401 não devolve o segredo esperado', async () => {
    const res = await POST(pedido({ authorization: 'Bearer outro-qualquer' }))
    expect(JSON.stringify(await res.json())).not.toContain(SEGREDO)
  })

  it('segredo certo entrega a fila pelo envio REAL ao Compels e devolve o resumo', async () => {
    const res = await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enviados: 4, falhas: 1 })
    expect(entregarEstoquePendente).toHaveBeenCalledTimes(1)
    // A porta é a função de verdade (hoje um não-implementado honesto): nenhum modo seco no meio.
    expect(entregarEstoquePendente).toHaveBeenCalledWith(enviarMovimentacaoCompels, repoFalso)
  })

  it('rodada com falha registra as contagens no log de erro, junto dos motivos do laço', async () => {
    await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    const linha = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n')
    expect(linha).toContain('4 enviado(s), 1 falha(s)')
    // A cauda promete o motivo acima — e a promessa é verdade porque o laço loga a falha DEVOLVIDA
    // pelo último metro, não só a lançada (ver enviar-estoque.ts e o teste dele).
    expect(linha).toContain('cada falha escreveu o motivo dela acima')
  })

  it('rodada limpa não suja o log de erro', async () => {
    entregarEstoquePendente.mockResolvedValueOnce({ enviados: 2, falhas: 0 })
    await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    expect(console.error).not.toHaveBeenCalled()
    expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain('2 enviado(s), 0 falha(s)')
  })

  it('banco indisponível devolve 503 em vez de estourar, e o log diz que isso é esperado', async () => {
    entregarEstoquePendente.mockRejectedValueOnce(new Error('connection refused'))
    const res = await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ erro: 'Banco indisponível.' })
    // O RDS é desligado fora do horário pelo plano de economia: quem lê o log às 7h precisa ver
    // isso escrito, senão trata a rodada de 503 como incidente.
    const linha = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n')
    expect(linha).toContain('ESPERADO fora do horário')
  })

  /**
   * OS DOIS RAMOS DO RÓTULO. A rota não sabe por que o banco não respondeu — só tem o texto do erro —
   * e o log é o único olho que alguém tem nas rodadas. Uma linha que AFIRMA "esperado, não é alarme"
   * em cima de um bug de refatoração é pior que nenhuma linha: ela manda não investigar.
   */
  it('falha que NÃO parece de conexão é marcada INESPERADO (e o 503 fica)', async () => {
    entregarEstoquePendente.mockRejectedValueOnce(
      new TypeError('repo.reservarPendentes is not a function'),
    )
    const res = await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    // o 503 continua: 500 às 3h da manhã acordaria alguém para uma rodada perdida
    expect(res.status).toBe(503)
    const linha = vi.mocked(console.error).mock.calls.map((c) => c.map(String).join(' ')).join('\n')
    expect(linha).toContain('INESPERADO')
    // e NÃO pode sair a linha da noite normal: é ela que diz para não investigar
    expect(linha).not.toContain('ESPERADO fora do horário')
    expect(linha).toContain('repo.reservarPendentes is not a function')
  })

  it('falha que parece de conexão (inclusive pelo `cause`) segue como esperada, sem INESPERADO', async () => {
    const naRede = [
      new TypeError('fetch failed'),
      // o código de verdade mora no `cause` quando o fetch do supabase-js embala a falha de rede
      Object.assign(new Error('falha ao falar com o banco'), {
        cause: new Error('connect ECONNREFUSED 10.0.0.9:5432'),
      }),
    ]
    for (const erro of naRede) {
      vi.mocked(console.error).mockClear()
      entregarEstoquePendente.mockRejectedValueOnce(erro)
      const res = await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
      expect(res.status).toBe(503)
      const linha = vi.mocked(console.error).mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(linha).toContain('ESPERADO fora do horário')
      // o filtro do log só serve se a noite normal NÃO cair nele
      expect(linha).not.toContain('INESPERADO')
    }
  })

  it('falha ao montar o repositório (env do banco ausente) também vira 503', async () => {
    criarRepositorioEstoqueEnvios.mockImplementationOnce(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente')
    })
    const res = await POST(pedido({ authorization: `Bearer ${SEGREDO}` }))
    expect(res.status).toBe(503)
    expect(entregarEstoquePendente).not.toHaveBeenCalled()
  })
})
