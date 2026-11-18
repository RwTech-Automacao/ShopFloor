import { describe, expect, it } from 'vitest'
import { mensagemDoErro } from '../erros'

describe('mensagemDoErro', () => {
  it('traduz os códigos das funções do SAT', () => {
    expect(mensagemDoErro('SEM_PERMISSAO')).toBe('Você não tem permissão para esta ação.')
    expect(mensagemDoErro('MOTIVO_OBRIGATORIO')).toBe('NF reprovada: escolha ao menos um motivo.')
    expect(mensagemDoErro('MESMA_NF')).toBe('A nota nova é igual à atual — para mudar só a situação, use Corrigir.')
  })
  it('traduz os códigos da entrada por NF (0187)', () => {
    expect(mensagemDoErro('CNPJ_INVALIDO')).toBe('CNPJ da nota inválido (14 dígitos) ou CPF (11).')
    expect(mensagemDoErro('NS_REPETIDO')).toBe('Um número de série está duas vezes nesta nota.')
    expect(mensagemDoErro('SEM_RELOGIOS')).toBe('Bipe ao menos um relógio.')
    expect(mensagemDoErro('OS_EM_USO')).toBe('Essa OS já está ligada a outro relógio.')
    expect(mensagemDoErro('OS_DE_OUTRO_NS')).toBe('Essa OS não é deste número de série.')
    expect(mensagemDoErro('NF_NAO_ENCONTRADA')).toBe('Nota não encontrada.')
    for (const c of ['RELOGIOS_DEMAIS', 'ITEM_INVALIDO', 'ENTRADA_INVALIDA']) {
      expect(mensagemDoErro(c)).not.toBe('Não foi possível concluir. Tente de novo.')
    }
  })
  it('os erros do cadastro de motivos saíram', () => {
    expect(mensagemDoErro('TEXTO_INVALIDO')).toBe('Não foi possível concluir. Tente de novo.')
    expect(mensagemDoErro('MOTIVO_NAO_ENCONTRADO')).toBe('Não foi possível concluir. Tente de novo.')
    expect(mensagemDoErro('duplicate key value violates unique constraint "sat_motivos_nf_texto"')).toBe('Não foi possível concluir. Tente de novo.')
  })
  it('o resto vira uma mensagem genérica (nada de SQL na tela)', () => {
    expect(mensagemDoErro('relation x does not exist', 'Não foi possível salvar.')).toBe('Não foi possível salvar.')
  })
})
