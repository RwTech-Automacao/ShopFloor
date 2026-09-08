import { describe, it, expect } from 'vitest'
import {
  normalizarCodigoDefeito, validarDefeito,
  separarCodigoDefeito, capitalizarDescricaoDefeito, tipoDefeitoExibido, formatarTituloDefeito,
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

describe('tipoDefeitoExibido', () => {
  it('mostra o tipo COMO FOI REGISTRADO — a reprova manual grava onde o defeito aconteceu', () => {
    expect(tipoDefeitoExibido('SMD')).toBe('SMD')
    expect(tipoDefeitoExibido('PTH')).toBe('PTH')
    expect(tipoDefeitoExibido('Funcional')).toBe('Funcional')
    expect(tipoDefeitoExibido('Integração')).toBe('Integração')
  })
  it('normaliza a caixa — o mesmo tipo aparece gravado de jeitos diferentes', () => {
    expect(tipoDefeitoExibido('smd')).toBe('SMD')       // sigla curta → caixa alta
    expect(tipoDefeitoExibido('FUNCIONAL')).toBe('Funcional') // palavra → capitalizada
  })
  it('o bipe grava Peça/Teste, e eles aparecem por extenso (não viram P/T)', () => {
    expect(tipoDefeitoExibido('Peça')).toBe('Peça')
    expect(tipoDefeitoExibido('Teste')).toBe('Teste')
  })
  it('sem tipo → vazio, pra o título não ficar com um ":" pendurado', () => {
    expect(tipoDefeitoExibido('')).toBe('')
    expect(tipoDefeitoExibido('   ')).toBe('')
    expect(tipoDefeitoExibido(null)).toBe('')
    expect(tipoDefeitoExibido(undefined)).toBe('')
  })
})

describe('formatarTituloDefeito', () => {
  it('formato pedido: posição, descrição, tipo do registro e número', () => {
    const t = formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: 'H1', tipo: 'SMD' })
    expect(t.texto).toBe('H1: Componente Faltando SMD: Cod.: 2040')
    expect(t).toMatchObject({ posicao: 'H1', descricao: 'Componente Faltando', sigla: 'SMD', numero: '2040' })
  })
  it('posição vazia → título começa na descrição (sem ":" solto)', () => {
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: '', tipo: 'PTH' }).texto)
      .toBe('Componente Faltando PTH: Cod.: 2040')
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', tipo: 'PTH' }).texto)
      .toBe('Componente Faltando PTH: Cod.: 2040')
  })
  it('código sem número → sai sem o "Cod.:" (e sem dois-pontos pendurado no fim)', () => {
    expect(formatarTituloDefeito({ codigo: 'TRILHA ROMPIDA', posicao: 'A5', tipo: 'Funcional' }).texto)
      .toBe('A5: Trilha Rompida Funcional')
  })
  it('só a posição (reprova por posição, sem código) → sem dois-pontos pendurado', () => {
    expect(formatarTituloDefeito({ codigo: '', posicao: 'A5', tipo: '' }).texto).toBe('A5')
  })
  it('código só com número → sai sem descrição', () => {
    expect(formatarTituloDefeito({ codigo: '1002', posicao: 'H1', tipo: 'SMD' }).texto).toBe('H1: SMD: Cod.: 1002')
  })
  it('sem tipo gravado → título sem essa parte', () => {
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: 'H1', tipo: '' }).texto)
      .toBe('H1: Componente Faltando Cod.: 2040')
  })
  it('tipo vindo do bipe aparece por extenso, não vira sigla', () => {
    expect(formatarTituloDefeito({ codigo: '2040 COMPONENTE FALTANDO', posicao: 'H1', tipo: 'Peça' }).texto)
      .toBe('H1: Componente Faltando Peça: Cod.: 2040')
  })
  it('nada preenchido → rótulo genérico (nunca string vazia na tela)', () => {
    expect(formatarTituloDefeito({ codigo: '', posicao: '', tipo: '' }).texto).toBe('Defeito')
  })
})
