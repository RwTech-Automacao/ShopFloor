import { describe, expect, it } from 'vitest'
import { casarTrechos, sugerirPosto, trechosDaArvore, validarParaAtivar, type NoArvore, type TrechoReceita } from '../estrutura'

const ROTA = ['Printer BOT', 'Inspeção SPI BOT', 'Inspeção AOI BOT', 'Printer TOP', 'Inspeção SPI TOP', 'Inspeção AOI TOP',
  'Montagem PTH', 'Inspeção PTH', 'Teste', 'Embalagem', 'Almoxarifado']
const almox = (p: string) => p === 'Almoxarifado'
const t = (seq: number, codigo: string, postoConclui: string | null, extra: Partial<TrechoReceita> = {}): TrechoReceita =>
  ({ seq, codigo, descricao: '', postoConclui, snModo: 'mesmo', estoque: 'EINTER', ...extra })

// Família real 8498 (PMOC14): 8499 PRT420 PTH (mãe 8498), 8500 PRT410 SMD (mãe 8499).
const ARVORE_8498: NoArvore[] = [
  { numero: 8499, codigo: 'PRT420', descricao: 'PARTES PTH DA PLACA INTERFACE SPECTRUM', nivel: 2, mae: 8498 },
  { numero: 8500, codigo: 'PRT410', descricao: 'PARTES SMD DA PLACA INTERFACE SPECTRUM', nivel: 3, mae: 8499 },
]

describe('sugerirPosto', () => {
  it('SMD → último posto de inspeção SMD/AOI/SPI antes da Montagem PTH', () => {
    expect(sugerirPosto('PARTES SMD DA PLACA', ROTA)).toBe('Inspeção AOI TOP')
  })
  it('PTH → Inspeção PTH', () => {
    expect(sugerirPosto('PARTES PTH DA PLACA', ROTA)).toBe('Inspeção PTH')
  })
  it('sem pista ou posto fora da rota → null', () => {
    expect(sugerirPosto('GABINETE', ROTA)).toBeNull()
    expect(sugerirPosto('PARTES PTH', ['Printer BOT', 'Teste'])).toBeNull()
  })
})

describe('trechosDaArvore', () => {
  it('ordena do mais fundo para cima (SMD antes da PTH) e sugere os postos', () => {
    expect(trechosDaArvore(8498, ARVORE_8498, ROTA)).toEqual([
      t(1, 'PRT410', 'Inspeção AOI TOP', { descricao: 'PARTES SMD DA PLACA INTERFACE SPECTRUM' }),
      t(2, 'PRT420', 'Inspeção PTH', { descricao: 'PARTES PTH DA PLACA INTERFACE SPECTRUM' }),
    ])
  })
  it('ignora OPs da família que não descendem da raiz (ex.: gabinete irmão)', () => {
    const nos = [...ARVORE_8498, { numero: 8501, codigo: 'PMOC36', descricao: 'GABINETE', nivel: 2, mae: 8497 }]
    expect(trechosDaArvore(8498, nos, ROTA).map((x) => x.codigo)).toEqual(['PRT410', 'PRT420'])
  })
})

describe('casarTrechos', () => {
  it('casa pelo código, sem diferenciar maiúsculas/espaços; o que não acha vira null', () => {
    const m = casarTrechos([{ seq: 1, codigo: ' prt410 ' }, { seq: 2, codigo: 'PRT420' }, { seq: 3, codigo: 'PRT999' }], ARVORE_8498)
    expect([...m]).toEqual([[1, 8500], [2, 8499], [3, null]])
  })
  it('código repetido na árvore → o de menor número', () => {
    const nos = [...ARVORE_8498, { numero: 8510, codigo: 'PRT410', descricao: '', nivel: 3, mae: 8499 }]
    expect(casarTrechos([{ seq: 1, codigo: 'PRT410' }], nos).get(1)).toBe(8500)
  })
})

describe('validarParaAtivar', () => {
  it('receita boa passa', () => {
    expect(validarParaAtivar([t(1, 'PRT410', 'Inspeção AOI TOP'), t(2, 'PRT420', 'Inspeção PTH')], ROTA, almox)).toEqual({ ok: true })
  })
  it('acusa posto vazio, fora da rota, repetido, fora de ordem, no Almoxarifado e SN próprio', () => {
    const r = validarParaAtivar(
      [
        t(1, 'PRT1', null),
        t(2, 'PRT2', 'Burn-in'),
        t(3, 'PRT3', 'Inspeção PTH'),
        t(4, 'PRT4', 'Inspeção PTH'),
        t(5, 'PRT5', 'Inspeção AOI TOP'),
        t(6, 'PRT6', 'Almoxarifado'),
        t(7, 'PRT7', 'Teste', { snModo: 'proprio' }),
      ],
      ROTA,
      almox,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erros).toEqual([
      'PRT1: escolha o posto que conclui este trecho.',
      'PRT2: o posto "Burn-in" não está na rota da PMO.',
      'PRT4: o posto "Inspeção PTH" já conclui outro trecho.',
      'PRT5: os trechos precisam seguir a ordem da rota (este posto vem antes do trecho anterior).',
      'PRT6: o Almoxarifado é o posto da PMO, não de uma PRT.',
      'PRT7: SN próprio ainda não suportado.',
    ])
  })
  it('receita sem trechos não ativa', () => {
    expect(validarParaAtivar([], ROTA, almox)).toEqual({ ok: false, erros: ['A estrutura não tem nenhum trecho.'] })
  })
})
