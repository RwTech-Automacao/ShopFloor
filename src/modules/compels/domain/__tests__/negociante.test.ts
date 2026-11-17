import { describe, expect, it } from 'vitest'
import { filtroNegociante, negocianteDoCnpj } from '../negociante'
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
