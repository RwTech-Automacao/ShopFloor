import { describe, it, expect } from 'vitest'
import { gerarFaixaSNs, montarGrade, burninEmAndamento } from '../grade'

describe('gerarFaixaSNs', () => {
  it('gera a faixa com zero-padding e prefixo/sufixo', () => {
    const r = gerarFaixaSNs('AB008C', 'AB011C')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sns).toEqual(['AB008C', 'AB009C', 'AB010C', 'AB011C'])
  })
  it('barra prefixo/sufixo diferentes e faixa sem número', () => {
    expect(gerarFaixaSNs('A100', 'B200').ok).toBe(false)
    expect(gerarFaixaSNs('ABC', 'ABD').ok).toBe(false)
  })
  it('barra faixa maior que 2000', () => {
    const r = gerarFaixaSNs('1', '3000')
    expect(r.ok).toBe(false)
  })
})

describe('montarGrade', () => {
  const postos = ['Inicial', 'Teste', 'Embalagem']
  const reg = (over: Partial<{ snNorm: string; posto: string; status: string; numeroCaixa: string }>) => ({
    snNorm: '100', posto: 'Inicial', status: '', numeroCaixa: '', ...over,
  })
  it('sem registro → Pendente em tudo; Manutenção → —', () => {
    const [l] = montarGrade(['100'], postos, [])
    expect(l!.celulas).toEqual({ Inicial: 'Pendente', Teste: 'Pendente', Embalagem: 'Pendente', 'Manutenção': '—' })
  })
  it('sem status → Registrado; Embalagem mostra a caixa', () => {
    const [l] = montarGrade(['100'], postos, [reg({}), reg({ posto: 'Embalagem', numeroCaixa: 'CX-01' })])
    expect(l!.celulas['Inicial']).toBe('Registrado')
    expect(l!.celulas['Embalagem']).toBe('CX-01')
  })
  it('com status: Aprovado vence Reprovado (re-lançamento)', () => {
    const [l] = montarGrade(['100'], postos, [
      reg({ posto: 'Teste', status: 'Reprovado' }),
      reg({ posto: 'Teste', status: 'Aprovado' }),
    ])
    expect(l!.celulas['Teste']).toBe('Aprovado')
  })
  it('com status só reprovado → Reprovado; Manutenção com reparo → Concluído', () => {
    const [l] = montarGrade(['100'], postos, [
      reg({ posto: 'Teste', status: 'Reprovado' }),
      reg({ posto: 'Manutenção' }),
    ])
    expect(l!.celulas['Teste']).toBe('Reprovado')
    expect(l!.celulas['Manutenção']).toBe('Concluído')
  })
  it('casa SN da linha com registros pelo normalizado', () => {
    const [l] = montarGrade(['0100'], postos, [reg({ snNorm: '100' })])
    expect(l!.celulas['Inicial']).toBe('Registrado')
  })
  it('casa SN com PREFIXO sem zero-padding (bloco numérico, como o legado)', () => {
    const [l] = montarGrade(['AB009C'], postos, [reg({ snNorm: 'ab9c' })])
    expect(l!.celulas['Inicial']).toBe('Registrado')
  })

  it('Burn-in com ciclo aberto → Em andamento (entrada sem saída, mesmo com status vazio)', () => {
    const postosComBurnin = ['Inicial', 'Burn-in', 'Embalagem']
    const [l] = montarGrade(['100'], postosComBurnin, [reg({ posto: 'Burn-in', status: '' })])
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })

  it('Burn-in fechado (entrada + saída) → segue a regra com-status normal', () => {
    const postosComBurnin = ['Inicial', 'Burn-in', 'Embalagem']
    const [l] = montarGrade(['100'], postosComBurnin, [
      reg({ posto: 'Burn-in', status: '' }),
      reg({ posto: 'Burn-in', status: 'Aprovado' }),
    ])
    expect(l!.celulas['Burn-in']).toBe('Aprovado')
  })

  it('Burn-in com novo ciclo aberto após um ciclo fechado → Em andamento', () => {
    const postosComBurnin = ['Inicial', 'Burn-in', 'Embalagem']
    const [l] = montarGrade(['100'], postosComBurnin, [
      reg({ posto: 'Burn-in', status: '' }),
      reg({ posto: 'Burn-in', status: 'Reprovado' }),
      reg({ posto: 'Burn-in', status: '' }),
    ])
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })
})

describe('burninEmAndamento', () => {
  it('mais entradas que saídas → aberto', () => {
    expect(burninEmAndamento([{ status: '' }])).toBe(true)
    expect(burninEmAndamento([{ status: '' }, { status: 'Aprovado' }, { status: '' }])).toBe(true)
  })
  it('entradas == saídas → fechado', () => {
    expect(burninEmAndamento([])).toBe(false)
    expect(burninEmAndamento([{ status: '' }, { status: 'Aprovado' }])).toBe(false)
  })
})
