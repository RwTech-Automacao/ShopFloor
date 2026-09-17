import { describe, it, expect } from 'vitest'
import { mensagemErroSetup } from '../mensagens'

describe('mensagemErroSetup', () => {
  it('traduz o código que vem dentro da mensagem do Postgres', () => {
    expect(mensagemErroSetup('P0001: COMPONENTE_FORA_DA_ESTRUTURA')).toBe('Esse componente não está na estrutura da PMO.')
    expect(mensagemErroSetup('SN_FORA_DA_FAIXA')).toBe('O número de série não pertence à faixa da OP.')
  })
  it('mensagem genérica pra erro desconhecido', () => {
    expect(mensagemErroSetup('deu ruim')).toBe('Não foi possível concluir a operação.')
  })
})
