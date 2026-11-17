import { describe, expect, it } from 'vitest'
import { mensagemDoErro } from '../erros'

describe('mensagemDoErro', () => {
  it('traduz os códigos das funções da 0186', () => {
    expect(mensagemDoErro('SEM_PERMISSAO')).toBe('Você não tem permissão para esta ação.')
    expect(mensagemDoErro('MOTIVO_OBRIGATORIO')).toBe('NF reprovada: escolha ao menos um motivo.')
    expect(mensagemDoErro('MESMA_NF')).toBe('A NF nova é igual à atual — para mudar só a situação, use Corrigir.')
    expect(mensagemDoErro('duplicate key value violates unique constraint "sat_motivos_nf_texto"')).toBe('Já existe um motivo com esse texto.')
  })
  it('o resto vira uma mensagem genérica (nada de SQL na tela)', () => {
    expect(mensagemDoErro('relation x does not exist', 'Não foi possível salvar.')).toBe('Não foi possível salvar.')
  })
})
