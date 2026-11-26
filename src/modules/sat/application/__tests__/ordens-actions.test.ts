import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const erros = vi.hoisted(() => ({ ErroDoBanco: class ErroDoBanco extends Error {} }))
vi.mock('../../infra/repository', () => erros)
const repo = vi.hoisted(() => ({
  iniciarManutencao: vi.fn(async () => {}), adicionarDefeito: vi.fn(async () => {}), removerDefeito: vi.fn(async () => {}),
  adicionarPeca: vi.fn(async () => {}), removerPeca: vi.fn(async () => {}), salvarLaudo: vi.fn(async () => {}),
  trocarNs: vi.fn(async () => {}), enviarQualidade: vi.fn(async () => {}), corrigirEtapa: vi.fn(async () => {}),
  produtoDaOrdem: vi.fn(async (): Promise<string | null> => 'PMOC31'),
  pecasMaisUsadas: vi.fn(async () => []), kitsConhecidos: vi.fn(async () => []),
}))
vi.mock('../../infra/ordens-repository', () => repo)
const compels = vi.hoisted(() => ({
  estrutura: vi.fn(async () => null), paisDoItem: vi.fn(async () => []),
  buscarItens: vi.fn(async () => [{ codigo: 'PRT706', descricao: 'PLACA' }]),
}))
const CompelsIndisponivel = vi.hoisted(() => class CompelsIndisponivel extends Error {})
vi.mock('../../infra/estrutura-compels', () => ({ leiturasDoCompels: () => compels, CompelsIndisponivel }))

function sessao(sat: Record<string, boolean>) {
  vi.doMock('@/modules/auth/application/get-sessao', () => ({
    getSessao: async () => ({ usuarioId: 'u1', nome: 'S', email: 's@x', perfil: { porModulo: { sat }, permissoes: {} } }),
  }))
}

const OS = '00000000-0000-0000-0000-0000000000a1'
const DEF = '00000000-0000-0000-0000-0000000000d1'
const SEM_PERMISSAO = { ok: false, erro: 'Você não tem permissão para esta ação.' }
const OK = { ok: true, valor: null }

afterEach(() => {
  vi.doUnmock('@/modules/auth/application/get-sessao')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('actions da OS — permissão', () => {
  it('sem sat.manutencao: nada grava', async () => {
    sessao({ visualizar: true, administrar: true, aprovar_nf: true })
    const a = await import('../ordens-actions')
    expect(await a.iniciarManutencaoAction(OS)).toEqual(SEM_PERMISSAO)
    expect(await a.adicionarPecaAction(OS, { codigo: 'X1', descricao: '', quantidade: '1' })).toEqual(SEM_PERMISSAO)
    expect(await a.pecasSugeridasAction(OS)).toEqual(SEM_PERMISSAO)
    expect(await a.buscarItensAction('fonte')).toEqual(SEM_PERMISSAO)
    expect(repo.iniciarManutencao).not.toHaveBeenCalled()
    expect(repo.adicionarPeca).not.toHaveBeenCalled()
  })
  it('manutenção sem visualizar: nada grava', async () => {
    sessao({ manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.enviarQualidadeAction(OS)).toEqual(SEM_PERMISSAO)
  })
  it('corrigir etapa só com sat.administrar', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.corrigirEtapaAction(OS, 'em_manutencao', 'motivo ok')).toEqual(SEM_PERMISSAO)
    expect(repo.corrigirEtapa).not.toHaveBeenCalled()
  })
})

describe('actions da OS — manutenção', () => {
  it('ids inválidos são recusados antes do banco', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.iniciarManutencaoAction('x')).toEqual({ ok: false, erro: 'Pedido inválido.' })
    expect(await a.removerPecaAction(OS, 'x')).toEqual({ ok: false, erro: 'Pedido inválido.' })
    expect(repo.iniciarManutencao).not.toHaveBeenCalled()
  })
  it('defeito, peça, laudo e NS chegam limpos ao repositório', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.adicionarDefeitoAction(OS, DEF, '  trocada a fonte ')).toEqual(OK)
    expect(repo.adicionarDefeito).toHaveBeenCalledWith(OS, DEF, 'trocada a fonte')
    expect(await a.adicionarPecaAction(OS, { codigo: ' pmoe74 ', descricao: ' Kit ', quantidade: '2' })).toEqual(OK)
    expect(repo.adicionarPeca).toHaveBeenCalledWith(OS, { codigo: 'PMOE74', descricao: 'Kit', quantidade: 2 })
    expect(await a.salvarLaudoAction(OS, ' laudo ')).toEqual(OK)
    expect(repo.salvarLaudo).toHaveBeenCalledWith(OS, 'laudo')
    expect(await a.trocarNsAction(OS, '562-19178')).toEqual(OK)
    expect(repo.trocarNs).toHaveBeenCalledWith(OS, { escrito: '562-19178', modelo: '562', sequencia: '19178' })
  })
  it('validação do domínio volta como mensagem, sem chamar o banco', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.adicionarPecaAction(OS, { codigo: 'X 1', descricao: '', quantidade: '1' })).toEqual({ ok: false, erro: 'Código do item inválido.' })
    expect(await a.trocarNsAction(OS, ' ')).toEqual({ ok: false, erro: 'Informe o número de série novo.' })
    expect(repo.adicionarPeca).not.toHaveBeenCalled()
    expect(repo.trocarNs).not.toHaveBeenCalled()
  })
  it('erro do banco vira a mensagem da tela', async () => {
    sessao({ visualizar: true, manutencao: true })
    repo.enviarQualidade.mockRejectedValueOnce(new erros.ErroDoBanco('SEM_LAUDO'))
    const a = await import('../ordens-actions')
    expect(await a.enviarQualidadeAction(OS)).toEqual({ ok: false, erro: 'Escreva o laudo antes de enviar para a qualidade.' })
  })
  it('corrigir etapa com sat.administrar: etapa e motivo validados', async () => {
    sessao({ visualizar: true, administrar: true })
    const a = await import('../ordens-actions')
    expect(await a.corrigirEtapaAction(OS, 'expedicao', 'motivo ok')).toEqual({ ok: false, erro: 'Etapa inválida.' })
    expect(await a.corrigirEtapaAction(OS, 'disponivel', '  voltou  ')).toEqual(OK)
    expect(repo.corrigirEtapa).toHaveBeenCalledWith(OS, 'disponivel', 'voltou')
  })
})

describe('actions da OS — lista de peças', () => {
  it('camadas pelo produto da OS', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    const r = await a.pecasSugeridasAction(OS)
    expect(r).toEqual({ ok: true, valor: { maisUsadas: [], kits: [], estrutura: [], avisos: ['O produto PMOC31 não tem estrutura no Compels.'] } })
    expect(repo.produtoDaOrdem).toHaveBeenCalledWith(OS)
  })
  it('OS que não existe: erro', async () => {
    sessao({ visualizar: true, manutencao: true })
    repo.produtoDaOrdem.mockResolvedValueOnce(null)
    const a = await import('../ordens-actions')
    expect(await a.pecasSugeridasAction(OS)).toEqual({ ok: false, erro: 'Ordem de serviço não encontrada. Recarregue a página.' })
  })
  it('busca: de 2 a 60 caracteres; Compels indisponível vira mensagem', async () => {
    sessao({ visualizar: true, manutencao: true })
    const a = await import('../ordens-actions')
    expect(await a.buscarItensAction('f')).toEqual({ ok: false, erro: 'Digite ao menos 2 letras para buscar.' })
    expect(await a.buscarItensAction('fonte')).toEqual({ ok: true, valor: [{ codigo: 'PRT706', descricao: 'PLACA' }] })
    compels.buscarItens.mockRejectedValueOnce(new CompelsIndisponivel())
    expect(await a.buscarItensAction('fonte')).toEqual({ ok: false, erro: 'O Compels não está disponível neste ambiente.' })
  })
})
