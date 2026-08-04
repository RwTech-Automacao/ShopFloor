import { describe, it, expect } from 'vitest'
import {
  perfilTemStatus, perfilPrecisaAprovado, perfilExigeManutencao, perfilPedeConfirmacaoConserto,
  montarLinhasPerfil, obrigatoriosPorPerfil, PERFIL_PADRAO, type PerfilPosto,
} from '../perfil-posto'

const P = (o: Partial<PerfilPosto>): PerfilPosto => ({
  chave: 'x', nome: 'X', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'nenhum', ...o,
})

describe('flags por perfil', () => {
  it('temStatus / precisaAprovado / exigeManutencao', () => {
    expect(perfilTemStatus(P({ temStatus: true }))).toBe(true)
    expect(perfilPrecisaAprovado(P({ gate: 'aprovado' }))).toBe(true)
    expect(perfilPrecisaAprovado(P({ gate: 'registrado' }))).toBe(false)
    expect(perfilExigeManutencao(P({ exigeManutencao: true }))).toBe(true)
  })

  it('pedeConfirmacaoConserto: coleta defeito E sem manutenção', () => {
    // inspeção que conserta no próprio posto → pede confirmação
    expect(perfilPedeConfirmacaoConserto(P({ reprova: 'defeitos', exigeManutencao: false }))).toBe(true)
    expect(perfilPedeConfirmacaoConserto(P({ reprova: 'posicoes', exigeManutencao: false }))).toBe(true)
    // vai pra manutenção → NÃO pede (tem reparo próprio)
    expect(perfilPedeConfirmacaoConserto(P({ reprova: 'defeitos', exigeManutencao: true }))).toBe(false)
    // não coleta defeito → NÃO pede
    expect(perfilPedeConfirmacaoConserto(P({ reprova: 'nenhum', exigeManutencao: false }))).toBe(false)
  })
})

describe('montarLinhasPerfil', () => {
  it('não reprovado → []', () => {
    expect(montarLinhasPerfil(P({ temStatus: true, reprova: 'defeitos' }), { status: 'aprovado' })).toEqual([])
  })
  it('reprova=posicoes → 1 linha por posição', () => {
    const r = montarLinhasPerfil(P({ temStatus: true, reprova: 'posicoes' }), { status: 'reprovado', posicoes: ['A1', 'B2', ''] })
    expect(r).toEqual([{ codigo_defeito: '', posicao: 'A1', tipo_defeito: '' }, { codigo_defeito: '', posicao: 'B2', tipo_defeito: '' }])
  })
  it('reprova=defeitos → 1 linha por defeito', () => {
    const r = montarLinhasPerfil(P({ temStatus: true, reprova: 'defeitos' }), { status: 'reprovado', defeitos: [{ codigo: '10 X', posicao: 'C3', tipo: 'SMD' }] })
    expect(r).toEqual([{ codigo_defeito: '10 X', posicao: 'C3', tipo_defeito: 'SMD' }])
  })
})

describe('obrigatoriosPorPerfil', () => {
  const base = { colaborador: 'a', pmo: 'p', op: 'o', numeroSerie: 's' }
  it('passagem → só base', () => {
    expect(obrigatoriosPorPerfil(P({}), base).ok).toBe(true)
    expect(obrigatoriosPorPerfil(P({}), { ...base, colaborador: '' }).ok).toBe(false)
  })
  it('recurso=caixa exige nº caixa + qtd', () => {
    expect(obrigatoriosPorPerfil(P({ recurso: 'caixa' }), base).ok).toBe(false)
    expect(obrigatoriosPorPerfil(P({ recurso: 'caixa' }), { ...base, numeroCaixa: '1', limiteCaixa: '10' }).ok).toBe(true)
  })
  it('recurso=nqa exige visual+funcional', () => {
    expect(obrigatoriosPorPerfil(P({ temStatus: true, recurso: 'nqa' }), { ...base, nqaVisual: 'A', nqaFuncional: 'B' }).ok).toBe(true)
    expect(obrigatoriosPorPerfil(P({ temStatus: true, recurso: 'nqa' }), base).ok).toBe(false)
  })
  it('temStatus exige status; reprova=defeitos exige cod/pos/tipo', () => {
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), base).ok).toBe(false) // sem status
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), { ...base, status: 'aprovado' }).ok).toBe(true)
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), { ...base, status: 'reprovado' }).ok).toBe(false) // falta defeito
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'defeitos' }), { ...base, status: 'reprovado', cod: '1', pos: 'A', tipo: 'SMD' }).ok).toBe(true)
  })
  it('reprova=posicoes (SPI) exige posição na reprova', () => {
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'posicoes' }), { ...base, status: 'reprovado' }).ok).toBe(false)
    expect(obrigatoriosPorPerfil(P({ temStatus: true, reprova: 'posicoes' }), { ...base, status: 'reprovado', pos: 'A1' }).ok).toBe(true)
  })
})
