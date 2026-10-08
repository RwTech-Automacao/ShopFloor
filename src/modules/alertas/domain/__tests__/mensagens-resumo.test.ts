import { describe, it, expect } from 'vitest'
import { LIMITE_MENSAGEM, textoResumo, type LinhaResumo } from '../mensagens'

// 07/10/2026 15:00 em São Paulo (18:00 UTC): o mesmo dia nos dois fusos do processo.
const DIA = new Date('2026-10-07T18:00:00Z')
const CAB = '📊 Resumo do dia 07/10 — Resumo diário'

function postoN(i: number, nomeExtra = ''): LinhaResumo {
  return { posto: `P${String(i).padStart(2, '0')}${nomeExtra}`, aprovados: 100, reprovados: 0 }
}
const linhaDe = (l: LinhaResumo) => `${l.posto}: 100,0% · 100 aprovados, 0 reprovados`

describe('textoResumo', () => {
  it('concorda no singular com 1 aprovado e 1 reprovado', () => {
    expect(textoResumo('Resumo diário', DIA, [{ posto: 'Teste', aprovados: 1, reprovados: 1 }])).toBe(
      `${CAB}\nTeste: 50,0% · 1 aprovado, 1 reprovado`,
    )
  })

  it('um posto: cabeçalho com o dia e a linha com a taxa', () => {
    expect(textoResumo('Resumo diário', DIA, [{ posto: 'Teste', aprovados: 95, reprovados: 5 }])).toBe(
      `${CAB}\nTeste: 95,0% · 95 aprovados, 5 reprovados`,
    )
  })

  it('vários postos: uma linha por posto, na ordem recebida', () => {
    const t = textoResumo('Resumo diário', DIA, [
      { posto: 'Teste', aprovados: 8, reprovados: 1 },
      { posto: 'Burn-in', aprovados: 10, reprovados: 0 },
      { posto: 'Embalagem', aprovados: 1, reprovados: 2 },
    ])
    expect(t).toBe(
      `${CAB}\nTeste: 88,8% · 8 aprovados, 1 reprovado\nBurn-in: 100,0% · 10 aprovados, 0 reprovados\n` +
        'Embalagem: 33,3% · 1 aprovado, 2 reprovados',
    )
  })

  it('o dia sai no fuso da fábrica, não no do processo (23:30 em SP já é dia seguinte em UTC)', () => {
    // 2026-10-08T02:30Z = 07/10 23:30 em São Paulo.
    expect(textoResumo('R', new Date('2026-10-08T02:30:00Z'), [postoN(1)]).split('\n')[0]).toBe('📊 Resumo do dia 07/10 — R')
  })

  it('sem nenhum posto: só o cabeçalho', () => {
    expect(textoResumo('Resumo diário', DIA, [])).toBe(CAB)
  })

  describe('teto do Discord', () => {
    // Monta N postos de largura igual e engorda o nome do ÚLTIMO até o texto ter `alvo` caracteres.
    function comTamanho(n: number, alvo: number): LinhaResumo[] {
      const base = Array.from({ length: n }, (_, i) => postoN(i + 1))
      const atual = textoResumo('Resumo diário', DIA, base).length
      base[n - 1] = postoN(n, 'x'.repeat(alvo - atual))
      return base
    }

    it('exatamente no limite: a lista passa INTEIRA, sem aviso de corte', () => {
      const linhas = comTamanho(30, LIMITE_MENSAGEM)
      const t = textoResumo('Resumo diário', DIA, linhas)
      expect(t.length).toBe(LIMITE_MENSAGEM)
      expect(t).toBe(`${CAB}\n${linhas.map(linhaDe).join('\n')}`)
      expect(t).not.toContain('e mais')
    })

    it('um caractere acima do limite: corta, e diz que sobrou 1 posto (singular)', () => {
      const linhas = comTamanho(30, LIMITE_MENSAGEM + 1)
      const t = textoResumo('Resumo diário', DIA, linhas)
      expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
      expect(t).toBe(`${CAB}\n${linhas.slice(0, 29).map(linhaDe).join('\n')}\n… e mais 1 posto`)
    })

    it('o texto CORTADO que dá exatamente o limite (aviso incluído) é aceito, não descartado por 1 caractere', () => {
      const aviso = '… e mais 1 posto'
      const linhas = Array.from({ length: 30 }, (_, i) => postoN(i + 1))
      const sem = `${CAB}\n${linhas.slice(0, 29).map(linhaDe).join('\n')}\n${aviso}`
      linhas[28] = postoN(29, 'x'.repeat(LIMITE_MENSAGEM - sem.length))
      const t = textoResumo('Resumo diário', DIA, linhas)
      expect(t.length).toBe(LIMITE_MENSAGEM)
      expect(t).toBe(`${CAB}\n${linhas.slice(0, 29).map(linhaDe).join('\n')}\n${aviso}`)
    })

    it('lista muito acima: mantém o MÁXIMO de linhas que cabe e conta certo os que ficaram fora', () => {
      const linhas = Array.from({ length: 80 }, (_, i) => postoN(i + 1))
      const t = textoResumo('Resumo diário', DIA, linhas)
      // Quantas linhas cabem, contado por força bruta aqui no teste (independente do código).
      let k = 0
      for (let c = 1; c < 80; c += 1) {
        const candidato = `${CAB}\n${linhas.slice(0, c).map(linhaDe).join('\n')}\n… e mais ${80 - c} postos`
        if (candidato.length <= LIMITE_MENSAGEM) k = c
      }
      expect(k).toBeGreaterThan(0)
      expect(k).toBeLessThan(79)
      expect(t).toBe(`${CAB}\n${linhas.slice(0, k).map(linhaDe).join('\n')}\n… e mais ${80 - k} postos`)
      expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    })

    it('regra de nome gigante, que não deixa caber nem um posto: sobra o cabeçalho, sem passar do limite', () => {
      const t = textoResumo('N'.repeat(1990), DIA, [postoN(1), postoN(2)])
      expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
      expect(t).not.toContain('P01')
    })
  })
})
