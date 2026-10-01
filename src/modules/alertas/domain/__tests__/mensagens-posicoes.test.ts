import { describe, it, expect } from 'vitest'
import { textoDoEnvio } from '../envio'
import { LIMITE_MENSAGEM, listaPosicoes, rotulosPosicoes } from '../mensagens'

/**
 * As POSIÇÕES da placa (os designadores: R12, C47) no alerta de defeito repetido. Sem elas o alerta
 * diz que o defeito se repetiu, mas não onde — e quem recebe não sabe o que ir olhar na placa.
 */

const DEFEITO = {
  posto: 'Teste',
  janela_tipo: 'tempo',
  janela_valor: 60,
  pmo: null,
  op: null,
  aberta_em: '2026-09-17T16:35:00+00:00',
  agora: '2026-09-17T17:05:00+00:00',
  regra_tipo: 'defeito',
  regra_nome: 'Defeito 3x',
  defeito: '2040 COMPONENTE FALTANDO',
  ocorrencias: 3,
  limite_ocorrencias: 3,
}

const CABECALHO =
  '🔴 Defeito 2040 (Componente Faltando) repetido no Teste: 3 vezes na última hora (limite 3)'
const RODAPE = 'Regra: Defeito 3x · 17/09 14:05'

describe('rotulosPosicoes', () => {
  it('agrupa a posição repetida com a contagem, em vez de repetir o item', () => {
    expect(rotulosPosicoes(['R12', 'C47', 'R12', 'R12'])).toEqual(['R12 (3x)', 'C47'])
  })
  it('o que mais aconteceu vem primeiro; empate desempata pelo designador', () => {
    expect(rotulosPosicoes(['C47', 'R12', 'C47', 'R12', 'L3'])).toEqual(['C47 (2x)', 'R12 (2x)', 'L3'])
  })
  it('a mesma posição escrita de outro jeito conta como uma só', () => {
    expect(rotulosPosicoes(['r12', ' R12 ', 'R12'])).toEqual(['R12 (3x)'])
  })
  it('vazias e nulas são descartadas', () => {
    expect(rotulosPosicoes(['R12', '', '  ', null, undefined])).toEqual(['R12'])
  })
  it('lista ausente', () => {
    expect(rotulosPosicoes(null)).toEqual([])
    expect(rotulosPosicoes(undefined)).toEqual([])
  })
})

describe('as posições entram no alerta de defeito', () => {
  it('uma linha só, separadas por vírgula, entre a abertura e a regra', () => {
    expect(textoDoEnvio('alerta', { ...DEFEITO, posicoes: ['R12', 'C47', 'R12'] })).toBe(
      `${CABECALHO}\nPosições: R12 (2x), C47\n${RODAPE}`,
    )
  })
  it('uma posição só usa o rótulo no singular', () => {
    expect(textoDoEnvio('alerta', { ...DEFEITO, posicoes: ['R12'] })).toBe(
      `${CABECALHO}\nPosição: R12\n${RODAPE}`,
    )
  })
  it('depois da linha da OP, quando a ordem está gravada', () => {
    const t = textoDoEnvio('alerta', { ...DEFEITO, pmo: 'PMOG01', op: '8504', posicoes: ['R12'] })
    expect(t).toBe(`${CABECALHO}\nOP PMOG01/8504\nPosição: R12\n${RODAPE}`)
  })
  it('o lembrete leva as posições junto', () => {
    // Empate na contagem ordena pelo designador, então C47 vem antes de R12.
    expect(textoDoEnvio('lembrete', { ...DEFEITO, posicoes: ['R12', 'C47'] })).toContain('\nPosições: C47, R12\n')
  })
})

describe('sem posição registrada, a mensagem não fica com rabo', () => {
  it('campo ausente (linha antiga da fila) sai como antes', () => {
    expect(textoDoEnvio('alerta', DEFEITO)).toBe(`${CABECALHO}\n${RODAPE}`)
  })
  it('lista vazia não vira "Posições: "', () => {
    const t = textoDoEnvio('alerta', { ...DEFEITO, posicoes: [] })
    expect(t).toBe(`${CABECALHO}\n${RODAPE}`)
    expect(t).not.toContain('Posi')
  })
  it('lista só com posições em branco também não vira linha', () => {
    expect(textoDoEnvio('alerta', { ...DEFEITO, posicoes: ['', '  ', null] })).toBe(`${CABECALHO}\n${RODAPE}`)
  })
  it('campo que não é array é ignorado', () => {
    expect(textoDoEnvio('alerta', { ...DEFEITO, posicoes: 'R12' })).toBe(`${CABECALHO}\n${RODAPE}`)
  })
})

describe('listaPosicoes — o corte em si, com orçamento explícito', () => {
  /** 10 designadores de 30 caracteres: a lista inteira dá 318; com n mostradas, 32n-2 + o aviso. */
  const ITENS = Array.from({ length: 10 }, (_, i) => `R${String(i).padStart(2, '0')}-PLACA-FACE-SUPERIOR-ZONA-X`)

  it('cabendo, sai a lista inteira', () => {
    expect(listaPosicoes(ITENS, 1000)).toBe(ITENS.join(', '))
  })
  it('uma de fora sai no singular', () => {
    // 9 mostradas + ', … e mais 1 posição' = 306; as 10 inteiras não cabem em 310.
    expect(listaPosicoes(ITENS, 310)).toBe(`${ITENS.slice(0, 9).join(', ')}, … e mais 1 posição`)
  })
  it('várias de fora saem no plural, com a conta certa', () => {
    const t = listaPosicoes(ITENS, 150)
    expect(t).toBe(`${ITENS.slice(0, 4).join(', ')}, … e mais 6 posições`)
    expect(t.length).toBeLessThanOrEqual(150)
  })
  it('orçamento que não cabe nem um item com o aviso: a linha inteira sai fora', () => {
    expect(listaPosicoes(ITENS, 30)).toBe('')
  })
  it('lista vazia', () => {
    expect(listaPosicoes([], 1000)).toBe('')
  })
})

describe('lista longa não estoura o limite da mensagem', () => {
  /** 400 posições distintas: muito mais do que cabe em 2000 caracteres. */
  const MUITAS = Array.from({ length: 400 }, (_, i) => `R${i + 1}`)

  it('o alerta cabe no limite', () => {
    const t = textoDoEnvio('alerta', { ...DEFEITO, posicoes: MUITAS })
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
  })
  it('o corte é honesto: diz quantas posições ficaram de fora', () => {
    const t = textoDoEnvio('alerta', { ...DEFEITO, posicoes: MUITAS })
    const m = /… e mais (\d+) posições$/m.exec(t)
    expect(m).not.toBeNull()
    const mostradas = t.split('\n').find((l) => l.startsWith('Posições: '))!.split(', ').length - 1
    expect(mostradas + Number(m![1])).toBe(MUITAS.length)
  })
  it('o LEMBRETE da lista longa também cabe — o cabeçalho dele entra depois', () => {
    const t = textoDoEnvio('lembrete', { ...DEFEITO, posicoes: MUITAS })
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
  })
  it('a REABERTURA da lista longa também cabe', () => {
    const t = textoDoEnvio('alerta', {
      ...DEFEITO,
      posicoes: MUITAS,
      reabertura: true,
      resolvida_por_nome: 'Ana Carolina de Souza Gestora da Produção',
      resolvida_em: '2026-09-17T16:45:00+00:00',
    })
    expect(t).toMatch(/^🔁 Reaberto/)
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
  })
  it('lista que cabe não é cortada', () => {
    const t = textoDoEnvio('alerta', { ...DEFEITO, posicoes: ['R12', 'C47', 'L3'] })
    expect(t).not.toContain('… e mais')
  })
})
