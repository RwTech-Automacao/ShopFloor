import { describe, expect, it, vi } from 'vitest'

// Qualquer Server Action real chamada pela vitrine estoura aqui: a vitrine NÃO pode tocar o banco.
const proibida = vi.fn(() => { throw new Error('a vitrine chamou uma action real') })
vi.mock('@/modules/shopfloor/application/fluxo-actions', () => ({
  carregarFluxo: proibida, fluxoPeriodo: proibida, rotaSn: proibida, detalhePosto: proibida, historicoPosto: proibida,
  producaoPeriodo: proibida, burninDetalhe: proibida, embalagemCaixas: proibida, snsManutencao: proibida, opsComBipes: proibida,
}))
vi.mock('@/modules/shopfloor/application/pesquisa-actions', () => ({
  buscarHistoricoSN: proibida, carregarDefeitosDaOp: proibida, carregarResumoDefeitos: proibida,
}))
vi.mock('@/modules/shopfloor/application/dashboard-actions', () => ({ carregarDashboard: proibida }))
vi.mock('@/modules/shopfloor/application/estoque-compels-actions', () => ({
  lerEstoqueCompelsAction: proibida, lerPendenteCompelsAction: proibida,
}))

const { criarFonteVitrine, relogioDoLaco, MINUTOS_SIMULADOS_POR_SEGUNDO } = await import('../fonte-vitrine')
const { T_INICIO_LACO, T_FIM_LACO, PMO_DEMO, OP_DEMO, QTD_DEMO } = await import('@/modules/vitrine/domain/op-demo')

const AGORA = Date.parse('2026-11-16T14:00:00-03:00')
const fonte = criarFonteVitrine(relogioDoLaco(AGORA, () => AGORA))
const P = PMO_DEMO
const O = OP_DEMO

describe('fonte da vitrine', () => {
  it('responde todas as consultas do Fluxo sem chamar nenhuma action real', async () => {
    const fluxo = await fonte.carregarFluxo(P, O)
    expect(fluxo.ok).toBe(true)
    const umaHora = { ini: new Date(AGORA - 3600_000).toISOString(), fim: new Date(AGORA).toISOString() }
    const periodo = await fonte.fluxoPeriodo(P, O, [umaHora])
    expect(periodo.ok && Object.keys(periodo.postos).length).toBeGreaterThan(0)
    const rota = await fonte.rotaSn(P, O, 'DEMO000001')
    expect(rota.ok && rota.atual).toBeNull() // a 1ª peça já concluiu
    expect(rota.ok && rota.postos.length).toBe(12)
    const det = await fonte.detalhePosto(P, O, 'NQA')
    expect(det.ok).toBe(true)
    const hist = await fonte.historicoPosto(P, O, 'Printer', 0)
    expect(hist.ok && hist.linhas.length).toBe(100)
    expect(hist.ok && hist.temMais).toBe(true)
    const prod = await fonte.producaoPeriodo(P, O, 'Printer', null, null, 'dia')
    expect(prod.ok && prod.linhas.reduce((s, l) => s + l.qtd, 0)).toBe(QTD_DEMO)
    const prodHora = await fonte.producaoPeriodo(P, O, 'NQA', umaHora.ini, umaHora.fim, 'hora')
    expect(prodHora.ok && prodHora.linhas.every((l) => /^\d{2}\/\d{2} \d{2}h$/.test(l.rotulo))).toBe(true)
    expect((await fonte.burninDetalhe(P, O, 'Burn-in')).ok).toBe(true)
    const emb = await fonte.embalagemCaixas(P, O, 'Embalagem')
    expect(emb.ok && emb.itens[0]?.caixa).toMatch(/^CX\[\d+\]$/)
    expect(await fonte.snsManutencao(P, O)).toEqual({ ok: true, sns: [] })
    const ops = await fonte.opsComBipes(null, null)
    expect(ops?.[`${P}||${O}`]?.pct).toBeGreaterThan(90)
    const sn = await fonte.buscarHistoricoSN('demo000001')
    expect(sn.ok && sn.registros.length).toBe(13) // 12 postos + entrada do Burn-in
    expect(await fonte.carregarDefeitosDaOp(P, O)).toEqual({ ok: true, linhas: [], temMais: false })
    expect(await fonte.carregarResumoDefeitos(P, O)).toEqual({ ok: true, resumo: [] })
    const dash = await fonte.carregarDashboard(P, O, '', '')
    expect(dash.ok && dash.total).toBe(QTD_DEMO)
    const est = await fonte.lerEstoqueCompels(P)
    expect(est.tipo).toBe('ok')
    expect(await fonte.lerPendenteCompels(P, O)).toBeNull()
    expect(proibida).not.toHaveBeenCalled()
  })

  it('OP que não é a da vitrine: não encontrada', async () => {
    expect(await fonte.carregarFluxo('PMOC31', '8616')).toEqual({ ok: false, erro: 'OP não encontrada.' })
  })

  it('o bipe mais novo é "agora" (a tela não envelhece)', async () => {
    const hist = await fonte.historicoPosto(P, O, 'Almoxarifado', 0)
    const maisNovo = hist.ok ? Date.parse(hist.linhas[0]!.dataHora) : 0
    expect(AGORA - maisNovo).toBeLessThan(10 * 60_000)
  })
})

describe('relógio do laço', () => {
  it('começa no início do laço, anda e volta ao começo', () => {
    let agora = 0
    const r = relogioDoLaco(0, () => agora)
    expect(r.minuto()).toBe(T_INICIO_LACO)
    agora = 3000
    expect(r.minuto()).toBeCloseTo(T_INICIO_LACO + 3 * MINUTOS_SIMULADOS_POR_SEGUNDO)
    agora = ((T_FIM_LACO - T_INICIO_LACO) / MINUTOS_SIMULADOS_POR_SEGUNDO) * 1000
    expect(r.minuto()).toBeCloseTo(T_INICIO_LACO)
  })
})
