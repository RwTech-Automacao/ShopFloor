import { describe, it, expect } from 'vitest'
import { mensagemErroSetup } from '../mensagens'

describe('mensagemErroSetup', () => {
  it('traduz o código que vem dentro da mensagem do Postgres', () => {
    expect(mensagemErroSetup('P0001: COMPONENTE_FORA_DA_ESTRUTURA')).toBe('Esse componente não está na estrutura da PMO.')
    expect(mensagemErroSetup('SN_FORA_DA_FAIXA')).toBe('O número de série não pertence à faixa da OP.')
  })
  it('erro desconhecido leva o texto do servidor junto', () => {
    expect(mensagemErroSetup('deu ruim')).toBe('Não foi possível concluir a operação: deu ruim')
    expect(mensagemErroSetup('  Could not find the function\n  public.st_abrir_setup  ')).toBe(
      'Não foi possível concluir a operação: Could not find the function public.st_abrir_setup',
    )
  })
  it('sem texto nenhum, fica só a mensagem genérica', () => {
    expect(mensagemErroSetup('')).toBe('Não foi possível concluir a operação.')
  })
})
