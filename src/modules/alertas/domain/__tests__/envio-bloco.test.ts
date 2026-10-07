import { describe, expect, it } from 'vitest'
import { textoDoEnvio } from '../envio'

/**
 * `dados` como o alerta_avaliar da 0139 grava na janela 'intervalos': as chaves 'bloco_inicio' e
 * 'bloco_fim' são a FAIXA do bloco medido, em ISO.
 *
 * A PONTE: `textoJanela` já sabe ler a faixa e o banco já a grava, mas quem monta o objeto `Janela`
 * é o `janelaDe` do envio.ts. Sem ele repassar as duas chaves, a mensagem sai com o texto genérico
 * 'no bloco do turno' — e quem recebe o alerta não sabe de que hora ele fala.
 */
const DADOS = {
  regra_tipo: 'aprovacao',
  regra_nome: 'Taxa do turno',
  posto: 'Teste',
  taxa: 75.0,
  taxa_minima: 90.0,
  aprovados: 15,
  reprovados: 5,
  janela_tipo: 'intervalos',
  janela_valor: 60,
  pmo: null,
  op: null,
  bloco_inicio: '2026-10-06T13:00:00+00:00',
  bloco_fim: '2026-10-06T14:00:00+00:00',
  aberta_em: '2026-10-06T14:00:00+00:00',
  agora: '2026-10-06T14:05:00+00:00',
}

describe('textoDoEnvio na janela por blocos (0139)', () => {
  it('o alerta diz a faixa do bloco no fuso da fábrica, não o texto genérico', () => {
    const t = textoDoEnvio('alerta', DADOS)
    expect(t).toContain('das 10:00 às 11:00')
    expect(t).not.toContain('no bloco do turno')
  })

  it('o lembrete usa o mesmo corpo, e também diz a faixa', () => {
    expect(textoDoEnvio('lembrete', DADOS)).toContain('das 10:00 às 11:00')
  })

  it('linha da fila SEM a faixa (jsonb null) cai no texto genérico, sem quebrar', () => {
    const t = textoDoEnvio('alerta', { ...DADOS, bloco_inicio: null, bloco_fim: null })
    expect(t).toContain('no bloco do turno')
  })

  it('faixa ilegível na linha da fila também cai no genérico (não derruba a mensagem)', () => {
    const t = textoDoEnvio('alerta', { ...DADOS, bloco_inicio: 'lixo', bloco_fim: 'lixo' })
    expect(t).toContain('no bloco do turno')
  })
})
