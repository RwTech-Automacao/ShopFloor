import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'
import { qrDoEnvio } from '../anexos'

const dados = {
  regra_tipo: 'ficha', regra_nome: 'Ficha do Almoxarifado', agora: '2026-11-06T18:05:00Z',
  unidade: 'caixa', qr: 'CX[1][160]8682_F-PMOF52_F', codigo: 'CX[1][160]8682_F-PMOF52_F',
  pmo: 'PMOF52_F', op: '8682_F', produto: 'PLACA XYZ 12V', quantidade_op: 800, quantidade_apontada: 160,
  data_producao: '2026-11-06T13:30:00Z', responsavel: 'Maria Souza',
}

describe('textoDoEnvio — ficha', () => {
  it('monta a ficha com os campos, PMO e OP em linhas separadas', () => {
    const linhas = textoDoEnvio('ficha', dados).split('\n')
    expect(linhas[0]).toBe('📋 Ficha de apontamento · OP PMOF52_F/8682_F · Caixa CX[1][160]8682_F-PMOF52_F')
    expect(linhas).toContain('Data de produção: 06/11/2026')
    expect(linhas).toContain('Produto: PLACA XYZ 12V')
    expect(linhas).toContain('Quantidade da OP: 800')
    expect(linhas).toContain('PMO: PMOF52_F')
    expect(linhas).toContain('OP: 8682_F')
    expect(linhas).toContain('Quantidade apontada: 160')
    expect(linhas).toContain('Responsável: Maria Souza')
  })

  it('lote: rótulo de lote e responsável ausente vira travessão', () => {
    const t = textoDoEnvio('ficha', {
      ...dados, unidade: 'lote', codigo: 'LOTE[03ec5112][6]', qr: 'LOTE[03ec5112][6]', responsavel: '',
    })
    expect(t.split('\n')[0]).toContain('Lote LOTE[03ec5112][6]')
    expect(t).toContain('Responsável: —')
  })

  it('data e quantidade da OP ausentes viram travessão (nunca uma mensagem calada)', () => {
    const t = textoDoEnvio('ficha', { ...dados, data_producao: null, quantidade_op: null })
    expect(t).toContain('Data de produção: —')
    expect(t).toContain('Quantidade da OP: —')
  })

  it('unidade desconhecida ou quantidade apontada que não é número LANÇA', () => {
    expect(() => textoDoEnvio('ficha', { ...dados, unidade: 'peca' })).toThrow(/DADOS_INVALIDOS/)
    expect(() => textoDoEnvio('ficha', { ...dados, quantidade_apontada: 'x' })).toThrow(/DADOS_INVALIDOS/)
  })

  it('o QR do envio sai dos mesmos dados (só o Discord o anexa)', () => {
    expect(qrDoEnvio(dados)).toBe('CX[1][160]8682_F-PMOF52_F')
  })
})
