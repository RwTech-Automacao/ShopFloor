import { describe, expect, it } from 'vitest'
import { lerEnvioReservado, textoDoEnvio } from '../envio'

const dados = {
  regra_tipo: 'compels', regra_nome: 'Compels Valdei', posto: 'Almoxarifado',
  janela_tipo: 'op', janela_valor: null, pmo: 'PRT797', op: '8682_F',
  ops: [{ pmo: 'PRT797', op: '8682_F' }],
  aberta_em: '2026-11-06T17:00:00Z', agora: '2026-11-06T18:05:00Z',
  linhas: 2,
  itens: [{ motivo: 'Aguardando requisição no Compels: tela em uso', linhas: 2, pecas: 20, desistiu: false }],
}

describe('textoDoEnvio — compels (ocorrência)', () => {
  it('alerta leva a OP e o motivo', () => {
    const t = textoDoEnvio('alerta', dados)
    expect(t).toContain('OP PRT797/8682_F')
    expect(t).toContain('• Aguardando requisição no Compels: tela em uso · 2 linhas · 20 peças')
  })

  it('lembrete leva o cabeçalho de lembrete', () => {
    expect(textoDoEnvio('lembrete', dados)).toMatch(/^⏰ Lembrete — continua há \d+ min\n/)
  })

  it('normalizou', () => {
    expect(textoDoEnvio('normalizou', { ...dados, itens: [] })).toBe(
      '🟢 Compels: OP PRT797/8682_F sem problemas no envio',
    )
  })

  it('reabertura envolve o texto', () => {
    const t = textoDoEnvio('alerta', {
      ...dados, reabertura: true, resolvida_por_nome: 'Ana', resolvida_em: '2026-11-06T16:00:00Z',
    })
    expect(t).toMatch(/^🔁 Reaberto — dado como resolvido por Ana/)
  })

  it('itens que não são lista viram erro de dados, não mensagem vazia', () => {
    expect(() => textoDoEnvio('alerta', { ...dados, itens: 'x' })).toThrow(/DADOS_INVALIDOS/)
  })

  it('o resolvido de uma OP não mostra a chave PMO/OP como se fosse defeito', () => {
    const t = textoDoEnvio('resolvido', {
      posto: 'Almoxarifado', resolvida_por_nome: 'Ana', resolvida_em: '2026-11-06T18:00:00Z',
      pmo: 'PRT797', op: '8682_F', ops: [{ pmo: 'PRT797', op: '8682_F' }], defeito: 'PRT797/8682_F',
    })
    expect(t).not.toContain('defeito')
    expect(t).not.toContain('PRT797/8682_F)')
  })
})

describe('textoDoEnvio — compels_aviso', () => {
  const aviso = {
    regra_tipo: 'compels', regra_nome: 'Compels Valdei', agora: '2026-11-06T18:05:00Z',
    avisos: [{ pmo: 'PRT797', op: '8682_F', quantidade: 160, aviso: 'quantidade inesperada no Compels' }],
  }

  it('monta a lista de avisos', () => {
    const t = textoDoEnvio('compels_aviso', aviso)
    expect(t).toContain('1 entrada gravada com ressalva')
    expect(t).toContain('• OP PRT797/8682_F · 160 peças — quantidade inesperada no Compels')
  })

  it('avisos que não são lista viram erro de dados', () => {
    expect(() => textoDoEnvio('compels_aviso', { ...aviso, avisos: null })).toThrow(/DADOS_INVALIDOS/)
  })

  it('a linha da fila com o tipo novo é reconhecida na reserva', () => {
    const l = lerEnvioReservado({
      id: 'e1', ocorrencia_id: null, usuario_id: 'u1', canal: 'telegram', externo_id: '1',
      tipo: 'compels_aviso', dados: aviso, com_botao: false, tentativas: 1, destino_tipo: 'usuario',
    })
    expect(l?.tipo).toBe('compels_aviso')
    expect(l?.comBotao).toBe(false)
  })
})
