import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { lerPlanilha } from './ler-planilha'

/** Monta um `File` .xlsx em memória a partir de uma matriz (linhas × colunas). */
function planilhaFake(aoa: unknown[][]): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Plan1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
  return new File([new Uint8Array(buf)], 'teste.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('lerPlanilha', () => {
  it('descarta colunas fantasma (sem cabeçalho e sem dados) depois da última coluna real', async () => {
    const file = planilhaFake([
      ['Nome', 'NF', '', ''],
      ['a', '1', null, null],
      ['b', '2', null, null],
    ])
    const { colunas, linhas } = await lerPlanilha(file)
    expect(colunas).toEqual(['Nome', 'NF'])
    expect(linhas).toHaveLength(2)
    expect(Object.keys(linhas[0]!)).toEqual(['Nome', 'NF'])
  })

  it('mantém coluna sem cabeçalho que tem dados (não perde informação)', async () => {
    const file = planilhaFake([
      ['Nome', 'NF', '', ''],
      ['a', '1', 'X', null],
    ])
    const { colunas, linhas } = await lerPlanilha(file)
    // Nome, NF e a coluna com 'X' (mesmo sem cabeçalho) são mantidas; a última (vazia) some.
    expect(colunas).toHaveLength(3)
    expect(colunas.slice(0, 2)).toEqual(['Nome', 'NF'])
    const chaveSemCabecalho = colunas[2]!
    expect(linhas[0]![chaveSemCabecalho]).toBe('X')
  })

  it('não altera planilha em que todas as colunas têm cabeçalho', async () => {
    const file = planilhaFake([
      ['Nome', 'NF', 'Fornecedor'],
      ['a', '1', 'ACME'],
    ])
    const { colunas } = await lerPlanilha(file)
    expect(colunas).toEqual(['Nome', 'NF', 'Fornecedor'])
  })

  it('retorna vazio para arquivo inválido', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'ruim.xlsx')
    const { colunas, linhas } = await lerPlanilha(file)
    expect(colunas).toEqual([])
    expect(linhas).toEqual([])
  })
})
