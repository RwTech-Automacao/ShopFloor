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
})
