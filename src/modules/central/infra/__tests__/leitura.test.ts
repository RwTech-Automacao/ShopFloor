import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Supabase de mentira: cada função da 0134 devolve UM jsonb com a lista inteira — uma chamada só,
// sem `.range()`/paginação (uma "foto" não pode ser lida em pedaços, em instantes diferentes).
let linhas: Record<string, unknown>[] = []
let chamadas = 0
let funcaoChamada: string | null = null

function rpc(funcao: string) {
  chamadas += 1
  funcaoChamada = funcao
  return Promise.resolve({ data: linhas, error: null })
}

vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => ({ rpc }) }))

const { criarLeitorServico } = await import('../leitura')

describe('criarLeitorServico', () => {
  beforeEach(() => {
    linhas = []
    chamadas = 0
    funcaoChamada = null
  })

  it('sem linhas: uma chamada só, devolve lista vazia', async () => {
    const leitor = criarLeitorServico({ rpc } as never)
    const r = await leitor.lerRecebimentos()
    expect(r).toEqual([])
    expect(chamadas).toBe(1)
  })

  it('2500 linhas: continua sendo UMA chamada só (o jsonb já vem com tudo)', async () => {
    linhas = Array.from({ length: 2500 }, (_, i) => ({ id: `x${i}` }))
    const leitor = criarLeitorServico({ rpc } as never)
    const r = await leitor.lerOrdens()
    expect(chamadas).toBe(1)
    expect(r).toHaveLength(2500)
    expect(r[0]).toEqual({ id: 'x0' })
    expect(r[2499]).toEqual({ id: 'x2499' })
  })

  it('lerRecebimentos chama a função certa da 0134, sem paginação', async () => {
    const leitor = criarLeitorServico({ rpc } as never)
    await leitor.lerRecebimentos()
    expect(funcaoChamada).toBe('central_recebimentos_para_sincronizar')
    expect(chamadas).toBe(1)
  })

  it('lerOrdens chama a função certa da 0134, sem paginação', async () => {
    const leitor = criarLeitorServico({ rpc } as never)
    await leitor.lerOrdens()
    expect(funcaoChamada).toBe('central_ordens_para_sincronizar')
    expect(chamadas).toBe(1)
  })

  it('erro do Postgres lança (a leitura inteira falha, nada é montado)', async () => {
    const rpcComErro = () => Promise.resolve({ data: null, error: { message: 'connection refused' } })
    const leitor = criarLeitorServico({ rpc: rpcComErro } as never)
    await expect(leitor.lerRecebimentos()).rejects.toThrow(/connection refused/)
  })

  it('dados null sem erro do Postgres lança (resposta não é array)', async () => {
    const rpcComNull = () => Promise.resolve({ data: null, error: null })
    const leitor = criarLeitorServico({ rpc: rpcComNull } as never)
    await expect(leitor.lerRecebimentos()).rejects.toThrow(/não é um array/)
  })

  it('dados object sem erro do Postgres lança (resposta não é array)', async () => {
    const rpcComObject = () => Promise.resolve({ data: {}, error: null })
    const leitor = criarLeitorServico({ rpc: rpcComObject } as never)
    await expect(leitor.lerOrdens()).rejects.toThrow(/não é um array/)
  })
})
