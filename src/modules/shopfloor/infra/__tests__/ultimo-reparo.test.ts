import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERFIL_PADRAO, type PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'

vi.mock('server-only', () => ({}))
const linhas = vi.fn()
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                order: () => ({ limit: () => linhas() }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

const { buscarUltimoReparo } = await import('../lancamento-repository')

const MANUTENCAO: PerfilPosto = { ...PERFIL_PADRAO, chave: 'manutencao', recurso: 'manutencao' }
const perfilDe = (p: string) => (p === 'Manutenção' ? MANUTENCAO : PERFIL_PADRAO)

beforeEach(() => linhas.mockReset())

describe('buscarUltimoReparo', () => {
  it('último registro é reparo → devolve os consertos daquele evento', async () => {
    linhas.mockResolvedValue({
      data: [
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' },
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Troca', reparo_posicao: 'C5' },
        { posto: 'Teste', data_hora: '2026-10-06T09:00:00Z', reparo_conserto: '', reparo_posicao: '' },
      ],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
      { conserto: 'Troca', posicao: 'C5' },
    ])
  })

  it('último registro NÃO é reparo → nulo', async () => {
    linhas.mockResolvedValue({
      data: [
        { posto: 'Teste', data_hora: '2026-10-06T11:00:00Z', reparo_conserto: '', reparo_posicao: '' },
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' },
      ],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toBeNull()
  })

  it('não entram consertos de um evento ANTERIOR da Manutenção', async () => {
    // A peça já tinha ido pra Manutenção antes. Só o reparo mais recente é o que se confirma.
    linhas.mockResolvedValue({
      data: [
        { posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' },
        { posto: 'Manutenção', data_hora: '2026-10-01T08:00:00Z', reparo_conserto: 'Antigo', reparo_posicao: 'X1' },
      ],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
    ])
  })

  it('reparo sem conserto preenchido → nulo (não há o que confirmar)', async () => {
    linhas.mockResolvedValue({
      data: [{ posto: 'Manutenção', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: '  ', reparo_posicao: '' }],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toBeNull()
  })

  it('peça sem registro nenhum → nulo', async () => {
    linhas.mockResolvedValue({ data: [], error: null })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).toBeNull()
  })

  it('reconhece a Manutenção pelo PERFIL, não pelo nome do posto', async () => {
    // O posto foi renomeado; o perfil continua sendo o de Manutenção. Tem que continuar achando.
    const perfilRenomeado = (p: string) => (p === 'Reparo Central' ? MANUTENCAO : PERFIL_PADRAO)
    linhas.mockResolvedValue({
      data: [{ posto: 'Reparo Central', data_hora: '2026-10-06T10:00:00Z', reparo_conserto: 'Ressolda', reparo_posicao: 'R12' }],
      error: null,
    })
    expect(await buscarUltimoReparo('P1', '1', 'SN1', perfilRenomeado)).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
    ])
  })

  it('erro do banco sobe (quem trata é a camada de aplicação)', async () => {
    linhas.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(buscarUltimoReparo('P1', '1', 'SN1', perfilDe)).rejects.toBeTruthy()
  })
})
