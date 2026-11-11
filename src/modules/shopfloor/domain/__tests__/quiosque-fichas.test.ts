import { describe, expect, it } from 'vitest'
import {
  chaveDoResponsavel,
  escaparHtml,
  fichaDaPendencia,
  htmlQuiosqueFichas,
  pendenciasComFicha,
  type FichaComQr,
  type PendenciaFicha,
} from '../quiosque-fichas'
import { ehRotaDoQuiosqueDeFichas } from '../rotas-quiosque'

const LINHA_CAIXA = {
  pmo: 'PMOF52_F', op: '8682_F', tipo: 'caixa', codigo: 'CX[1][160]8682_F-PMOF52_F', seq: 1, pecas: 160,
  lote_id: null, amostra: null, ja_lancadas: 0, em: '2026-11-06T00:30:00Z',
}
const LINHA_LOTE = {
  pmo: 'PMOX1', op: '8700', tipo: 'lote', codigo: 'LOTE[03ec5112][6]', seq: null, pecas: 6,
  lote_id: '03ec5112-0000-4000-8000-000000000000', amostra: 2, ja_lancadas: 0, em: '2026-11-07T12:00:00Z',
}
const LINHA_PECA = { ...LINHA_CAIXA, tipo: 'peca', codigo: 'AVULSAS', em: '2026-11-08T12:00:00Z' }

const QR = 'data:image/png;base64,AAAA'

describe('ehRotaDoQuiosqueDeFichas', () => {
  it('a rota exata, com ou sem uma barra final', () => {
    expect(ehRotaDoQuiosqueDeFichas('/quiosque/fichas')).toBe(true)
    expect(ehRotaDoQuiosqueDeFichas('/quiosque/fichas/')).toBe(true)
  })
  it('nada além dela', () => {
    expect(ehRotaDoQuiosqueDeFichas('/quiosque/fichasx')).toBe(false)
    expect(ehRotaDoQuiosqueDeFichas('/quiosque/fichas/x')).toBe(false)
    expect(ehRotaDoQuiosqueDeFichas('/quiosque')).toBe(false)
  })
})

describe('pendenciasComFicha', () => {
  it('fica só com caixa e lote (peça avulsa não tem ficha), a mais nova primeiro', () => {
    const r = pendenciasComFicha([LINHA_CAIXA, LINHA_PECA, LINHA_LOTE])
    expect(r.map((p) => p.codigo)).toEqual(['LOTE[03ec5112][6]', 'CX[1][160]8682_F-PMOF52_F'])
    expect(r[0]).toEqual({
      pmo: 'PMOX1', op: '8700', tipo: 'lote', codigo: 'LOTE[03ec5112][6]', pecas: 6,
      loteId: '03ec5112-0000-4000-8000-000000000000', em: '2026-11-07T12:00:00Z',
    })
  })
  it('sem data vai pro fim; linha malformada e resposta que não é lista são descartadas', () => {
    const r = pendenciasComFicha([{ ...LINHA_CAIXA, codigo: 'CX[2]', em: null }, null, { tipo: 'caixa' }, LINHA_CAIXA])
    expect(r.map((p) => p.codigo)).toEqual(['CX[1][160]8682_F-PMOF52_F', 'CX[2]'])
    expect(pendenciasComFicha(null)).toEqual([])
  })
})

describe('chaveDoResponsavel', () => {
  it('caixa pergunta pelo código; lote, pelo lote_id', () => {
    const [lote, caixa] = pendenciasComFicha([LINHA_CAIXA, LINHA_LOTE]) as [PendenciaFicha, PendenciaFicha]
    expect(chaveDoResponsavel(caixa)).toBe('CX[1][160]8682_F-PMOF52_F')
    expect(chaveDoResponsavel(lote)).toBe('03ec5112-0000-4000-8000-000000000000')
    expect(chaveDoResponsavel({ ...lote, loteId: null })).toBeNull()
  })
})

describe('fichaDaPendencia', () => {
  it('monta a ficha com produto/quantidade da OP e o responsável', () => {
    const [p] = pendenciasComFicha([LINHA_CAIXA]) as [PendenciaFicha]
    expect(fichaDaPendencia(p, { descricao: 'FONTE 12V', qtd: 1000 }, 'Tiago')).toEqual({
      unidade: 'caixa',
      codigo: 'CX[1][160]8682_F-PMOF52_F',
      dataProducao: new Date('2026-11-06T00:30:00Z'),
      produto: 'FONTE 12V',
      quantidadeOp: 1000,
      pmo: 'PMOF52_F',
      op: '8682_F',
      quantidadeApontada: 160,
      responsavel: 'Tiago',
    })
  })
  it('sem OP e sem responsável: campos vazios, nunca erro', () => {
    const [p] = pendenciasComFicha([{ ...LINHA_CAIXA, em: null }]) as [PendenciaFicha]
    const f = fichaDaPendencia(p, null, null)
    expect(f.produto).toBe('')
    expect(f.quantidadeOp).toBeNull()
    expect(f.dataProducao).toBeNull()
    expect(f.responsavel).toBe('')
  })
})

describe('escaparHtml', () => {
  it('escapa os cinco caracteres perigosos', () => {
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('htmlQuiosqueFichas', () => {
  const AGORA = new Date('2026-11-09T17:05:30Z') // 14:05:30 em São Paulo
  const [p] = pendenciasComFicha([LINHA_CAIXA]) as [PendenciaFicha]
  const ficha: FichaComQr = { dados: fichaDaPendencia(p, { descricao: 'FONTE 12V', qtd: 1000 }, 'Tiago'), qr: QR }

  it('página completa, com recarga de 30 s e sem JavaScript', () => {
    const h = htmlQuiosqueFichas({ tipo: 'ok', fichas: [ficha], total: 1, agora: AGORA })
    expect(h.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(h).toContain('<meta http-equiv="refresh" content="30">')
    expect(h).toContain('<meta charset="utf-8">')
    expect(h).not.toMatch(/<script/i)
    expect(h).not.toMatch(/var\(--|display:\s*grid|\bgap:|clamp\(/)
  })

  it('cada ficha leva o QR embutido, o código e os campos da ficha do Discord', () => {
    const h = htmlQuiosqueFichas({ tipo: 'ok', fichas: [ficha], total: 1, agora: AGORA })
    expect(h).toContain(`src="${QR}"`)
    expect(h).toContain('CX[1][160]8682_F-PMOF52_F')
    for (const t of ['Data de produção', '05/11/2026', 'FONTE 12V', 'Quantidade da OP', '1.000', 'PMOF52_F', '8682_F',
      'Quantidade apontada', '160', 'Responsável', 'Tiago']) {
      expect(h).toContain(t)
    }
    expect(h).toContain('Esperando confirmação (1)')
    expect(h).toContain('09/11/2026')
    expect(h).toContain('14:05:30')
  })

  it('escapa o que vem do banco', () => {
    const malicioso: FichaComQr = {
      dados: { ...ficha.dados, produto: '<script>alert(1)</script>', responsavel: '"><img src=x>' },
      qr: QR,
    }
    const h = htmlQuiosqueFichas({ tipo: 'ok', fichas: [malicioso], total: 1, agora: AGORA })
    expect(h).not.toContain('<script>alert(1)</script>')
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(h).not.toContain('"><img src=x>')
  })

  it('mais do que o limite: avisa "Mostrando N de M"', () => {
    const h = htmlQuiosqueFichas({ tipo: 'ok', fichas: [ficha], total: 75, agora: AGORA })
    expect(h).toContain('Mostrando 1 de 75.')
    expect(h).toContain('Esperando confirmação (75)')
  })

  it('fila vazia: a frase clara e a hora da última atualização', () => {
    const h = htmlQuiosqueFichas({ tipo: 'ok', fichas: [], total: 0, agora: AGORA })
    expect(h).toContain('Nenhuma caixa ou lote esperando confirmação.')
    expect(h).toContain('14:05:30')
    expect(h).not.toContain('class="ficha"')
  })

  it('erro de leitura: diz que não carregou (nunca "nenhuma") e continua recarregando', () => {
    const h = htmlQuiosqueFichas({ tipo: 'erro', agora: AGORA })
    expect(h).toContain('Não foi possível carregar a lista agora.')
    expect(h).not.toContain('Nenhuma caixa')
    expect(h).toContain('<meta http-equiv="refresh" content="30">')
  })
})
