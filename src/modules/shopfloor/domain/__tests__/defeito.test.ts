import { describe, it, expect } from 'vitest'
import {
  normalizarCodigoDefeito, validarDefeito,
  separarCodigoDefeito, capitalizarDescricaoDefeito, siglaTipoDefeito, formatarTituloDefeito,
} from '../defeito'

describe('normalizarCodigoDefeito', () => {
  it('faz trim, colapsa espaços internos e força maiúsculas', () => {
    expect(normalizarCodigoDefeito('  1002   trilha rompida  ')).toBe('1002 TRILHA ROMPIDA')
  })
  it('string vazia/só espaços vira vazio', () => {
    expect(normalizarCodigoDefeito('   ')).toBe('')
  })
})

describe('validarDefeito', () => {
  it('aceita código válido + tipo peça, devolvendo o código normalizado', () => {
    const r = validarDefeito({ codigo: ' 1010 solda fria ', tipo: 1 })
    expect(r).toEqual({ ok: true, valor: { codigo: '1010 SOLDA FRIA', tipo: 1 } })
  })
  it('aceita tipo teste (2)', () => {
    const r = validarDefeito({ codigo: '2001 falha', tipo: 2 })
    expect(r.ok && r.valor.tipo).toBe(2)
  })
  it('rejeita código vazio', () => {
    expect(validarDefeito({ codigo: '   ', tipo: 1 })).toEqual({
      ok: false,
      erro: 'Informe o código do defeito.',
    })
  })
  it('rejeita tipo fora de {1,2}', () => {
    expect(validarDefeito({ codigo: '1010 x', tipo: 0 })).toEqual({
      ok: false,
      erro: 'Selecione o tipo (peça ou teste).',
    })
    expect(validarDefeito({ codigo: '1010 x', tipo: 3 }).ok).toBe(false)
    expect(validarDefeito({ codigo: '1010 x', tipo: Number.NaN }).ok).toBe(false)
  })
})

describe('separarCodigoDefeito', () => {
  it('separa número + descrição do código do catálogo', () => {
    expect(separarCodigoDefeito('2040 COMPONENTE FALTANDO')).toEqual({ numero: '2040', descricao: 'COMPONENTE FALTANDO' })
  })
  it('código SEM número na frente → tudo vira descrição', () => {
    expect(separarCodigoDefeito('TRILHA ROMPIDA')).toEqual({ numero: '', descricao: 'TRILHA ROMPIDA' })
  })
  it('código SÓ com número → descrição vazia', () => {
    expect(separarCodigoDefeito('1002')).toEqual({ numero: '1002', descricao: '' })
  })
  it('código vazio → tudo vazio', () => {
    expect(separarCodigoDefeito('')).toEqual({ numero: '', descricao: '' })
  })
})

describe('capitalizarDescricaoDefeito', () => {
  it('MAIÚSCULAS do catálogo viram Capitalizado', () => {
    expect(capitalizarDescricaoDefeito('COMPONENTE FALTANDO')).toBe('Componente Faltando')
  })
  it('respeita acento do pt-BR', () => {
    expect(capitalizarDescricaoDefeito('SOLDA ÚMIDA')).toBe('Solda Úmida')
  })
  it('capitaliza depois de separadores que não são espaço', () => {
    expect(capitalizarDescricaoDefeito('SOLDA FRIA/PTH')).toBe('Solda Fria/Pth')
  })
})

describe('siglaTipoDefeito', () => {
  it('tipo do catálogo (1 = peça, 2 = teste)', () => {
    expect(siglaTipoDefeito(1)).toBe('P')
    expect(siglaTipoDefeito(2)).toBe('T')
  })
  it('texto do registro gravado pelo bipe', () => {
    expect(siglaTipoDefeito('Peça')).toBe('P')
    expect(siglaTipoDefeito('PECA')).toBe('P')
    expect(siglaTipoDefeito('Teste')).toBe('T')
  })
  it('tipo desconhecido (texto livre do formulário manual) → sem sigla', () => {
    expect(siglaTipoDefeito('SMD')).toBe('')
    expect(siglaTipoDefeito('Funcional')).toBe('')
    expect(siglaTipoDefeito(9)).toBe('')
    expect(siglaTipoDefeito('')).toBe('')
    expect(siglaTipoDefeito(null)).toBe('')
    expect(siglaTipoDefeito(undefined)).toBe('')
  })
})

describe('formatarTituloDefeito', () => {
  it('formato pedido: posição, descrição, sigla do tipo e número', () => {
    const t = formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: 'H1', tipo: 1 })
    expect(t.texto).toBe('H1: Componente Faltando P: Cod.: 2040')
    expect(t).toMatchObject({ posicao: 'H1', descricao: 'Componente Faltando', sigla: 'P', numero: '2040' })
  })
  it('posição vazia → título começa na descrição (sem ":" solto)', () => {
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: '', tipo: 2 }).texto)
      .toBe('Componente Faltando T: Cod.: 2040')
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', tipo: 2 }).texto)
      .toBe('Componente Faltando T: Cod.: 2040')
  })
  it('código sem número → sai sem o "Cod.:" (e sem dois-pontos pendurado)', () => {
    expect(formatarTituloDefeito({ codigo: 'TRILHA ROMPIDA', posicao: 'A5', tipo: 1 }).texto)
      .toBe('A5: Trilha Rompida P')
  })
  it('só a posição (registro de reprova por posição, sem catálogo) → sem dois-pontos pendurado', () => {
    expect(formatarTituloDefeito({ codigo: '', posicao: 'A5', tipo: '' }).texto).toBe('A5')
  })
  it('código só com número → sai sem descrição', () => {
    expect(formatarTituloDefeito({ codigo: '1002', posicao: 'H1', tipo: 1 }).texto).toBe('H1: P: Cod.: 1002')
  })
  it('tipo desconhecido → título sem a sigla', () => {
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: 'H1', tipo: 'SMD' }).texto)
      .toBe('H1: Componente Faltando Cod.: 2040')
  })
  it('nada preenchido → rótulo genérico (nunca string vazia na tela)', () => {
    expect(formatarTituloDefeito({ codigo: '', posicao: '', tipo: '' }).texto).toBe('Defeito')
  })
})
