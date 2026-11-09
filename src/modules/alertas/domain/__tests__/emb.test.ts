import { describe, it, expect } from 'vitest'
import { textoEmb, type DivergenciaEmb } from '../emb'
import { LIMITE_MENSAGEM } from '../mensagens'

function div(o: Partial<DivergenciaEmb> = {}): DivergenciaEmb {
  return {
    numero: 1234,
    item: 'CAP-001',
    descricao: 'CAPACITOR 100UF',
    quantidadePedido: 500,
    quantidadeRecebida: 490,
    divergencia: '-10',
    justificativa: '',
    justificadaPorNome: '',
    ...o,
  }
}

describe('textoEmb', () => {
  it('a primeira linha diz a EMB e quantas divergências são (é o assunto do e-mail)', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div(), div({ numero: 1235, item: 'RES-002' })])
    expect(t.split('\n')[0]).toContain('EMB390')
    expect(t.split('\n')[0]).toContain('2 divergências')
  })

  it('concorda no singular', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div()])
    expect(t.split('\n')[0]).toContain('1 divergência')
  })

  it('mostra o item, o pedido, o recebido e a diferença', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div()])
    expect(t).toContain('CAP-001')
    expect(t).toContain('CAPACITOR 100UF')
    expect(t).toContain('500')
    expect(t).toContain('490')
    expect(t).toContain('-10')
  })

  it('mostra a justificativa e quem escreveu', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [
      div({ justificativa: 'Fornecedor avisou falta.', justificadaPorNome: 'Ana Gestora' }),
    ])
    expect(t).toContain('Fornecedor avisou falta.')
    expect(t).toContain('Ana Gestora')
  })

  it('marca em destaque quem NÃO foi justificado — é a que precisa de ação', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [div({ justificativa: '   ' })])
    expect(t).toContain('sem justificativa')
  })

  it('cabe no limite do Discord mesmo com muitas divergências', () => {
    const muitas = Array.from({ length: 300 }, (_, i) =>
      div({ numero: 1000 + i, item: `IT-${i}`, justificativa: 'x'.repeat(120) }),
    )
    const t = textoEmb('Fim de EMB', 'EMB390', muitas)
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    // O corte avisa quantas ficaram de fora, em vez de calar.
    expect(t).toMatch(/e mais \d+ (divergência|divergências)/)
  })

  // ⚠️ Decisão 5 da spec, CORRIGIDA EM 14/10/2026: toda EMB que fecha manda mensagem. A versão de
  // 09/10 deste teste só exigia "devolve só o cabeçalho", como defesa de um caso que o banco nunca
  // enfileirava. Hoje o banco enfileira a EMB limpa, e esta é a mensagem que a pessoa recebe.
  it('EMB sem divergência nenhuma avisa que fechou SEM divergência', () => {
    const t = textoEmb('Fim de EMB', 'EMB390', [])
    expect(t).toContain('EMB390')
    expect(t).toContain('sem divergência')
    expect(t).toContain('Fim de EMB')
    // Uma linha só: ela é o assunto do e-mail e não há lista para mostrar.
    expect(t.split('\n').length).toBe(1)
    // E NÃO sai pelo cabeçalho das divergências, que diria "0 divergências de quantidade" —
    // mensagem que soa como alerta de nada.
    expect(t).not.toContain('0 divergências')
  })
})

describe('textoEmb — com o link do relatório', () => {
  const URL = 'https://shopfloor.enterplak.com.br/recebimento/emb/EMB388CA'
  const muitas = (n: number) => Array.from({ length: n }, (_, i) => div({ numero: 2000 + i, item: `IT-${i}` }))

  it('até 3: todas (2 linhas cada), sem "… e mais", e o link no fim', () => {
    const t = textoEmb('Fim de EMB', 'EMB388CA', muitas(3), URL)
    expect(t.split('\n')).toEqual([
      '📦 EMB388CA fechou — 3 divergências de quantidade · Fim de EMB',
      '#2000 IT-0 CAPACITOR 100UF · pedido 500, recebido 490 (-10)',
      '   ↳ ⚠️ sem justificativa',
      '#2001 IT-1 CAPACITOR 100UF · pedido 500, recebido 490 (-10)',
      '   ↳ ⚠️ sem justificativa',
      '#2002 IT-2 CAPACITOR 100UF · pedido 500, recebido 490 (-10)',
      '   ↳ ⚠️ sem justificativa',
      `Ver relatório completo: ${URL}`,
    ])
  })

  it('19 divergências: as 3 primeiras, "… e mais 16 divergências" e o link', () => {
    const t = textoEmb('Fim de EMB', 'EMB388CA', muitas(19), URL)
    const linhas = t.split('\n')
    expect(linhas[0]).toBe('📦 EMB388CA fechou — 19 divergências de quantidade · Fim de EMB')
    expect(linhas.filter((l) => l.startsWith('#'))).toHaveLength(3)
    expect(linhas.slice(-2)).toEqual(['… e mais 16 divergências', `Ver relatório completo: ${URL}`])
    expect(linhas).toHaveLength(1 + 6 + 2)
  })

  it('4: "… e mais 1 divergência" no singular', () => {
    expect(textoEmb('Fim de EMB', 'EMB388CA', muitas(4), URL)).toContain('\n… e mais 1 divergência\nVer relatório')
  })

  it('a justificativa e quem justificou seguem na 2ª linha', () => {
    const t = textoEmb('Fim de EMB', 'EMB388CA', [div({ justificativa: 'Falta no fornecedor', justificadaPorNome: 'Ana' })], URL)
    expect(t).toContain('   ↳ Falta no fornecedor (Ana)\nVer relatório completo:')
  })

  it('justificativas enormes: menos de 3 e o "… e mais" conta o resto; cabe no limite', () => {
    const t = textoEmb('Fim de EMB', 'EMB388CA', muitas(5).map((d) => ({ ...d, justificativa: 'x'.repeat(900) })), URL)
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    const mostradas = t.split('\n').filter((l) => l.startsWith('#')).length
    expect(mostradas).toBeLessThan(3)
    expect(t).toContain(`… e mais ${5 - mostradas} divergências`)
    expect(t.endsWith(`Ver relatório completo: ${URL}`)).toBe(true)
  })

  it('EMB limpa continua com a linha única, sem link', () => {
    expect(textoEmb('Fim de EMB', 'EMB388CA', [], URL)).toBe(textoEmb('Fim de EMB', 'EMB388CA', []))
  })
})
