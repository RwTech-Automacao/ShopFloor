import { describe, expect, it } from 'vitest'
import { filtroNegociante, filtroNegociantePorCodigo, negocianteDoCnpj, nomeDoNegociante } from '../negociante'
import { RespostaInesperada } from '../leituras-erp'

// Respostas fictícias no formato de `GET negociante/list` (nada de cadastro real).
const linha = (l: Record<string, unknown>) => ({
  codigo: 'C0001', cpfCnpj: '12.345.678/0001-90', nome: 'CLIENTE FICTICIO LTDA', nomeFantasia: 'FICTICIO', inativo: false, ...l,
})

describe('negocianteDoCnpj', () => {
  it('acha pelo CNPJ com os mesmos dígitos (com ou sem máscara no cadastro)', () => {
    expect(negocianteDoCnpj({ results: [linha({})] }, '12345678000190')).toEqual({ codigo: 'C0001', nome: 'CLIENTE FICTICIO LTDA' })
    expect(negocianteDoCnpj({ results: [linha({ cpfCnpj: '12345678000190' })] }, '12345678000190'))
      .toEqual({ codigo: 'C0001', nome: 'CLIENTE FICTICIO LTDA' })
  })

  it('ignora inativo e CNPJ de outros dígitos (a busca do Compels é por trecho)', () => {
    const r = { results: [
      linha({ codigo: 'X1', inativo: true }),
      linha({ codigo: 'X2', cpfCnpj: '12.345.678/0001-9' }),
      linha({ codigo: 'X3', cpfCnpj: '112.345.678/0001-90' }),
      linha({ codigo: 'OK', nome: '  CLIENTE ATIVO  ' }),
    ] }
    expect(negocianteDoCnpj(r, '12345678000190')).toEqual({ codigo: 'OK', nome: 'CLIENTE ATIVO' })
  })

  it('sem nome usa o nome fantasia', () => {
    expect(negocianteDoCnpj({ results: [linha({ nome: '  ', nomeFantasia: ' FANTASIA ' })] }, '12345678000190'))
      .toEqual({ codigo: 'C0001', nome: 'FANTASIA' })
    expect(negocianteDoCnpj({ results: [linha({ nome: null })] }, '12345678000190'))
      .toEqual({ codigo: 'C0001', nome: 'FICTICIO' })
  })

  it('código numérico vira texto', () => {
    expect(negocianteDoCnpj({ results: [linha({ codigo: 1234 })] }, '12345678000190')).toMatchObject({ codigo: '1234' })
  })

  it('nenhum: null', () => {
    expect(negocianteDoCnpj({ results: [] }, '12345678000190')).toBeNull()
    expect(negocianteDoCnpj({ results: [linha({ inativo: true })] }, '12345678000190')).toBeNull()
    expect(negocianteDoCnpj({ results: [linha({ nome: '', nomeFantasia: '' })] }, '12345678000190')).toBeNull()
  })

  it('resposta fora do formato: RespostaInesperada', () => {
    expect(() => negocianteDoCnpj({ erro: 'x' }, '12345678000190')).toThrow(RespostaInesperada)
  })
})

describe('filtroNegociante', () => {
  it('é o filtro da grade de negociantes, só com o CPF/CNPJ', () => {
    expect(filtroNegociante('12.345.678/0001-90')).toEqual({
      codigo: '', nome: '', cpfCnpj: '12.345.678/0001-90', telefone: '', tipoIdList: null, statusIdList: null,
      transportadora: '', cep: '', municipio: '', uf: '', pais: '', situacao: 'ATIVO', codigoVendedor: null,
      observacao: '', limiteCreditoIdList: null, restricaoVendedor: false, carteiraRestricaoVendedor: false,
      exibirUltimaCompra: false, atendenteAlocadoId: null, cadastroLead: false,
    })
  })
})

describe('filtroNegociantePorCodigo', () => {
  it('é o mesmo filtro da grade, só com o código', () => {
    expect(filtroNegociantePorCodigo(' 160 ')).toEqual({ ...filtroNegociante(''), codigo: '160', cpfCnpj: '' })
    expect(Object.keys(filtroNegociantePorCodigo('160'))).toEqual(Object.keys(filtroNegociante('x')))
  })
})

describe('nomeDoNegociante', () => {
  it('nome fantasia, senão razão social (aparados)', () => {
    expect(nomeDoNegociante({ results: [linha({ codigo: '160', nomeFantasia: ' FICTICIO ' })] }, '160')).toBe('FICTICIO')
    expect(nomeDoNegociante({ results: [linha({ codigo: 160, nomeFantasia: '  ', nome: ' RAZAO LTDA ' })] }, '160')).toBe('RAZAO LTDA')
  })
  it('só o código EXATO (a busca do Compels é por trecho)', () => {
    const r = { results: [linha({ codigo: '1600', nomeFantasia: 'OUTRO' }), linha({ codigo: '160', nomeFantasia: 'CERTO' })] }
    expect(nomeDoNegociante(r, '160')).toBe('CERTO')
  })
  it('inativo só é ignorado se houver um ativo com o mesmo código', () => {
    const r = { results: [linha({ codigo: '160', nomeFantasia: 'VELHO', inativo: true }), linha({ codigo: '160', nomeFantasia: 'NOVO' })] }
    expect(nomeDoNegociante(r, '160')).toBe('NOVO')
    expect(nomeDoNegociante({ results: [linha({ codigo: '160', nomeFantasia: 'VELHO', inativo: true })] }, '160')).toBe('VELHO')
  })
  it('nenhum ou sem nome: null', () => {
    expect(nomeDoNegociante({ results: [] }, '160')).toBeNull()
    expect(nomeDoNegociante({ results: [linha({ codigo: '160', nome: '', nomeFantasia: null })] }, '160')).toBeNull()
  })
})
