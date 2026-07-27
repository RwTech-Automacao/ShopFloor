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
  const reg = (over: Partial<{ snNorm: string; posto: string; status: string; numeroCaixa: string; dataHora: string }>) => ({
    snNorm: '100', posto: 'Inicial', status: '', numeroCaixa: '', dataHora: '2026-01-01T00:00:00Z', ...over,
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

  const bi = ['Inicial', 'Burn-in', 'Embalagem']
  it('Burn-in com ciclo aberto → Em andamento (entrada sem saída)', () => {
    const [l] = montarGrade(['100'], bi, [reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' })])
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })
  it('Burn-in fechado (entrada + saída) → regra com-status normal', () => {
    const [l] = montarGrade(['100'], bi, [
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Aprovado', dataHora: '2026-07-24T14:00:00Z' }),
    ])
    expect(l!.celulas['Burn-in']).toBe('Aprovado')
  })
  it('novo ciclo aberto após um fechado → Em andamento', () => {
    const [l] = montarGrade(['100'], bi, [
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Reprovado', dataHora: '2026-07-24T10:00:00Z' }),
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T12:00:00Z' }),
    ])
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })
  it('reprova com 2 defeitos (2 registros mesmo instante) + re-entrada → Em andamento', () => {
    // caso que a contagem simples errava: 2 entradas vs 2 saídas
    const [l] = montarGrade(['100'], bi, [
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Reprovado', dataHora: '2026-07-24T10:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Reprovado', dataHora: '2026-07-24T10:00:00Z' }),
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T12:00:00Z' }),
    ])
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })
})

describe('burninEmAndamento', () => {
  const e = (dataHora: string, status: string) => ({ dataHora, status })
  it('entrada sem saída → aberto', () => {
    expect(burninEmAndamento([e('2026-07-24T08:00:00Z', '')])).toBe(true)
  })
  it('entrada + saída → fechado', () => {
    expect(burninEmAndamento([])).toBe(false)
    expect(burninEmAndamento([e('2026-07-24T08:00:00Z', ''), e('2026-07-24T14:00:00Z', 'Aprovado')])).toBe(false)
  })
  it('reprova multi-defeito + re-entrada → aberto (não confunde N saídas)', () => {
    expect(burninEmAndamento([
      e('2026-07-24T08:00:00Z', ''),
      e('2026-07-24T10:00:00Z', 'Reprovado'),
      e('2026-07-24T10:00:00Z', 'Reprovado'),
      e('2026-07-24T12:00:00Z', ''),
    ])).toBe(true)
  })
})
