import { describe, expect, it, vi } from 'vitest'
import {
  configBaixaNf, confirmarSelecao, mensagensDeAviso, processarFila, MAX_FALHAS_SEGUIDAS,
  type FilaDaConfirmacao, type FilaDoCron, type ItemFila, type PortaBaixaNf,
} from '../baixar-nfs'

const nota = (id: number, numero: number, emissao = '2026-11-18') => ({
  id, numero, empresa: { id: 133 }, dataHoraEmissao: `${emissao} 10:00:00`, codigoRemetente: 'C1', razaoSocialNomeRemetente: 'ACME',
})
const comSaldo = {
  id: 1, quantidade: 2, unidade: 'UN', itemNotaICMS: { id: 9, quantidadeInterna: 2 },
  itemLote: { id: 5, item: { id: 7, rastreavel: false, codigo: 'PMOD44' }, itemLoteEstoque: { estoque: { codigo: 'PA' }, itemLoteEstoqueLocacao: { id: 3, saldo: 10 } } },
}
const semSaldo = { id: 2, quantidade: 0, itemNotaICMS: { id: 9, quantidadeInterna: 2 }, itemLote: null }
const rastreavel = { ...comSaldo, itemLote: { ...comSaldo.itemLote, item: { id: 7, rastreavel: true, codigo: 'PMOD44' } } }

const ok = { ok: true as const, mensagem: 'ok' }
const recusa = { ok: false as const, codigo: 'desconhecido' as const, mensagem: 'Compels recusou', tentarDeNovo: false }

function compels(notas: unknown[], itens: Record<number, unknown[]>) {
  const p = {
    listarNfsPendentes: vi.fn(async () => notas as Record<string, unknown>[]),
    itensDaNf: vi.fn(async (id: number) => ({ proprias: itens[id] ?? [], emTerceiros: [], deTerceiros: [] })),
    travarNf: vi.fn(async (): Promise<Awaited<ReturnType<PortaBaixaNf['travarNf']>>> => ({ ok: true as const, mensagem: '' })),
    liberarNf: vi.fn(async () => undefined),
    baixarNf: vi.fn(async (): Promise<Awaited<ReturnType<PortaBaixaNf['baixarNf']>>> => ok),
  }
  return p satisfies PortaBaixaNf
}

function filaConfirmacao(aguardando: ItemFila[] = []) {
  let n = aguardando.length
  return {
    aguardando: vi.fn(async () => aguardando),
    colocar: vi.fn(async (_n: unknown, r: { status: string }) => ({ posicao: r.status === 'aguardando' ? ++n : null })),
  } satisfies FilaDaConfirmacao
}

function filaCron(itens: ItemFila[]) {
  return {
    aguardando: vi.fn(async () => itens),
    tentativa: vi.fn(async () => undefined),
    finalizar: vi.fn(async () => undefined),
  } satisfies FilaDoCron
}

const item = (id: string, notaId: number, numero: number, tentativas = 0): ItemFila => ({ id, notaId, numero, cliente: 'C1 — ACME', tentativas })
const op = { usuario: 'ShopFloor' }

describe('confirmarSelecao', () => {
  it('na ordem marcada: com saldo baixa, sem saldo vai para a fila, manual recusa; trava sempre liberada', async () => {
    const c = compels([nota(1, 80), nota(2, 81), nota(3, 82)], { 1: [semSaldo], 2: [comSaldo], 3: [rastreavel] })
    const f = filaConfirmacao([item('x', 99, 70)])
    const r = await confirmarSelecao(c, f, [2, 1, 3], { ...op, modo: 'baixar' })
    expect(r.map((x) => [x.numero, x.resultado, x.posicao])).toEqual([
      [81, 'baixada', undefined], [80, 'na_fila', 2], [82, 'manual', undefined],
    ])
    expect(c.itensDaNf.mock.calls.map((a) => a[0])).toEqual([2, 1, 3])
    expect(c.baixarNf).toHaveBeenCalledTimes(1)
    expect(c.liberarNf).toHaveBeenCalledWith(2)
    expect(f.colocar).toHaveBeenCalledWith({ notaId: 2, numero: 81, cliente: 'C1 — ACME' }, expect.objectContaining({ status: 'baixada' }))
    expect(f.colocar).toHaveBeenCalledWith({ notaId: 1, numero: 80, cliente: 'C1 — ACME' }, expect.objectContaining({ status: 'aguardando', tentativas: 0 }))
  })

  it('simulação nunca trava nem baixa: registra "seria baixada"', async () => {
    const c = compels([nota(1, 80)], { 1: [comSaldo] })
    const f = filaConfirmacao()
    const r = await confirmarSelecao(c, f, [1], { ...op, modo: 'simular' })
    expect(r[0]).toMatchObject({ resultado: 'simulada', detalhe: 'simulação: seria baixada (2 × PMOD44)' })
    expect(c.travarNf).not.toHaveBeenCalled()
    expect(c.baixarNf).not.toHaveBeenCalled()
    expect(f.colocar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'simulada' }))
  })

  it('já na fila, não pendente mais: não mexe', async () => {
    const c = compels([nota(1, 80)], { 1: [comSaldo] })
    const f = filaConfirmacao([item('x', 1, 80)])
    const r = await confirmarSelecao(c, f, [1, 7], { ...op, modo: 'baixar' })
    expect(r.map((x) => x.resultado)).toEqual(['ja_na_fila', 'nao_pendente'])
    expect(c.baixarNf).not.toHaveBeenCalled()
    expect(f.colocar).not.toHaveBeenCalled()
  })

  it('nota aberta no Compels (trava recusada) vai para a fila sem baixar', async () => {
    const c = compels([nota(1, 80)], { 1: [comSaldo] })
    c.travarNf.mockResolvedValueOnce({ ok: false, codigo: 'op_em_uso', mensagem: 'em uso', tentarDeNovo: true })
    const f = filaConfirmacao()
    const r = await confirmarSelecao(c, f, [1], { ...op, modo: 'baixar' })
    expect(r[0]).toMatchObject({ resultado: 'na_fila', posicao: 1 })
    expect(c.baixarNf).not.toHaveBeenCalled()
    expect(c.liberarNf).not.toHaveBeenCalled()
  })

  it('baixa recusada ou com erro: fila com a mensagem e 1 tentativa; trava liberada', async () => {
    const c = compels([nota(1, 80), nota(2, 81)], { 1: [comSaldo], 2: [comSaldo] })
    c.baixarNf.mockResolvedValueOnce(recusa).mockRejectedValueOnce(new Error('caiu'))
    const f = filaConfirmacao()
    const r = await confirmarSelecao(c, f, [1, 2], { ...op, modo: 'baixar' })
    expect(r.map((x) => [x.resultado, x.detalhe])).toEqual([['na_fila', 'Compels recusou'], ['na_fila', 'caiu']])
    expect(f.colocar).toHaveBeenCalledWith(expect.anything(), { status: 'aguardando', mensagem: 'Compels recusou', tentativas: 1 })
    expect(c.liberarNf).toHaveBeenCalledTimes(2)
  })
})

describe('processarFila', () => {
  it('em ordem; sem saldo não trava as de trás; baixada fora sai da fila', async () => {
    const c = compels([nota(1, 80), nota(2, 81)], { 1: [semSaldo], 2: [comSaldo] })
    const f = filaCron([item('a', 1, 80, 2), item('b', 9, 90), item('c', 2, 81)])
    const r = await processarFila(c, f, { ...op, modo: 'baixar' })
    expect(r.notas.map((n) => [n.numero, n.resultado])).toEqual([[80, 'esperando'], [90, 'baixada_fora'], [81, 'baixada']])
    expect(f.tentativa).toHaveBeenCalledWith('a', { mensagem: 'ainda sem saldo no estoque PA', tentativas: 0 })
    expect(f.finalizar).toHaveBeenCalledWith('b', 'baixada_fora', expect.any(String))
    expect(f.finalizar).toHaveBeenCalledWith('c', 'baixada', expect.stringContaining('2 × PMOD44'))
    expect(c.liberarNf).toHaveBeenCalledWith(2)
  })

  it('simulação: sai da fila como simulada, sem travar nem baixar', async () => {
    const c = compels([nota(1, 80)], { 1: [comSaldo] })
    const f = filaCron([item('a', 1, 80)])
    await processarFila(c, f, { ...op, modo: 'simular' })
    expect(f.finalizar).toHaveBeenCalledWith('a', 'simulada', 'simulação: seria baixada (2 × PMOD44)')
    expect(c.travarNf).not.toHaveBeenCalled()
    expect(c.baixarNf).not.toHaveBeenCalled()
  })

  it(`falha soma tentativa; na ${MAX_FALHAS_SEGUIDAS}ª seguida vira falhou e sai; trava liberada mesmo com erro`, async () => {
    const c = compels([nota(1, 80), nota(2, 81)], { 1: [comSaldo], 2: [comSaldo] })
    c.baixarNf.mockResolvedValueOnce(recusa).mockRejectedValueOnce(new Error('caiu'))
    const f = filaCron([item('a', 1, 80, 0), item('b', 2, 81, MAX_FALHAS_SEGUIDAS - 1)])
    const r = await processarFila(c, f, { ...op, modo: 'baixar' })
    expect(r.notas.map((n) => n.resultado)).toEqual(['falha', 'falhou'])
    expect(f.tentativa).toHaveBeenCalledWith('a', { mensagem: 'Compels recusou', tentativas: 1 })
    expect(f.finalizar).toHaveBeenCalledWith('b', 'falhou', 'caiu')
    expect(c.liberarNf).toHaveBeenCalledTimes(2)
  })

  it('nota aberta no Compels: tenta de novo na próxima, sem contar falha; manual sai como falhou', async () => {
    const c = compels([nota(1, 80), nota(2, 81)], { 1: [comSaldo], 2: [rastreavel] })
    c.travarNf.mockResolvedValueOnce({ ok: false, codigo: 'op_em_uso', mensagem: 'em uso', tentarDeNovo: true })
    const f = filaCron([item('a', 1, 80, 3), item('b', 2, 81)])
    const r = await processarFila(c, f, { ...op, modo: 'baixar' })
    expect(r.notas.map((n) => n.resultado)).toEqual(['esperando', 'falhou'])
    expect(f.tentativa).toHaveBeenCalledWith('a', { mensagem: 'nota aberta no Compels: em uso', tentativas: 0 })
    expect(f.finalizar).toHaveBeenCalledWith('b', 'falhou', expect.stringContaining('baixar à mão'))
    expect(c.baixarNf).not.toHaveBeenCalled()
  })

  it('fila vazia não consulta o Compels', async () => {
    const c = compels([], {})
    expect((await processarFila(c, filaCron([]), { ...op, modo: 'baixar' })).notas).toEqual([])
    expect(c.listarNfsPendentes).not.toHaveBeenCalled()
  })
})

describe('configBaixaNf', () => {
  it('desligada sem modo; simular e baixar; sem data de corte', () => {
    expect(configBaixaNf({})).toBeNull()
    expect(configBaixaNf({ COMPELS_BAIXA_NF: 'talvez' })).toBeNull()
    expect(configBaixaNf({ COMPELS_BAIXA_NF: 'simular' })).toEqual({ modo: 'simular', usuario: 'ShopFloor' })
    expect(configBaixaNf({ COMPELS_BAIXA_NF: '1', COMPELS_BAIXA_NF_USUARIO: 'Fat' })).toEqual({ modo: 'baixar', usuario: 'Fat' })
  })
})

describe('mensagensDeAviso', () => {
  it('avisa baixada/simulada/falhou uma vez; esperando e falha intermediária nunca', () => {
    const resumo = {
      modo: 'baixar' as const,
      notas: [
        { numero: 90, resultado: 'baixada' as const, detalhe: '2 × PMOD44 — ok' },
        { numero: 91, resultado: 'esperando' as const, detalhe: 'sem saldo' },
        { numero: 92, resultado: 'falha' as const, detalhe: 'recusou' },
        { numero: 93, resultado: 'falhou' as const, detalhe: 'recusou 5 vezes' },
      ],
    }
    const ja = new Set<string>()
    expect(mensagensDeAviso(resumo, ja)).toEqual([
      '✅ NF baixada pela fila: **NF 90** — 2 × PMOD44 — ok',
      '❌ NF saiu da fila sem baixar: **NF 93** — recusou 5 vezes',
    ])
    expect(mensagensDeAviso(resumo, ja)).toEqual([])
  })
})
