import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { OrdemResumo } from '@/modules/sat/infra/ordens-repository'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => <p>sem permissão</p> }))
const repo = vi.hoisted(() => ({ listarOrdens: vi.fn(async (): Promise<OrdemResumo[]> => []) }))
vi.mock('@/modules/sat/infra/ordens-repository', () => repo)

function sessao(sat: Record<string, boolean>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', email: 'x@x', perfil: { porModulo: { sat }, permissoes: {} } }),
  }))
}

const os = (id: string, etapa: OrdemResumo['etapa'], extra: Partial<OrdemResumo> = {}): OrdemResumo => ({
  id, numero: `0${id}/26`, etapa, etapaDesde: '2026-11-26T10:00:00Z', tempoNaEtapa: '5 h', tipo: 'em_garantia',
  cliente: 'Cliente Fictício', nsAtual: `562-${id}`, produto: 'PMOC31', ticketNumero: '', tecnicoNome: '',
  criadoEm: '2026-11-26T10:00:00Z', ...extra,
})

async function abrir(sp: Record<string, string> = {}) {
  const { default: Pagina } = await import('../page')
  render(await Pagina({ searchParams: Promise.resolve(sp) }))
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('/sat/ordens', () => {
  it('sem sat.visualizar: sem permissão, sem leitura', async () => {
    sessao({ manutencao: true })
    await abrir()
    expect(screen.getByText('sem permissão')).toBeInTheDocument()
    expect(repo.listarOrdens).not.toHaveBeenCalled()
  })

  it('quadro com as 4 colunas, contagem e cartões com link para a ficha', async () => {
    sessao({ visualizar: true })
    repo.listarOrdens.mockResolvedValueOnce([os('397', 'disponivel'), os('398', 'em_manutencao', { tipo: null }), os('399', 'disponivel')])
    await abrir()
    const disponivel = screen.getByRole('region', { name: 'Disponível para manutenção' })
    expect(within(disponivel).getByText('2')).toBeInTheDocument()
    expect(within(disponivel).getByRole('link', { name: /0397\/26/ })).toHaveAttribute('href', '/sat/ordens/397')
    const manut = screen.getByRole('region', { name: 'Em manutenção' })
    expect(within(manut).getByText('Garantia a definir')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Qualidade' })).getByText('Nenhuma OS.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recebido' })).toBeNull()
  })

  it('filtros vão para o repositório; tipo desconhecido é ignorado; busca por NS diz onde está', async () => {
    sessao({ visualizar: true })
    repo.listarOrdens.mockResolvedValueOnce([os('398', 'em_manutencao')])
    await abrir({ tipo: 'qualquer', cliente: 'Cli', ns: '562-398', de: '2026-11-01', ate: '2026-11-30' })
    expect(repo.listarOrdens).toHaveBeenCalledWith({ tipo: '', cliente: 'Cli', ns: '562-398', de: '2026-11-01', ate: '2026-11-30' })
    expect(screen.getByText('Número de série encontrado em: Em manutenção (1)')).toBeInTheDocument()
  })

  it('busca por NS sem resultado avisa', async () => {
    sessao({ visualizar: true })
    await abrir({ ns: '999-1', tipo: 'a_definir' })
    expect(repo.listarOrdens).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'a_definir', ns: '999-1' }))
    expect(screen.getByText('Nenhuma OS com esse número de série.')).toBeInTheDocument()
  })
})
