import { describe, it, expect } from 'vitest'
import { gerarFaixaSNs, gerarFaixaSNsPagina, totalFaixaSNs, montarGrade, montarResumoPorPosto, burninEmAndamento } from '../grade'

const temStatus = (p: string) =>
  ['Inspeção SPI', 'Inspeção SMD', 'Inspeção PTH', 'Teste', 'Burn-in', 'Teste Final', 'Inspeção Final', 'Inspeção NQA'].some(
    (x) => x.toLowerCase() === p.toLowerCase(),
  )

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
    const [l] = montarGrade(['100'], postos, [], temStatus)
    expect(l!.celulas).toEqual({ Inicial: 'Pendente', Teste: 'Pendente', Embalagem: 'Pendente', 'Manutenção': '—' })
  })
  it('sem status → Registrado; Embalagem mostra a caixa', () => {
    const [l] = montarGrade(['100'], postos, [reg({}), reg({ posto: 'Embalagem', numeroCaixa: 'CX-01' })], temStatus)
    expect(l!.celulas['Inicial']).toBe('Registrado')
    expect(l!.celulas['Embalagem']).toBe('CX-01')
  })
  it('com status: Aprovado vence Reprovado (re-lançamento)', () => {
    const [l] = montarGrade(['100'], postos, [
      reg({ posto: 'Teste', status: 'Reprovado' }),
      reg({ posto: 'Teste', status: 'Aprovado' }),
    ], temStatus)
    expect(l!.celulas['Teste']).toBe('Aprovado')
  })
  it('com status só reprovado → Reprovado; Manutenção com reparo → Concluído', () => {
    const [l] = montarGrade(['100'], postos, [
      reg({ posto: 'Teste', status: 'Reprovado' }),
      reg({ posto: 'Manutenção' }),
    ], temStatus)
    expect(l!.celulas['Teste']).toBe('Reprovado')
    expect(l!.celulas['Manutenção']).toBe('Concluído')
  })
  it('casa SN da linha com registros pelo normalizado', () => {
    const [l] = montarGrade(['0100'], postos, [reg({ snNorm: '100' })], temStatus)
    expect(l!.celulas['Inicial']).toBe('Registrado')
  })
  it('casa SN com PREFIXO sem zero-padding (bloco numérico, como o legado)', () => {
    const [l] = montarGrade(['AB009C'], postos, [reg({ snNorm: 'ab9c' })], temStatus)
    expect(l!.celulas['Inicial']).toBe('Registrado')
  })

  const bi = ['Inicial', 'Burn-in', 'Embalagem']
  it('Burn-in com ciclo aberto → Em andamento (entrada sem saída)', () => {
    const [l] = montarGrade(['100'], bi, [reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' })], temStatus)
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })
  it('Burn-in fechado (entrada + saída) → regra com-status normal', () => {
    const [l] = montarGrade(['100'], bi, [
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Aprovado', dataHora: '2026-07-24T14:00:00Z' }),
    ], temStatus)
    expect(l!.celulas['Burn-in']).toBe('Aprovado')
  })
  it('novo ciclo aberto após um fechado → Em andamento', () => {
    const [l] = montarGrade(['100'], bi, [
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Reprovado', dataHora: '2026-07-24T10:00:00Z' }),
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T12:00:00Z' }),
    ], temStatus)
    expect(l!.celulas['Burn-in']).toBe('Em andamento')
  })
  it('reprova com 2 defeitos (2 registros mesmo instante) + re-entrada → Em andamento', () => {
    // caso que a contagem simples errava: 2 entradas vs 2 saídas
    const [l] = montarGrade(['100'], bi, [
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T08:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Reprovado', dataHora: '2026-07-24T10:00:00Z' }),
      reg({ posto: 'Burn-in', status: 'Reprovado', dataHora: '2026-07-24T10:00:00Z' }),
      reg({ posto: 'Burn-in', status: '', dataHora: '2026-07-24T12:00:00Z' }),
    ], temStatus)
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

describe('totalFaixaSNs / gerarFaixaSNsPagina (sem limite de 2000)', () => {
  it('conta a faixa sem gerar a lista, mesmo acima de 2000', () => {
    const r = totalFaixaSNs('1', '5000')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.total).toBe(5000)
  })
  it('gera só a página pedida + total', () => {
    const r = gerarFaixaSNsPagina('AB001C', 'AB010C', 2, 3) // offset 2, tamanho 3 → 003,004,005
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sns).toEqual(['AB003C', 'AB004C', 'AB005C'])
      expect(r.total).toBe(10)
    }
  })
  it('última página parcial não estoura', () => {
    const r = gerarFaixaSNsPagina('1', '5', 4, 3) // offset 4 → só o 5
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.sns).toEqual(['5'])
  })
})

describe('montarResumoPorPosto', () => {
  const postos = ['Inicial', 'Teste']
  const reg = (over: Partial<{ snNorm: string; posto: string; status: string; numeroCaixa: string; dataHora: string }>) => ({
    snNorm: '100', posto: 'Inicial', status: '', numeroCaixa: '', dataHora: '2026-01-01T00:00:00Z', ...over,
  })
  it('conta produzido/pendentes/aprovados/reprovados por posto', () => {
    // total 10; 2 peças passaram no Inicial (registrado), 1 aprovada e 1 reprovada no Teste
    const registros = [
      reg({ snNorm: '100', posto: 'Inicial' }),
      reg({ snNorm: '101', posto: 'Inicial' }),
      reg({ snNorm: '100', posto: 'Teste', status: 'Aprovado' }),
      reg({ snNorm: '101', posto: 'Teste', status: 'Reprovado' }),
    ]
    const resumo = montarResumoPorPosto(10, postos, registros, temStatus)
    const inicial = resumo.find((r) => r.posto === 'Inicial')!
    const teste = resumo.find((r) => r.posto === 'Teste')!
    expect(inicial).toMatchObject({ produzido: 2, pendentes: 8, aprovados: 0, reprovados: 0 })
    expect(teste).toMatchObject({ produzido: 2, pendentes: 8, aprovados: 1, reprovados: 1 })
  })
  it('aprovado tem precedência sobre reprovado (re-teste)', () => {
    const registros = [
      reg({ snNorm: '100', posto: 'Teste', status: 'Reprovado' }),
      reg({ snNorm: '100', posto: 'Teste', status: 'Aprovado' }),
    ]
    const teste = montarResumoPorPosto(5, ['Teste'], registros, temStatus).find((r) => r.posto === 'Teste')!
    expect(teste).toMatchObject({ produzido: 1, aprovados: 1, reprovados: 0 })
  })
})
