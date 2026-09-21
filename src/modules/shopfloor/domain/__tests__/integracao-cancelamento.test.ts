import { describe, it, expect } from 'vitest'
import { mensagemPecaAvancou } from '../integracao-cancelamento'

describe('mensagemPecaAvancou', () => {
  it('diz por quais postos a peça já passou e o que fazer', () => {
    const m = mensagemPecaAvancou('Embalagem, Inspeção NQA')
    expect(m).toContain('já passou por Embalagem, Inspeção NQA depois da integração')
    expect(m).toContain('cancele antes esses lançamentos')
  })

  it('sem a lista, fala em outros postos', () => {
    expect(mensagemPecaAvancou('')).toContain('já passou por outros postos')
  })
})
