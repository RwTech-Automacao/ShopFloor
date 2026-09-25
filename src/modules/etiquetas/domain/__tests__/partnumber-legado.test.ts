import { describe, it, expect } from 'vitest'
import {
  avaliarLinhas,
  chaveItemLocacao,
  linhasDoArquivoLegado,
  locacaoValida,
  montarPartNumberLegado,
  normalizarItem,
  normalizarLocacao,
  recusaDoItem,
  resumirPrevia,
  type ConferenciaLegado,
  type LinhaSaldo,
} from '../partnumber-legado'
import { gerarCsv, gerarEtiquetasDoProcesso } from '../partnumber'
import { separarRolo } from '@/modules/setup/domain/codigo-rolo'

function linha(item: string, locacao: string, i = 1): LinhaSaldo {
  return { linhaPlanilha: i + 4, item, descricao: `DESCRIÇÃO ${item}`, locacao }
}

function conferencia(
  item: string,
  locacao: string,
  emitidasNaLocacao: number,
  ultimoSequencial: number,
  ultimaNaLocacao: string | null = null,
): ConferenciaLegado {
  return { item, locacao, emitidasNaLocacao, ultimaNaLocacao, ultimoSequencial }
}

describe('montarPartNumberLegado', () => {
  it('CAPA78 + 1 -> CAPA78-L0001', () => {
    expect(montarPartNumberLegado('CAPA78', 1)).toBe('CAPA78-L0001')
  })
  it('normaliza o item e preenche com 4 dígitos', () => {
    expect(montarPartNumberLegado(' capa78 ', 23)).toBe('CAPA78-L0023')
    expect(montarPartNumberLegado('CAPA78', 9999)).toBe('CAPA78-L9999')
  })
  it('acima de 9999 o número vai inteiro, sem truncar (espelha etq_legado_codigo)', () => {
    expect(montarPartNumberLegado('CAPA78', 10000)).toBe('CAPA78-L10000')
  })
})

describe('normalizarLocacao', () => {
  it('a coluna do ERP vem como faixa: usa a posição inicial', () => {
    expect(normalizarLocacao('A1.C.15 - A1.C.15')).toBe('A1.C.15')
    expect(normalizarLocacao('a1.d.39')).toBe('A1.D.39')
  })
  it('sem faixa, usa o valor inteiro', () => {
    expect(normalizarLocacao(' A1.E.07 ')).toBe('A1.E.07')
  })
})

describe('locacaoValida', () => {
  it('coluna.lado.posição passa', () => {
    expect(locacaoValida('A1.C.66')).toBe(true)
    expect(locacaoValida('B12.E.7')).toBe(true)
  })
  it('sem o ponto do lado não passa (o caso A1.C37 da planilha real)', () => {
    expect(locacaoValida('A1.C37')).toBe(false)
    expect(locacaoValida('')).toBe(false)
  })
})

describe('recusaDoItem', () => {
  it('item vazio é recusado', () => {
    expect(recusaDoItem('')).toBe('sem_item')
  })
  it('item COM separador é recusado: quebraria a divisão do código no Setup', () => {
    expect(recusaDoItem('CAP-986')).toBe('item_com_separador')
    expect(recusaDoItem('CAP 986')).toBe('item_com_separador')
    expect(recusaDoItem('CAP/986')).toBe('item_com_separador')
  })
  it('item limpo passa', () => {
    expect(recusaDoItem('CAPA78')).toBeNull()
  })
})

// ---- caso 1 da spec: o sequencial é por item e NUNCA reinicia ----
describe('sequencial contínuo por item (a regra crítica)', () => {
  it('três rolos do mesmo item na mesma leva viram 0001, 0002 e 0003', () => {
    const avaliadas = avaliarLinhas(
      [linha('CAPA78', 'A1.C.39', 1), linha('CAPA78', 'A1.C.40', 2), linha('CAPA78', 'A1.C.41', 3)],
      [],
    )
    expect(avaliadas.map((l) => l.codigoPrevisto)).toEqual([
      'CAPA78-L0001',
      'CAPA78-L0002',
      'CAPA78-L0003',
    ])
  })

  it('a leva seguinte continua de onde o contador do item parou', () => {
    const conferencias = [conferencia('CAPA78', 'B1.D.12', 0, 2)]
    const avaliadas = avaliarLinhas([linha('CAPA78', 'B1.D.12', 1)], conferencias)
    expect(avaliadas[0]!.codigoPrevisto).toBe('CAPA78-L0003')
  })

  it('a ordem das levas não muda nada: o que importa é o último sequencial do item', () => {
    const primeira = avaliarLinhas(
      [linha('CAPA78', 'A1.C.39', 1), linha('CAPA78', 'A1.C.40', 2)],
      [],
    )
    // Depois de gravar as duas, a leva de outra coluna vê ultimoSequencial = 2.
    const segunda = avaliarLinhas([linha('CAPA78', 'B1.D.12', 1)], [conferencia('CAPA78', 'B1.D.12', 0, 2)])
    const todos = [...primeira, ...segunda].map((l) => l.codigoPrevisto)
    expect(todos).toEqual(['CAPA78-L0001', 'CAPA78-L0002', 'CAPA78-L0003'])
    expect(new Set(todos).size).toBe(todos.length)
  })
})

// ---- caso 2 da spec ----
describe('itens diferentes têm sequenciais independentes', () => {
  it('cada item conta do seu próprio ponto', () => {
    const avaliadas = avaliarLinhas(
      [linha('RESY99', 'A1.C.71', 1), linha('TRA234', 'A1.C.53', 2), linha('RESY99', 'A1.C.72', 3)],
      [conferencia('TRA234', 'A1.C.53', 0, 7)],
    )
    expect(avaliadas.map((l) => l.codigoPrevisto)).toEqual([
      'RESY99-L0001',
      'TRA234-L0008',
      'RESY99-L0002',
    ])
  })
})

// ---- caso 3 da spec ----
describe('o código gerado passa nas regras do Setup', () => {
  it('separarRolo enxerga o item como componente e o lote não é vazio', () => {
    const { valido, prefixo, sequencial } = separarRolo(montarPartNumberLegado('CAPA78', 1))
    expect(valido).toBe(true)
    expect(prefixo).toBe('CAPA78')
    expect(sequencial).toBe('L0001')
  })
  it('vale para todos os códigos de uma leva', () => {
    const avaliadas = avaliarLinhas(
      [linha('CAPA78', 'A1.C.39', 1), linha('RESY99', 'A1.C.71', 2), linha('TRA234', 'A1.C.53', 3)],
      [],
    )
    for (const l of avaliadas) {
      const partido = separarRolo(l.codigoPrevisto)
      expect(partido.valido).toBe(true)
      expect(partido.prefixo).toBe(l.item)
      expect(partido.sequencial).not.toBe('')
    }
  })
})

// ---- caso 4 da spec ----
describe('recusas e sinalizações', () => {
  it('linha sem código de item é recusada e não recebe código', () => {
    const avaliadas = avaliarLinhas([linha('', 'A1.C.01', 1), linha('CAPA78', 'A1.C.39', 2)], [])
    expect(avaliadas[0]!.recusa).toBe('sem_item')
    expect(avaliadas[0]!.codigoPrevisto).toBe('')
    expect(avaliadas[1]!.recusa).toBeNull()
    expect(avaliadas[1]!.codigoPrevisto).toBe('CAPA78-L0001')
  })

  it('locação malformada é sinalizada e NÃO impede o resto', () => {
    const avaliadas = avaliarLinhas(
      [linha('CAPF47', 'A1.C37', 1), linha('CAPA78', 'A1.C.39', 2)],
      [],
    )
    expect(avaliadas[0]!.avisos).toEqual(['locacao_malformada'])
    expect(avaliadas[0]!.recusa).toBeNull()
    expect(avaliadas[0]!.codigoPrevisto).toBe('CAPF47-L0001')
    expect(avaliadas[1]!.avisos).toEqual([])
  })

  it('o resumo conta o que gera, o que é recusado e por quê', () => {
    const resumo = resumirPrevia(
      avaliarLinhas(
        [
          linha('', 'A1.C.01', 1),
          linha('CAP-986', 'A1.C.02', 2),
          linha('CAPF47', 'A1.C37', 3),
          linha('CAPA78', 'A1.C.39', 4),
        ],
        [],
      ),
    )
    expect(resumo).toEqual({
      aEtiquetar: 2,
      recusadas: 2,
      semItem: 1,
      itemComSeparador: 1,
      locacaoMalformada: 1,
      repetidasNaPlanilha: 0,
      jaEtiquetadas: 0,
    })
  })
})

// ---- caso 5 da spec ----
describe('repetição na prévia', () => {
  it('mesma linha duas vezes na MESMA planilha: as duas são sinalizadas (e as duas geram)', () => {
    const avaliadas = avaliarLinhas(
      [linha('TRA234', 'A1.C.53', 1), linha('TRA234', 'A1.C.53', 2), linha('TRA234', 'A1.C.54', 3)],
      [],
    )
    expect(avaliadas[0]!.avisos).toContain('repetida_na_planilha')
    expect(avaliadas[1]!.avisos).toContain('repetida_na_planilha')
    expect(avaliadas[2]!.avisos).not.toContain('repetida_na_planilha')
    expect(avaliadas.map((l) => l.codigoPrevisto)).toEqual([
      'TRA234-L0001',
      'TRA234-L0002',
      'TRA234-L0003',
    ])
  })

  it('item já etiquetado NESTA posição aparece com a data da última vez', () => {
    const avaliadas = avaliarLinhas(
      [linha('CAPA78', 'A1.C.39', 1)],
      [conferencia('CAPA78', 'A1.C.39', 1, 1, '2026-09-24T13:45:00.000Z')],
    )
    expect(avaliadas[0]!.avisos).toContain('ja_etiquetada')
    expect(avaliadas[0]!.ultimaNaLocacao).toBe('2026-09-24T13:45:00.000Z')
  })

  it('item etiquetado em OUTRA posição não é repetição (o rolo pode ser outro)', () => {
    const avaliadas = avaliarLinhas(
      [linha('CAPA78', 'B1.D.12', 1)],
      [conferencia('CAPA78', 'B1.D.12', 0, 3, null)],
    )
    expect(avaliadas[0]!.avisos).toEqual([])
    expect(avaliadas[0]!.codigoPrevisto).toBe('CAPA78-L0004')
  })
})

// ---- caso 6 da spec: o arquivo de saída é o de hoje, byte a byte ----
describe('formato do arquivo de saída', () => {
  const emitidas = [
    { ordem: 2, item: 'RESY99', sequencial: 4, codigo: 'RESY99-L0004', locacao: 'A1.C.71' },
    { ordem: 1, item: 'CAPA78', sequencial: 1, codigo: 'CAPA78-L0001', locacao: 'A1.C.39' },
  ]

  it('três colunas entre aspas, separadas por vírgula, volume 01-01 (um rolo por linha)', () => {
    expect(gerarCsv(linhasDoArquivoLegado(emitidas))).toBe(
      '"CAPA78-L0001","CAPA78","01-01"\r\n"RESY99-L0004","RESY99","01-01"',
    )
  })

  it('sai na ORDEM da planilha, não na ordem em que o banco devolveu', () => {
    expect(linhasDoArquivoLegado(emitidas).map((l) => l.partNumber)).toEqual([
      'CAPA78-L0001',
      'RESY99-L0004',
    ])
  })

  it('byte a byte no mesmo formato do arquivo de etiquetas de hoje', () => {
    const hoje = gerarCsv(
      gerarEtiquetasDoProcesso({
        id: 'p1',
        status: 'Aprovado',
        responsavelRecebimento: 'Ana',
        codigoMaterial: 'CAPA78',
        numeroPedido: '0529/26',
        diInpi: '',
        numeroNf: '12345',
        volumes: 2,
      }).etiquetas,
    )
    const legado = gerarCsv(linhasDoArquivoLegado(emitidas))

    // Mesma "gramática": 3 campos sempre entre aspas, vírgula como separador, CRLF entre linhas,
    // sem cabeçalho e sem quebra no fim do arquivo. É o que o modelo da impressora espera.
    const registro = /^"[^"]*","[^"]*","[^"]*"$/
    for (const csv of [hoje, legado]) {
      const linhasCsv = csv.split('\r\n')
      expect(linhasCsv.length).toBeGreaterThan(1)
      for (const l of linhasCsv) expect(l).toMatch(registro)
      expect(csv.replace(/\r\n/g, '')).not.toContain('\n')
      expect(csv.endsWith('\r\n')).toBe(false)
      expect(csv.startsWith('﻿')).toBe(false)
    }
    expect(legado.split('\r\n').every((l) => l.split(',').length === hoje.split('\r\n')[0]!.split(',').length)).toBe(true)
  })

  it('código divergente do formato do domínio para a geração em vez de imprimir errado', () => {
    expect(() =>
      linhasDoArquivoLegado([{ ordem: 1, item: 'CAPA78', sequencial: 1, codigo: 'CAPA78-L1', locacao: '' }]),
    ).toThrow(/Código divergente/)
  })
})

describe('normalizarItem / chaveItemLocacao', () => {
  it('item e locação normalizados formam a chave de repetição', () => {
    expect(normalizarItem(' capa78 ')).toBe('CAPA78')
    expect(chaveItemLocacao('CAPA78', 'A1.C.39')).toBe('CAPA78|A1.C.39')
  })
})
