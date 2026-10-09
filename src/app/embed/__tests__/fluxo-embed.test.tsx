import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OpItem } from '@/modules/shopfloor/infra/fluxo-repository'
import type { MensagemEmbed } from '@/shared/lib/mensagem-embed'

vi.mock('server-only', () => ({}))

const ORIGEM = 'https://dashboard.enterplak.com.br'

// A tela do Fluxo é a MESMA da rota normal; aqui ela vira mock pra afirmar com que props a página
// embutida a monta (a OP decodificada e o seletor oculto) — e pra afirmar que NÃO a monta quando o
// acesso é recusado.
interface PropsFluxoForm {
  ops: OpItem[]
  ordensDashboard: unknown[]
  opFixa?: { pmo: string; op: string }
  ocultarSeletor?: boolean
  modoTv?: boolean
  embed?: boolean
}
const { FluxoForm, getSessao, listarOrdens, listarTodasOrdens } = vi.hoisted(() => ({
  FluxoForm: vi.fn<(props: PropsFluxoForm) => null>(() => null),
  getSessao: vi.fn(),
  listarOrdens: vi.fn(),
  listarTodasOrdens: vi.fn(),
}))
vi.mock('@/app/(app)/shopfloor/fluxo/fluxo-form', () => ({ FluxoForm }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/fluxo-repository', () => ({ listarOrdens }))
vi.mock('@/modules/shopfloor/infra/pesquisa-repository', () => ({ listarTodasOrdens }))

import FluxoEmbedPage from '../fluxo/[pmo]/[op]/page'
import { EmbedPonte } from '../embed-ponte'

const OPS: OpItem[] = [
  { pmo: 'PMOC13', op: '2340/26', cliente: 'VMI', descricao: 'PLACA MONTADA', criadoEm: '2026-10-01T12:00:00Z' },
]

/** Sessão com as permissões do módulo shopfloor que o teste quiser. */
function sessao(permissoes: Record<string, boolean>) {
  return {
    usuarioId: 'u1',
    nome: 'Dashboard',
    email: 'dashboard@enterplak.com.br',
    perfil: { id: 'p1', nome: 'Dashboard (somente leitura)', permissoes: {}, porModulo: { shopfloor: permissoes }, sistema: false },
  }
}

/** A página recebe `params` como Promise (Next 16) e os segmentos vêm CODIFICADOS da URL. */
const abrir = (pmo = 'PMOC13', op = '2340%2F26', modo?: string | string[]) =>
  FluxoEmbedPage({
    params: Promise.resolve({ pmo, op }),
    searchParams: Promise.resolve(modo === undefined ? {} : { modo }),
  })

// No jsdom `window.parent === window`; trocar o método cobre as duas pontas.
const avisarPai = vi.fn<(mensagem: MensagemEmbed, origem?: string) => void>()
const postMessageReal = window.parent.postMessage

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DASHBOARD_ORIGIN', ORIGEM)
  window.parent.postMessage = avisarPai as unknown as typeof window.postMessage
  getSessao.mockResolvedValue(sessao({ visualizar: true }))
  listarOrdens.mockResolvedValue(OPS)
  listarTodasOrdens.mockResolvedValue([])
})

afterEach(() => {
  window.parent.postMessage = postMessageReal
  vi.unstubAllEnvs()
})

/** Toda mensagem desta feature vai para a origem do dashboard — nunca para `*`. */
function origensUsadas() {
  return avisarPai.mock.calls.map((c) => c[1])
}

describe('/embed/fluxo/[pmo]/[op] — sessão', () => {
  it('sem sessão: 200 com "Conectando…", avisa login-required e NÃO monta o fluxo', async () => {
    getSessao.mockResolvedValue(null)
    render(await abrir())

    expect(screen.getByText(/Conectando…/)).toBeInTheDocument()
    expect(FluxoForm).not.toHaveBeenCalled()
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:login-required' }, ORIGEM)
  })

  it('sem sessão não consulta o banco', async () => {
    getSessao.mockResolvedValue(null)
    render(await abrir())
    expect(listarOrdens).not.toHaveBeenCalled()
    expect(listarTodasOrdens).not.toHaveBeenCalled()
  })

  it('sem `shopfloor: visualizar`: não monta o fluxo e avisa error/forbidden', async () => {
    getSessao.mockResolvedValue(sessao({ editar: true }))
    render(await abrir())

    expect(FluxoForm).not.toHaveBeenCalled()
    expect(listarOrdens).not.toHaveBeenCalled()
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:error', code: 'forbidden' }, ORIGEM)
  })
})

describe('/embed/fluxo/[pmo]/[op] — a OP', () => {
  it('OP existente: monta o FluxoForm com a OP fixa DECODIFICADA e o seletor oculto', async () => {
    render(await abrir('PMOC13', '2340%2F26'))

    expect(FluxoForm).toHaveBeenCalledTimes(1)
    const props = FluxoForm.mock.calls[0]![0]
    // Valor EXATO: sem o decode a OP chegaria como "2340%2F26" e nenhuma busca casaria.
    expect(props.opFixa).toEqual({ pmo: 'PMOC13', op: '2340/26' })
    expect(props.ocultarSeletor).toBe(true)
    expect(props.ops).toBe(OPS)
  })

  it('o PMO também vem decodificado', async () => {
    listarOrdens.mockResolvedValue([{ ...OPS[0]!, pmo: 'PMO C13' }])
    render(await abrir('PMO%20C13', '2340%2F26'))

    const props = FluxoForm.mock.calls[0]![0]
    expect(props.opFixa).toEqual({ pmo: 'PMO C13', op: '2340/26' })
  })

  it('OP existente avisa o pai que o fluxo está pronto', async () => {
    render(await abrir())
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:ready' }, ORIGEM)
  })

  it('OP inexistente: "OP não encontrada", avisa op-not-found e não monta o fluxo', async () => {
    render(await abrir('PMOC13', '9999%2F99'))

    expect(screen.getByText(/OP não encontrada/)).toBeInTheDocument()
    expect(FluxoForm).not.toHaveBeenCalled()
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:error', code: 'op-not-found' }, ORIGEM)
  })

  it('segmento mal codificado não explode: vira OP não encontrada', async () => {
    render(await abrir('PMOC13', '%E0%A4%A'))

    expect(screen.getByText(/OP não encontrada/)).toBeInTheDocument()
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:error', code: 'op-not-found' }, ORIGEM)
  })
})

describe('/embed/fluxo/[pmo]/[op] — a ponte com o pai', () => {
  it('toda mensagem vai para a origem do dashboard, nunca para "*"', async () => {
    render(await abrir())
    getSessao.mockResolvedValue(null)
    render(await abrir())
    getSessao.mockResolvedValue(sessao({ editar: true }))
    render(await abrir())

    expect(avisarPai).toHaveBeenCalledTimes(3)
    expect(origensUsadas()).toEqual([ORIGEM, ORIGEM, ORIGEM])
    expect(origensUsadas()).not.toContain('*')
  })

  it('sem DASHBOARD_ORIGIN NÃO manda mensagem nenhuma (não existe alvo seguro)', async () => {
    vi.stubEnv('DASHBOARD_ORIGIN', '')
    render(await abrir())

    expect(FluxoForm).toHaveBeenCalledTimes(1) // a tela funciona; só o aviso ao pai cala
    expect(avisarPai).not.toHaveBeenCalled()
  })

  it('sem DASHBOARD_ORIGIN também cala nas telas de recusa', async () => {
    vi.stubEnv('DASHBOARD_ORIGIN', '')
    getSessao.mockResolvedValue(null)
    render(await abrir())

    expect(screen.getByText(/Conectando…/)).toBeInTheDocument()
    expect(avisarPai).not.toHaveBeenCalled()
  })
})

describe('/embed/fluxo/[pmo]/[op] — ?modo=tv', () => {
  const props = () => FluxoForm.mock.calls[0]![0]

  it('lê ?modo=tv e liga o Modo TV no fluxo', async () => {
    render(await abrir('PMOC13', '2340%2F26', 'tv'))
    expect(props().modoTv).toBe(true)
    expect(props().embed).toBe(true)
    expect(props().opFixa).toEqual({ pmo: 'PMOC13', op: '2340/26' })
    expect(props().ocultarSeletor).toBe(true) // o embed continua sem seletor
  })

  it('sem o parâmetro: Modo TV desligado (tela normal)', async () => {
    render(await abrir())
    expect(props().modoTv).toBe(false)
  })

  // Decisão do usuário (09/10): o embed esconde os três controles SEMPRE. A página tem de passar
  // `embed` mesmo sem o parâmetro (e com valor desconhecido).
  it('passa embed mesmo sem o parâmetro (esconder no hover não depende de ?modo=tv)', async () => {
    render(await abrir())
    expect(props().embed).toBe(true)
    expect(props().modoTv).toBe(false)
  })

  it('valor desconhecido não liga (?modo=foo) e o embed segue ligado', async () => {
    render(await abrir('PMOC13', '2340%2F26', 'foo'))
    expect(props().modoTv).toBe(false)
    expect(props().embed).toBe(true)
  })

  it('parâmetro repetido: vale o primeiro', async () => {
    render(await abrir('PMOC13', '2340%2F26', ['tv', 'foo']))
    expect(props().modoTv).toBe(true)
  })

  it('sf-embed:ready continua saindo nos dois casos', async () => {
    render(await abrir('PMOC13', '2340%2F26', 'tv'))
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:ready' }, ORIGEM)
    avisarPai.mockClear()
    render(await abrir())
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:ready' }, ORIGEM)
  })

  it('?modo=tv não afrouxa nada: sem sessão ainda não monta o fluxo', async () => {
    getSessao.mockResolvedValue(null)
    render(await abrir('PMOC13', '2340%2F26', 'tv'))
    expect(FluxoForm).not.toHaveBeenCalled()
  })
})

describe('EmbedPonte', () => {
  it('manda o tipo sem `code` quando não há código', () => {
    render(<EmbedPonte origem={ORIGEM} tipo="sf-embed:ready" />)
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:ready' }, ORIGEM)
  })

  it('manda o `code` junto quando há código', () => {
    render(<EmbedPonte origem={ORIGEM} tipo="sf-embed:error" codigo="inactive" />)
    expect(avisarPai).toHaveBeenCalledWith({ type: 'sf-embed:error', code: 'inactive' }, ORIGEM)
  })

  it('origem vazia → nenhuma mensagem', () => {
    render(<EmbedPonte origem="" tipo="sf-embed:error" codigo="forbidden" />)
    expect(avisarPai).not.toHaveBeenCalled()
  })

  it('não renderiza nada visível', () => {
    const { container } = render(<EmbedPonte origem={ORIGEM} tipo="sf-embed:ready" />)
    expect(container).toBeEmptyDOMElement()
  })
})
