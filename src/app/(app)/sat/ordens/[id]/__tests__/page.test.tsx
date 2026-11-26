import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OrdemDetalhe } from '@/modules/sat/infra/ordens-repository'

vi.mock('server-only', () => ({}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => <p>sem permissão</p> }))
const props = vi.hoisted(() => ({ manutencao: null as unknown, corrigir: null as unknown }))
vi.mock('../manutencao', () => ({ Manutencao: (p: unknown) => { props.manutencao = p; return null } }))
vi.mock('../corrigir-etapa', () => ({ CorrigirEtapa: (p: unknown) => { props.corrigir = p; return <p>corrigir</p> } }))
const repo = vi.hoisted(() => ({
  lerOrdem: vi.fn(async (): Promise<OrdemDetalhe | null> => null),
  listarDefeitosAtivos: vi.fn(async () => [{ id: 'd1', descricao: 'Não liga', codigoCompels: '1' }]),
}))
vi.mock('@/modules/sat/infra/ordens-repository', () => repo)

function sessao(sat: Record<string, boolean>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', email: 'x@x', perfil: { porModulo: { sat }, permissoes: {} } }),
  }))
}

const ID = '00000000-0000-0000-0000-0000000000a1'
const ORDEM: OrdemDetalhe = {
  id: ID, numero: '0397/26', etapa: 'em_manutencao', etapaDesde: '2026-11-26T10:00:00Z', tempoNaEtapa: '5 h',
  tipo: 'em_garantia', cliente: 'Cliente Fictício', nsAtual: '562-99', produto: 'PMOC31', ticketNumero: '900',
  tecnicoNome: 'Rita', criadoEm: '2026-11-25T10:00:00Z', entradaId: '00000000-0000-0000-0000-0000000000e1',
  garantia: 'GARANTIA', cnpj: '12.345.678/0001-90', laudo: 'ok', nf: { numero: '4521', situacao: 'aprovada' },
  defeitos: [], pecas: [],
  trocasNs: [{ id: 't1', nsAntigo: '562-1', nsNovo: '562-99', usuarioNome: 'Rita', em: '2026-11-26T11:00:00Z' }],
  historico: [{ evento: 'ns', etapaDe: null, etapaPara: null, dados: { ns_antigo: '562-1', ns_novo: '562-99' }, usuarioNome: 'Rita', em: '2026-11-26T11:00:00Z' }],
}

async function abrir(id = ID) {
  const { default: Pagina } = await import('../page')
  render(await Pagina({ params: Promise.resolve({ id }) }))
}

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
  props.manutencao = null
  props.corrigir = null
})

describe('/sat/ordens/[id]', () => {
  it('sem sat.visualizar: sem permissão', async () => {
    sessao({ manutencao: true })
    await abrir()
    expect(screen.getByText('sem permissão')).toBeInTheDocument()
    expect(repo.lerOrdem).not.toHaveBeenCalled()
  })
  it('id inválido ou OS inexistente: 404', async () => {
    sessao({ visualizar: true })
    await expect(abrir('x')).rejects.toThrow('NOT_FOUND')
    await expect(abrir()).rejects.toThrow('NOT_FOUND')
  })
  it('cabeçalho, trocas de NS, linha do tempo e link para o relógio', async () => {
    sessao({ visualizar: true })
    repo.lerOrdem.mockResolvedValueOnce(ORDEM)
    await abrir()
    expect(screen.getByRole('heading', { name: 'OS 0397/26' })).toBeInTheDocument()
    expect(screen.getByText('NF 4521 (aprovada)')).toBeInTheDocument()
    expect(screen.getAllByText('562-1 → 562-99').length).toBeGreaterThan(0)
    expect(screen.getByText('NS trocado: 562-1 → 562-99')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver o relógio recebido' })).toHaveAttribute('href', '/sat/equipamentos/00000000-0000-0000-0000-0000000000e1')
    expect(props.manutencao).toMatchObject({ ordemId: ID, etapa: 'em_manutencao', podeManutencao: false, defeitosAtivos: [] })
    expect(props.corrigir).toBeNull()
    expect(repo.listarDefeitosAtivos).not.toHaveBeenCalled()
  })
  it('com manutenção em OS em manutenção: lista de defeitos; com administrar: correção de etapa', async () => {
    sessao({ visualizar: true, manutencao: true, administrar: true })
    repo.lerOrdem.mockResolvedValueOnce(ORDEM)
    await abrir()
    expect(props.manutencao).toMatchObject({ podeManutencao: true, defeitosAtivos: [{ id: 'd1', descricao: 'Não liga', codigoCompels: '1' }] })
    expect(props.corrigir).toEqual({ ordemId: ID, etapaAtual: 'em_manutencao' })
  })
})
