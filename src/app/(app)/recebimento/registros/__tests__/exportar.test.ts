// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RegistroRecebimento } from '@/modules/recebimento/infra/registros-repository'

vi.mock('server-only', () => ({}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { getSessao, listarTodosRegistros, carregarCamposFormulario } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  listarTodosRegistros: vi.fn(),
  carregarCamposFormulario: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/recebimento/infra/registros-repository', () => ({ listarTodosRegistros }))
vi.mock('@/modules/recebimento/infra/processo-detalhe-repository', () => ({ carregarCamposFormulario }))

import { GET } from '../exportar/route'

function sessao(permissoes: Record<string, boolean>) {
  return {
    usuarioId: 'u1',
    nome: 'Ana Gestora',
    email: 'ana@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Supervisor', permissoes: {}, porModulo: { recebimento: permissoes }, sistema: false },
  }
}

const REGISTRO: RegistroRecebimento = {
  id: 'l1',
  dataHora: '2026-09-24T12:30:00Z', // 09:30 em Brasília
  colaborador: 'João',
  processoId: 'p1',
  numero: 123,
  emb: 'EMB390',
  item: 'CAPJ91',
  descricao: 'CAPACITOR 100uF',
  fornecedor: 'Panasonic',
  fabricante: 'PANA',
  partNumber: 'ECA1HM101',
  passagem: { tipo: 'avanco', de: 'recebimento', para: 'qualidade', resultado: null },
  alteracoes: [
    { campo: 'quantidade_recebida', de: null, para: 490 },
    { campo: 'divergencia', de: null, para: '-10' },
  ],
}

function pedido(query = '') {
  return new Request(`https://shopfloor.enterplak.com.br/recebimento/registros/exportar${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(sessao({ visualizar: true }))
  listarTodosRegistros.mockResolvedValue({ linhas: [REGISTRO], truncado: false })
  carregarCamposFormulario.mockResolvedValue([
    { campo: 'quantidade_recebida', rotulo: 'Quantidade Recebida' },
    { campo: 'divergencia', rotulo: 'Divergência' },
  ])
})

describe('GET /recebimento/registros/exportar', () => {
  it('sem sessão devolve 403 e não consulta nada', async () => {
    getSessao.mockResolvedValue(null)
    const res = await GET(pedido())
    expect(res.status).toBe(403)
    expect(listarTodosRegistros).not.toHaveBeenCalled()
  })

  it('sem `recebimento: visualizar` devolve 403 e não consulta nada', async () => {
    getSessao.mockResolvedValue(sessao({ editar: true, administrar: true }))
    const res = await GET(pedido())
    expect(res.status).toBe(403)
    expect(listarTodosRegistros).not.toHaveBeenCalled()
  })

  it('permissão de outro módulo não serve', async () => {
    getSessao.mockResolvedValue({
      ...sessao({}),
      perfil: { id: 'p1', nome: 'Produção', permissoes: {}, porModulo: { shopfloor: { visualizar: true } }, sistema: false },
    })
    expect((await GET(pedido())).status).toBe(403)
  })

  it('usa os MESMOS filtros da tela (os parâmetros da URL)', async () => {
    await GET(pedido(
      '?emb=EMB390&item=CAPJ91&fornecedor=Panasonic&etapa=qualidade' +
      '&de=2026-09-01&ate=2026-09-24&colaborador=Ana&pagina=3&tamanho=250',
    ))
    expect(listarTodosRegistros).toHaveBeenCalledWith({
      emb: 'EMB390',
      item: 'CAPJ91',
      fornecedor: 'Panasonic',
      etapa: 'qualidade',
      // Data só-data ancorada em Brasília, igual à tela.
      de: '2026-09-01T00:00:00-03:00',
      ate: '2026-09-24T23:59:59.999-03:00',
      colaborador: 'Ana',
    })
  })

  it('etapa inválida na URL é ignorada, como na tela', async () => {
    await GET(pedido('?etapa=manutencao'))
    expect(listarTodosRegistros).toHaveBeenCalledWith({})
  })

  it('sai no padrão do ShopFloor: BOM UTF-8, separador ; e CRLF', async () => {
    const res = await GET(pedido())
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toContain('registros-recebimento-')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    // Os bytes crus: `Response.text()` descarta o BOM na decodificação, então ele só aparece aqui.
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const csv = new TextDecoder('utf-8').decode(bytes)
    const linhas = csv.split('\r\n')
    expect(linhas[0]).toBe(
      'Data;Hora;Colaborador;Processo;EMB;Item;Descrição;Fornecedor;Fabricante;Part number;Etapa;Alterações',
    )
    const celulas = linhas[1]!.split(';')
    // Data e hora em America/Sao_Paulo (o servidor roda em UTC).
    expect(celulas[0]).toBe('24/09/2026')
    expect(celulas[1]).toBe('09:30:00')
    expect(celulas[2]).toBe('João')
    expect(celulas[10]).toBe('Recebimento → Qualidade')
  })

  it('o que mudou sai com o rótulo do campo, não com o nome da coluna', async () => {
    const csv = await (await GET(pedido())).text()
    expect(csv).toContain('Quantidade Recebida:  → 490; Divergência:  → -10')
  })

  it('escapa fórmula de planilha no texto livre', async () => {
    listarTodosRegistros.mockResolvedValue({
      linhas: [{ ...REGISTRO, colaborador: '=SOMA(A1:A9)', descricao: '+CMD|calc', fabricante: '@ref' }],
      truncado: false,
    })
    const csv = await (await GET(pedido())).text()
    // Aspas simples: o Excel mostra como texto literal em vez de avaliar a fórmula.
    expect(csv).toContain("'=SOMA(A1:A9)")
    expect(csv).toContain("'+CMD|calc")
    expect(csv).toContain("'@ref")
  })

  it('envolve em aspas a célula que tem o separador ou aspas', async () => {
    listarTodosRegistros.mockResolvedValue({
      linhas: [{ ...REGISTRO, descricao: 'CAPACITOR; 100uF "SMD"' }],
      truncado: false,
    })
    const csv = await (await GET(pedido())).text()
    expect(csv).toContain('"CAPACITOR; 100uF ""SMD"""')
  })
})
