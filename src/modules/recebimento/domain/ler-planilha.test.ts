import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
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

/**
 * Igual a `planilhaFake`, mas reescreve a dimensão da aba para `A1:AMJ1048576`,
 * como o Google Sheets/LibreOffice gravam com formatação de coluna/linha inteira.
 * (Não dá para fazer via `ws['!ref']`: o próprio `XLSX.write` varreria a área.)
 */
async function planilhaAreaGigante(aoa: unknown[][]): Promise<File> {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Plan1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
  const zip = await JSZip.loadAsync(buf)
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  expect(xml).toMatch(/<dimension ref="[^"]+"\/>/)
  zip.file('xl/worksheets/sheet1.xml', xml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:AMJ1048576"/>'))
  const out = await zip.generateAsync({ type: 'uint8array' })
  return new File([new Uint8Array(out)], 'gigante.xlsx')
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

  it('ignora a área usada declarada gigante (formatação de coluna/linha inteira) e lê só as células reais', async () => {
    const file = await planilhaAreaGigante([
      ['Nome', 'NF'],
      ['a', '1'],
      ['b', '2'],
    ])
    const { colunas, linhas } = await lerPlanilha(file)
    expect(colunas).toEqual(['Nome', 'NF'])
    expect(linhas).toEqual([
      { Nome: 'a', NF: '1' },
      { Nome: 'b', NF: '2' },
    ])
  }, 10_000)

  it('retorna vazio para arquivo inválido', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'ruim.xlsx')
    const { colunas, linhas } = await lerPlanilha(file)
    expect(colunas).toEqual([])
    expect(linhas).toEqual([])
  })
})
