import { describe, it, expect } from 'vitest'
import { HISTORICO_VERSOES, VERSAO } from '../versao'

/** maior.meio.menor viram um número só, para comparar a ordem do histórico. */
function peso(v: string): number {
  expect(v).toMatch(/^\d+\.\d+\.\d+$/)
  const [maior, meio, menor] = v.split('.').map(Number)
  return (maior ?? 0) * 1_000_000 + (meio ?? 0) * 1_000 + (menor ?? 0)
}

describe('versão do sistema', () => {
  it('a primeira linha do histórico é a versão que o sistema mostra', () => {
    expect(HISTORICO_VERSOES[0]?.versao).toBe(VERSAO)
  })

  it('o histórico vem do mais novo pro mais antigo, sem repetir versão', () => {
    const pesos = HISTORICO_VERSOES.map((v) => peso(v.versao))
    for (let i = 1; i < pesos.length; i++) {
      expect(pesos[i - 1]).toBeGreaterThan(pesos[i]!)
    }
  })

  it('toda entrada tem data dd/mm/aaaa e um resumo', () => {
    for (const v of HISTORICO_VERSOES) {
      expect(v.data).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
      expect(v.resumo.trim().length).toBeGreaterThan(0)
    }
  })

  it('a 2.2.0 é a do deploy de 28/09 e fala do que entrou', () => {
    const entrada = HISTORICO_VERSOES.find((v) => v.versao === '2.2.0')
    expect(entrada?.data).toBe('28/09/2026')
    // Função nova sobe o número do meio (2.1.0 → 2.2.0), nunca só o último.
    expect(VERSAO).toBe('2.2.0')
    for (const assunto of ['Recebimento', 'Abastecimento', 'Alertas', 'Telegram']) {
      expect(entrada?.resumo).toContain(assunto)
    }
  })
})
