import { describe, it, expect } from 'vitest'
import { lerEnvioReservado, textoDoEnvio, DadosEnvioInvalidos } from '../envio'
import { mensagemMudancaNf, mensagemNota } from '@/modules/sat/domain/mensagens'

// O `dados` como a 0192 o grava (alerta_avaliar, bloco 'sat_entrada').
const BASE = {
  regra_tipo: 'sat_entrada',
  regra_nome: 'Entrada no SAT',
  empresa: 'CLIENTE FICTICIO',
  cnpj: '12.345.678/0001-90',
  ns: ['00043005620019177', '562-19178'],
  em: '2026-11-18T13:00:00Z',
  agora: '2026-11-18T13:05:00Z',
}

describe('textoDoEnvio: entrada no SAT (0192) — o texto é o MESMO do aviso direto de antes', () => {
  it('NF registrada = mensagemNota', () => {
    const dados = {
      ...BASE, evento: 'entrada', numero_de: '', numero_para: '4521', situacao_de: '', situacao_para: 'reprovada',
      motivos: ['CFOP errado', 'Outro: sem lacre'],
    }
    const esperado = mensagemNota({
      numero: '4521', empresa: 'CLIENTE FICTICIO', cnpj: '12.345.678/0001-90', situacao: 'reprovada',
      motivos: ['CFOP errado', 'Outro: sem lacre'], ns: ['00043005620019177', '562-19178'],
    })
    expect(textoDoEnvio('sat_entrada', dados)).toBe(esperado)
    expect(esperado).toBe(
      '📦 Chegou no SAT: NF 4521 — CLIENTE FICTICIO (12.345.678/0001-90) — reprovada ❌ (CFOP errado; Outro: sem lacre) — ' +
        '2 relógios: 00043005620019177, 562-19178',
    )
  })

  it('NF corrigida = mensagemMudancaNf correcao', () => {
    const dados = {
      ...BASE, evento: 'correcao', numero_de: '4521', numero_para: '4521', situacao_de: 'reprovada',
      situacao_para: 'aprovada', motivos: [],
    }
    expect(textoDoEnvio('sat_entrada', dados)).toBe(mensagemMudancaNf({
      tipo: 'correcao', numeroDe: '4521', numeroPara: '4521', empresa: 'CLIENTE FICTICIO', cnpj: '12.345.678/0001-90',
      situacaoDe: 'reprovada', situacaoPara: 'aprovada', motivos: [], ns: ['00043005620019177', '562-19178'],
    }))
  })

  it('NF trocada = mensagemMudancaNf troca', () => {
    const dados = {
      ...BASE, evento: 'troca', numero_de: '4521', numero_para: '1240', situacao_de: 'reprovada',
      situacao_para: 'aprovada', motivos: [],
    }
    const texto = textoDoEnvio('sat_entrada', dados)
    expect(texto).toBe(mensagemMudancaNf({
      tipo: 'troca', numeroDe: '4521', numeroPara: '1240', empresa: 'CLIENTE FICTICIO', cnpj: '12.345.678/0001-90',
      situacaoDe: 'reprovada', situacaoPara: 'aprovada', motivos: [], ns: ['00043005620019177', '562-19178'],
    }))
    expect(texto.startsWith('🧾 NF do SAT trocada: NF 4521 (reprovada) substituída pela NF 1240')).toBe(true)
  })

  it('empresa em branco é dado legítimo (o texto mostra só o CNPJ)', () => {
    const dados = { ...BASE, empresa: '', evento: 'entrada', numero_para: '7', situacao_para: 'aprovada', motivos: [] }
    expect(textoDoEnvio('sat_entrada', dados)).toContain('NF 7 — 12.345.678/0001-90 — aprovada')
  })

  it('dado corrompido LANÇA (nunca uma mensagem vazia calada)', () => {
    expect(() => textoDoEnvio('sat_entrada', { ...BASE, evento: 'os', numero_para: '1', situacao_para: 'aprovada' }))
      .toThrow(DadosEnvioInvalidos)
    expect(() => textoDoEnvio('sat_entrada', { ...BASE, evento: 'entrada', numero_para: '', situacao_para: 'aprovada' }))
      .toThrow(DadosEnvioInvalidos)
    expect(() => textoDoEnvio('sat_entrada', { ...BASE, evento: 'entrada', numero_para: '1', situacao_para: 'talvez' }))
      .toThrow(DadosEnvioInvalidos)
  })

  it('a linha da fila de tipo sat_entrada é reconhecida', () => {
    const e = lerEnvioReservado({
      id: 'e1', ocorrencia_id: null, usuario_id: 'u1', canal: 'telegram', externo_id: 'TG', tipo: 'sat_entrada',
      dados: { ...BASE }, com_botao: false, tentativas: 1, destino_tipo: 'usuario',
    })
    expect(e?.tipo).toBe('sat_entrada')
  })
})
