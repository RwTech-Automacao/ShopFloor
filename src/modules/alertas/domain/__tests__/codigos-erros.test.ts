import { describe, it, expect } from 'vitest'
import { extrairCodigoVinculo, montarCallbackResolver, lerCallbackResolver } from '../codigos'
import { codigoErroAlerta, mensagemErroAlerta } from '../erros'

describe('extrairCodigoVinculo', () => {
  it('acha o código no meio de uma frase e normaliza a caixa', () => {
    expect(extrairCodigoVinculo('oi, meu codigo é alerta-7k3m obrigado')).toBe('ALERTA-7K3M')
  })
  it('aceita o código puro', () => {
    expect(extrairCodigoVinculo('ALERTA-AB29')).toBe('ALERTA-AB29')
  })
  it('recusa texto sem código', () => {
    expect(extrairCodigoVinculo('/start')).toBeNull()
    expect(extrairCodigoVinculo('')).toBeNull()
    expect(extrairCodigoVinculo(null)).toBeNull()
  })
  it('recusa código com tamanho errado', () => {
    expect(extrairCodigoVinculo('ALERTA-7K3')).toBeNull()
    expect(extrairCodigoVinculo('ALERTA-7K3MX')).toBeNull()
  })
})

describe('callback do botão Resolvido', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  it('monta o payload curto (cabe nos 64 bytes do Telegram)', () => {
    expect(montarCallbackResolver(id)).toBe(`r:${id}`)
    expect(montarCallbackResolver(id).length).toBeLessThanOrEqual(64)
  })
  it('lê de volta o id da ocorrência', () => {
    expect(lerCallbackResolver(`r:${id}`)).toBe(id)
  })
  it('recusa prefixo desconhecido ou id que não é uuid', () => {
    expect(lerCallbackResolver('x:1')).toBeNull()
    expect(lerCallbackResolver('r:nao-e-uuid')).toBeNull()
    expect(lerCallbackResolver(null)).toBeNull()
  })
})

describe('erros do banco', () => {
  it('extrai o código da mensagem do Postgres', () => {
    expect(codigoErroAlerta('CODIGO_INVALIDO')).toBe('CODIGO_INVALIDO')
    expect(codigoErroAlerta('erro ao executar: NAO_DESTINATARIO')).toBe('NAO_DESTINATARIO')
    expect(codigoErroAlerta('deu ruim')).toBe('')
  })
  it('traduz cada código para PT-BR', () => {
    expect(mensagemErroAlerta('CODIGO_INVALIDO')).toBe('Código inválido ou já usado. Gere um novo em Meu perfil.')
    expect(mensagemErroAlerta('CONTA_JA_VINCULADA')).toBe('Esta conta já está vinculada a outro usuário do ShopFloor.')
    expect(mensagemErroAlerta('MUITAS_TENTATIVAS')).toBe('Muitas tentativas. Aguarde 15 minutos e gere um código novo no ShopFloor.')
    expect(mensagemErroAlerta('NAO_DESTINATARIO')).toBe('Você não é destinatário desta regra.')
    expect(mensagemErroAlerta('OCORRENCIA_ENCERRADA')).toBe('Esta ocorrência já normalizou.')
    expect(mensagemErroAlerta('OCORRENCIA_INEXISTENTE')).toBe('Ocorrência não encontrada.')
    expect(mensagemErroAlerta('SEM_PERMISSAO')).toBe('Você não tem permissão para configurar alertas.')
  })
  it('mensagem desconhecida vira texto genérico', () => {
    expect(mensagemErroAlerta('connection refused')).toBe('Não foi possível concluir agora. Tente de novo.')
    expect(mensagemErroAlerta(null)).toBe('Não foi possível concluir agora. Tente de novo.')
  })
})
