import { describe, expect, it, vi } from 'vitest'
import { estadoDaOp } from '../../domain/estado-op'
import { configDoAmbiente } from '../config'
import { ClienteCompels } from '../cliente'
import { GerenciadorToken } from '../token'

const config = configDoAmbiente({ COMPELS_EZPOINT_USUARIO: 'u', COMPELS_EZPOINT_SENHA: 'p' })
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

const tokenFixo = (): GerenciadorToken => {
  const g = new GerenciadorToken(config, (async () => json({}, 500)) as unknown as typeof fetch)
  vi.spyOn(g, 'obter').mockResolvedValue('TOKEN-DE-TESTE')
  vi.spyOn(g, 'invalidar')
  return g
}

const OP_8697_DETALHE = {
  data: {
    id: 13075, numero: 8697, status: 'Produzida', tipoPropriedade: 0, quantidade: 10, negociante: { id: 1679 },
    composicaoProduto: { item: { id: 22690, codigo: 'PMOC57', unidade: { codigo: 'UN' } } },
  },
}
const emp = (q: number) => ({ quantidade: q, quantidadeEstornar: 0, situacao: 'Empenhada' })
const apont = (q: number) => ({ quantidadeProduzida: q, quantidadeCancelada: 0 })

function fingirCompels(extra: Record<string, () => Response> = {}) {
  const chamadas: { url: string; init: RequestInit }[] = []
  const buscar = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = String(url).replace('https://api.erpeasy.compels.net', '')
    chamadas.push({ url: u, init })
    const chave = Object.keys(extra).find((k) => u.startsWith(k))
    const resposta = chave ? extra[chave] : undefined
    if (resposta) return resposta()
    if (u.startsWith('/ordemProducaoSimples/findAllFilter')) {
      return json({ data: [{ id: 99999, numero: 86970 }, { id: 13075, numero: 8697 }] })
    }
    if (u.startsWith('/ordemProducaoSimples/findById')) return json(OP_8697_DETALHE)
    if (u.startsWith('/empenho/findByOrdemProducaoId')) return json([emp(4), emp(1), emp(5)])
    if (u.startsWith('/requisicaoOrdemProducao/findByOrdemProducaoId')) return json({ data: [emp(4), emp(1), emp(5)], success: true })
    if (u.startsWith('/apontamentoOrdemProducao/findByOrdemProducaoId')) {
      return json({ data: [apont(4), apont(1), apont(3), apont(2)], success: true })
    }
    return json({}, 404)
  }) as unknown as typeof fetch
  return { buscar, chamadas }
}

describe('ClienteCompels', () => {
  it('GET e chamadas sem corpo levam Content-Type JSON (o Compels responde 415 sem ele); formulário mantém o seu', async () => {
    const { buscar, chamadas } = fingirCompels()
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    const op = await c.buscarOp(8697)
    await c.lerOp(op!)
    const cabecalho = (inicio: string) =>
      chamadas.find((x) => x.url.startsWith(inicio))?.init.headers as Record<string, string>
    expect(cabecalho('/empenho/findByOrdemProducaoId')).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' })
    expect(cabecalho('/ordemProducaoSimples/findAllFilter')['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('acha a OP pelo número EXATO e lê o cadastro (unidade, produto, tipo de propriedade)', async () => {
    const { buscar, chamadas } = fingirCompels()
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    const op = await c.buscarOp(8697)
    expect(op).toEqual({
      id: 13075, numero: 8697, status: 'Produzida', tipoPropriedade: 0, quantidade: 10, produtoId: 22690,
      negocianteId: 1679, codigoItem: 'PMOC57', unidade: 'UN',
    })
    // o detalhe foi pedido pelo id certo, não pelo da outra OP parecida
    const detalhe = chamadas.find((x) => x.url.startsWith('/ordemProducaoSimples/findById'))
    expect(String((detalhe?.init.body as URLSearchParams).get('id'))).toBe('13075')
    // todas as chamadas levam o Bearer
    expect(chamadas.every((x) => (x.init.headers as Record<string, string>).Authorization === 'Bearer TOKEN-DE-TESTE')).toBe(true)
  })

  it('OP que não existe devolve null', async () => {
    const { buscar } = fingirCompels({ '/ordemProducaoSimples/findAllFilter': () => json({ data: [] }) })
    expect(await new ClienteCompels(config, tokenFixo(), buscar).buscarOp(1)).toBeNull()
  })

  it('lê o estado da OP pelas listas: 10 empenhadas, 10 requisitadas, 10 apontadas', async () => {
    const { buscar } = fingirCompels()
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    const op = await c.buscarOp(8697)
    const estado = estadoDaOp(await c.lerOp(op!))
    expect(estado).toMatchObject({ empenhada: 10, requisitada: 10, apontada: 10, quantidadeOp: 10, temPendencia: false })
  })

  it('401 renova o token e tenta de novo uma vez', async () => {
    let n = 0
    const { buscar } = fingirCompels({
      '/ordemProducaoSimples/findAllFilter': () => (n++ === 0 ? json({}, 401) : json({ data: [] })),
    })
    const token = tokenFixo()
    expect(await new ClienteCompels(config, token, buscar).buscarOp(1)).toBeNull()
    expect(token.invalidar).toHaveBeenCalledTimes(1)
    expect(n).toBe(2)
  })

  it('401 duas vezes não entra em laço: falha', async () => {
    const { buscar } = fingirCompels({ '/ordemProducaoSimples/findAllFilter': () => json({}, 401) })
    await expect(new ClienteCompels(config, tokenFixo(), buscar).buscarOp(1)).rejects.toThrow('HTTP 401')
  })

  it('trava: 201 é nossa; 400 "sendo acessado" vira op_em_uso (tenta de novo)', async () => {
    const livre = fingirCompels({ '/lock/eng.ordemproducaosimples/': () => new Response(null, { status: 201 }) })
    expect(await new ClienteCompels(config, tokenFixo(), livre.buscar).adquirirTrava(13075)).toMatchObject({ ok: true })

    const ocupada = fingirCompels({
      '/lock/eng.ordemproducaosimples/': () =>
        json({ message: 'Este registro está sendo acessado pelo usuário <b>fulano</b>!' }, 400),
    })
    expect(await new ClienteCompels(config, tokenFixo(), ocupada.buscar).adquirirTrava(13075)).toMatchObject({
      ok: false, codigo: 'op_em_uso', tentarDeNovo: true,
    })
  })

  it('libera a trava com DELETE no endereço certo', async () => {
    const { buscar, chamadas } = fingirCompels({ '/lock/release/': () => json({}) })
    await new ClienteCompels(config, tokenFixo(), buscar).liberarTrava(13075)
    expect(chamadas[0]?.url).toBe('/lock/release/eng.ordemproducaosimples/13075')
    expect(chamadas[0]?.init.method).toBe('DELETE')
  })

  it('consulta o saldo do item pela tela Movimento de Item: pede os itens zerados e só aceita o código exato', async () => {
    const { buscar, chamadas } = fingirCompels({
      '/itemMovimento/findFilter': () => json({
        data: [
          { item: { codigo: 'PRT4461', descricao: 'OUTRO', unidade: { codigo: 'UN' } }, saldoItemEstoqueProprio: 99, saldoItemPendencia: 0, saldoItemEstoqueEmTerceiros: 0, saldoItemEstoqueDeTerceiros: 0 },
          { item: { codigo: 'PRT446', descricao: ' PLACA ', unidade: { codigo: 'UN' } }, saldoItemEstoqueProprio: 28, saldoItemPendencia: 1, saldoItemEstoqueEmTerceiros: 2, saldoItemEstoqueDeTerceiros: 3 },
        ],
      }),
    })
    const saldo = await new ClienteCompels(config, tokenFixo(), buscar).consultarSaldoItem(' prt446 ')
    expect(saldo).toEqual({ codigo: 'PRT446', descricao: 'PLACA', unidade: 'UN', proprio: 28, pendencia: 1, emTerceiros: 2, deTerceiros: 3 })

    const corpo = chamadas.find((c) => c.url.startsWith('/itemMovimento/findFilter'))!.init.body as URLSearchParams
    const filtro = JSON.parse(corpo.get('filter')!) as { codigo: string; exibeItensComSaldoZerado: boolean }
    expect(filtro.codigo).toBe('prt446')
    expect(filtro.exibeItensComSaldoZerado).toBe(true)
  })

  it('pagar pendência: lê o detalhe nos endereços da tela e grava com JSON puro (não jsonData=)', async () => {
    const { buscar, chamadas } = fingirCompels({
      '/empenho/findById/7241': () => json({ id: 7241 }),
      '/requisicaoOrdemProducao/findById': () => json({ data: { id: 18510 }, success: true }),
      '/empenho/pagarPendencia': () => json({ message: 'Processo realizado com sucesso. Consulte a situação do Empenho.' }),
      '/requisicaoOrdemProducao/pagarPendencia': () => json({ success: false, msg: 'Saldo insuficiente' }),
    })
    const c = new ClienteCompels(config, tokenFixo(), buscar)
    expect(await c.lerEmpenho(7241)).toEqual({ id: 7241 })
    expect(await c.lerRequisicao(18510)).toEqual({ data: { id: 18510 }, success: true })
    const req = chamadas.find((x) => x.url.startsWith('/requisicaoOrdemProducao/findById'))!
    expect((req.init.body as URLSearchParams).get('id')).toBe('18510')

    expect(await c.pagarPendenciaEmpenho({ id: '7241' })).toEqual({
      ok: true, mensagem: 'Processo realizado com sucesso. Consulte a situação do Empenho.',
    })
    const pg = chamadas.find((x) => x.url === '/empenho/pagarPendencia')!
    expect(pg.init.method).toBe('POST')
    expect(pg.init.body).toBe('{"id":"7241"}')
    expect((pg.init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    expect(await c.pagarPendenciaRequisicao({ id: '18510' })).toMatchObject({ ok: false, codigo: 'sem_saldo', mensagem: 'Saldo insuficiente' })
  })

  it('saldo por estoque: GET da linha expandida, data de Brasília dd/mm/aaaa, código exato', async () => {
    const { buscar, chamadas } = fingirCompels({
      '/estoque/consultaSaldoItemEstoque': () => json({
        results: [
          { item: { codigo: 'PMOC31' }, estoque: { codigo: 'PA', descricao: 'PRODUTO ACABADO' }, saldo: 14 },
          { item: { codigo: 'PMOC31' }, estoque: { codigo: 'EA', descricao: 'ESTOQUE DE ATIVO' }, saldo: 49 },
        ],
        metadata: { resultset: { count: 2 } },
      }),
    })
    // 02:00 UTC de 12/11 ainda é 11/11 em Brasília.
    const c = new ClienteCompels(config, tokenFixo(), buscar, () => Date.UTC(2026, 10, 12, 2, 0))
    expect(await c.consultarSaldoPorEstoque('PMOC31')).toEqual([
      { estoque: 'PA', descricao: 'PRODUTO ACABADO', saldo: 14 },
      { estoque: 'EA', descricao: 'ESTOQUE DE ATIVO', saldo: 49 },
    ])
    const u = new URL(`https://x${chamadas[0]!.url}`)
    expect(u.pathname).toBe('/estoque/consultaSaldoItemEstoque')
    expect(u.searchParams.get('codigoItem')).toBe('PMOC31')
    expect(u.searchParams.get('data')).toBe('11/11/2026')
    expect(chamadas[0]!.init.method ?? 'GET').toBe('GET')
  })

  it('item que não veio na resposta: null (não zero)', async () => {
    const { buscar } = fingirCompels({ '/itemMovimento/findFilter': () => json({ data: [] }) })
    expect(await new ClienteCompels(config, tokenFixo(), buscar).consultarSaldoItem('ZZZ')).toBeNull()
  })

  it('lerDescendentes: varre os números seguintes da mesma principal e devolve só quem descende da raiz', async () => {
    const LISTA: Record<number, Record<string, unknown>> = {
      8682: { id: 2, numero: 8682, status: 'Em Processo', nivel: 2, ordemProducaoMaeNumero: 8681, ordemProducaoPrincipalNumero: 8681 },
      8683: { id: 3, numero: 8683, status: 'Em Processo', nivel: 3, ordemProducaoMaeNumero: 8682, ordemProducaoPrincipalNumero: 8681 },
      8684: { id: 4, numero: 8684, status: 'Em Processo', nivel: 4, ordemProducaoMaeNumero: 8683, ordemProducaoPrincipalNumero: 8681 },
      8685: { id: 5, numero: 8685, status: 'Aberta', nivel: 2, ordemProducaoMaeNumero: 8681, ordemProducaoPrincipalNumero: 8681 },
      8686: { id: 6, numero: 8686, status: 'Aberta', nivel: 1, ordemProducaoMaeNumero: null, ordemProducaoPrincipalNumero: null },
    }
    const COD: Record<string, string> = { '2': 'PMOF52', '3': 'PRT706', '4': 'PRT705', '5': 'PMOF51', '6': 'OUTRA' }
    const { buscar } = fingirCompels({
      '/ordemProducaoSimples/findAllFilter': () => json({ data: [] }),
    })
    const buscarComArvore = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const u = String(url).replace('https://api.erpeasy.compels.net', '')
      const corpo = init.body as URLSearchParams | undefined
      if (u.startsWith('/ordemProducaoSimples/findAllFilter')) {
        const n = Number(JSON.parse(corpo!.get('filtro')!).numero)
        return json({ data: LISTA[n] ? [LISTA[n]] : [] })
      }
      if (u.startsWith('/ordemProducaoSimples/findById')) {
        return json({ data: { composicaoProduto: { item: { codigo: COD[corpo!.get('id')!], descricao: 'X' } } } })
      }
      return buscar(url, init)
    }) as unknown as typeof fetch
    const c = new ClienteCompels(config, tokenFixo(), buscarComArvore)
    const desc = await c.lerDescendentes(8682)
    expect(desc.map((n) => [n.numero, n.codigo])).toEqual([[8683, 'PRT706'], [8684, 'PRT705']])
    expect(await c.lerNoOp(9999)).toBeNull()
  })
})
