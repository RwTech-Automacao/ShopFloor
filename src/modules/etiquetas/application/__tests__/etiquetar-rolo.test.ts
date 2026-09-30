import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoloEtiquetado } from '../../domain/partnumber-legado'

/**
 * Etiquetagem de UM rolo, no inventário rotativo. O banco é falso aqui de propósito: o que estes
 * casos guardam é a regra que tem de valer ANTES de o banco ser chamado — código ilegível para o
 * Setup e pedido ilegível não podem virar etiqueta colada num rolo.
 */

const {
  emitirMock, listarMock, marcarMock, removerMock, impressasMock, porIdsMock, relerMock,
} = vi.hoisted(() => ({
  emitirMock: vi.fn(),
  relerMock: vi.fn(),
  listarMock: vi.fn(),
  marcarMock: vi.fn(),
  removerMock: vi.fn(),
  impressasMock: vi.fn(),
  porIdsMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('../../infra/etiqueta-legado-repository', () => ({
  emitirEtiquetasLegado: emitirMock,
  listarPendentesLegado: listarMock,
  marcarImpressasLegado: marcarMock,
  removerPendenteLegado: removerMock,
  listarImpressasLegado: impressasMock,
  listarImpressasPorIdsLegado: porIdsMock,
  buscarPendentePorCodigoLegado: relerMock,
}))

import {
  baixarDeNovoAction,
  etiquetarRoloAction,
  gerarCsvPendentesAction,
  listarPendentesAction,
  removerPendenteAction,
} from '../etiquetar-rolo'

function rolo(sobrescrever: Partial<RoloEtiquetado> = {}): RoloEtiquetado {
  return {
    id: 'a',
    item: 'CAPA78',
    pedido: '123425',
    sequencial: 4,
    codigo: 'CAPA78-123425L0004',
    usuarioNome: 'Ana',
    criadoEm: '2026-09-30T10:00:00Z',
    impressaEm: null,
    ...sobrescrever,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  emitirMock.mockResolvedValue([
    { ordem: 1, item: 'CAPA78', sequencial: 4, codigo: 'CAPA78-123425L0004', locacao: '', pedido: '123425' },
  ])
  listarMock.mockResolvedValue({ linhas: [], cortada: false })
  marcarMock.mockImplementation(async (ids: string[]) => ids.length)
  removerMock.mockResolvedValue(undefined)
  impressasMock.mockResolvedValue([])
  porIdsMock.mockResolvedValue([])
  relerMock.mockResolvedValue(null)
})

describe('etiquetarRoloAction', () => {
  it('código vazio é recusado antes de chamar o banco', async () => {
    const r = await etiquetarRoloAction('', '')
    expect(r).toEqual({ ok: false, erro: 'Digite o código do componente.' })
    expect(emitirMock).not.toHaveBeenCalled()
  })

  it('código com separador é recusado com o motivo do Setup', async () => {
    const r = await etiquetarRoloAction('CAPA-78', '')
    expect(r.ok).toBe(false)
    expect((r as { erro: string }).erro).toContain('separador')
    expect(emitirMock).not.toHaveBeenCalled()
  })

  it('pedido sem dígito é recusado, e o banco não é chamado', async () => {
    const r = await etiquetarRoloAction('CAPA78', 'abc')
    expect(r.ok).toBe(false)
    expect((r as { erro: string }).erro).toContain('Não consegui ler o pedido')
    expect(emitirMock).not.toHaveBeenCalled()
  })

  it('o pedido chega ao banco JÁ normalizado', async () => {
    await etiquetarRoloAction('CAPA78', '1234/25')
    expect(emitirMock).toHaveBeenCalledWith([{ item: 'CAPA78', pedido: '123425' }])
  })

  it('sem pedido, manda string vazia — nunca 0000', async () => {
    await etiquetarRoloAction('CAPA78', '   ')
    expect(emitirMock).toHaveBeenCalledWith([{ item: 'CAPA78', pedido: '' }])
  })

  it('devolve a linha que o banco emitiu, com o código autoritativo', async () => {
    const r = await etiquetarRoloAction(' capa78 ', '1234/25')
    expect(r.ok).toBe(true)
    expect((r as { linha: { codigo: string } }).linha.codigo).toBe('CAPA78-123425L0004')
  })

  it('devolve o id da linha relida — é ele que a tela usa para remover', async () => {
    relerMock.mockResolvedValue(rolo())
    const r = await etiquetarRoloAction('CAPA78', '1234/25')
    expect((r as { linha: RoloEtiquetado }).linha.id).toBe('a')
  })

  it('se a releitura falhar, o rolo NÃO é recusado: a etiqueta já existe no banco', async () => {
    relerMock.mockRejectedValue(new Error('falha de rede'))
    const r = await etiquetarRoloAction('CAPA78', '1234/25')
    expect(r.ok).toBe(true)
    expect((r as { linha: RoloEtiquetado }).linha.codigo).toBe('CAPA78-123425L0004')
  })

  it('sem permissão no banco vira frase, não exceção', async () => {
    emitirMock.mockRejectedValue(new Error('SEM_PERMISSAO'))
    const r = await etiquetarRoloAction('CAPA78', '')
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para gerar etiquetas.' })
  })
})

describe('gerarCsvPendentesAction', () => {
  it('sem pendentes, não gera arquivo nem marca nada', async () => {
    listarMock.mockResolvedValue({ linhas: [], cortada: false })
    const r = await gerarCsvPendentesAction()
    expect(r.ok).toBe(false)
    expect(marcarMock).not.toHaveBeenCalled()
  })

  it('gera o CSV e marca como impressas as MESMAS linhas que entraram no arquivo', async () => {
    listarMock.mockResolvedValue({ linhas: [rolo()], cortada: false })
    const r = await gerarCsvPendentesAction()
    expect(r.ok).toBe(true)
    expect((r as { csv: string }).csv).toContain('CAPA78-123425L0004')
    expect(marcarMock).toHaveBeenCalledWith(['a'])
  })

  it('avisa quando outra pessoa baixou parte da leva ao mesmo tempo', async () => {
    listarMock.mockResolvedValue({ linhas: [rolo(), rolo({ id: 'b' })], cortada: false })
    marcarMock.mockResolvedValue(1)
    const r = await gerarCsvPendentesAction()
    expect(r.ok).toBe(true)
    expect((r as { quantidade: number }).quantidade).toBe(2)
    expect((r as { aviso?: string }).aviso).toContain('ao mesmo tempo')
  })

  it('sem disputa, nenhum aviso aparece', async () => {
    listarMock.mockResolvedValue({ linhas: [rolo()], cortada: false })
    const r = await gerarCsvPendentesAction()
    expect((r as { aviso?: string }).aviso).toBeUndefined()
  })

  it('se o CSV não puder ser montado, nada é marcado como impresso', async () => {
    // Código do banco divergente do formato do domínio: `linhasDoArquivoLegado` lança.
    listarMock.mockResolvedValue({ linhas: [rolo({ codigo: 'CAPA78-L1' })], cortada: false })
    const r = await gerarCsvPendentesAction()
    expect(r.ok).toBe(false)
    expect(marcarMock).not.toHaveBeenCalled()
  })
})

describe('as demais ações', () => {
  it('listarPendentesAction repassa as linhas e o aviso de lista cortada', async () => {
    listarMock.mockResolvedValue({ linhas: [rolo()], cortada: true })
    expect(await listarPendentesAction()).toEqual({ ok: true, linhas: [rolo()], cortada: true })
  })

  it('removerPendenteAction explica quando a linha já não é pendente', async () => {
    removerMock.mockRejectedValue(new Error('NAO_PENDENTE'))
    const r = await removerPendenteAction('a')
    expect(r.ok).toBe(false)
    expect((r as { erro: string }).erro).toContain('já')
  })

  it('baixarDeNovoAction recusa lista vazia sem chamar o banco', async () => {
    const r = await baixarDeNovoAction([])
    expect(r.ok).toBe(false)
    expect(porIdsMock).not.toHaveBeenCalled()
  })

  it('baixarDeNovoAction gera o arquivo sem marcar nada de novo', async () => {
    porIdsMock.mockResolvedValue([rolo({ impressaEm: '2026-09-30T11:00:00Z' })])
    const r = await baixarDeNovoAction(['a'])
    expect(r.ok).toBe(true)
    expect((r as { csv: string }).csv).toContain('CAPA78-123425L0004')
    expect(marcarMock).not.toHaveBeenCalled()
  })
})
