import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'

vi.mock('server-only', () => ({}))

const { push, salvar, carregarValores } = vi.hoisted(() => ({
  push: vi.fn(),
  salvar: vi.fn(),
  carregarValores: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))
vi.mock('@/modules/recebimento/application/justificar-divergencia', () => ({
  salvarJustificativaDivergencia: salvar,
}))
vi.mock('@/modules/recebimento/application/carregar-processos-grid', () => ({
  carregarValoresColuna: carregarValores,
}))

import { ProcessosGrid } from '../processos-grid'
import { decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import type { ColunaGrid } from '@/modules/recebimento/infra/processo-repository'

const colunas: ColunaGrid[] = [
  { campo: 'numero', rotulo: 'Número', tipo: 'numero' },
  { campo: 'status', rotulo: 'Status', tipo: 'texto' },
  { campo: 'divergencia', rotulo: 'Divergência', tipo: 'lista' },
]
const estado = decodificarEstadoGrid(undefined, colunas.map((c) => c.campo))

function linha(extra: Record<string, unknown>) {
  return {
    id: 'p1',
    numero: 101,
    status: 'aberto',
    divergencia: -5,
    divergencia_justificativa: '',
    divergencia_justificada_por_nome: '',
    divergencia_justificada_em: null,
    ...extra,
  }
}

/** A grade renderiza a tabela (desktop) E os cards (celular) — o CSS esconde um deles, o jsdom não.
 *  Os testes olham a tabela, que é a tela que o usuário vai usar para justificar. */
function tabela() {
  return within(screen.getByRole('table'))
}

function montar(linhas: Record<string, unknown>[], podeJustificar: boolean) {
  return render(
    <ProcessosGrid colunas={colunas} linhas={linhas} total={linhas.length} estado={estado} podeJustificar={podeJustificar} />,
  )
}

// O jsdom não tem ResizeObserver (a barra de rolagem do topo da tabela usa).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

beforeEach(() => {
  vi.clearAllMocks()
  salvar.mockResolvedValue({ ok: true })
  carregarValores.mockResolvedValue({ ok: true, valores: [] })
})

describe('selo da divergência', () => {
  it('mostra os três estados: ? sem justificativa, ✅ com, e nada sem divergência', () => {
    montar(
      [
        linha({ id: 'a', numero: 1, divergencia: -5, divergencia_justificativa: '' }),
        linha({ id: 'b', numero: 2, divergencia: 3, divergencia_justificativa: 'Fornecedor mandou a menos; reposição na semana que vem.' }),
        linha({ id: 'c', numero: 3, divergencia: 0, divergencia_justificativa: '' }),
      ],
      true,
    )
    const t = tabela()
    const pendentes = t.getAllByRole('button', { name: 'Divergência sem justificativa' })
    const justificadas = t.getAllByRole('button', { name: 'Divergência justificada' })
    expect(pendentes).toHaveLength(1)
    expect(pendentes[0]!).toHaveTextContent('?')
    expect(pendentes[0]!).toHaveAttribute('title', 'Sem justificativa — clique para explicar')
    expect(justificadas).toHaveLength(1)
    expect(justificadas[0]!).toHaveTextContent('✅')
    expect(justificadas[0]!.getAttribute('title')).toContain('Fornecedor mandou a menos')
    // a terceira linha (divergência 0) não ganhou selo: são só os 2 de cima
    expect(t.getAllByRole('button', { name: /^Divergência / })).toHaveLength(2)
  })

  it.each([
    ['zero', 0],
    ['nulo', null],
    ['vazio', ''],
  ])('divergência %s não tem selo, mesmo com texto de justificativa guardado', (_nome, valor) => {
    montar([linha({ divergencia: valor, divergencia_justificativa: 'texto antigo' })], true)
    expect(tabela().queryAllByRole('button', { name: /^Divergência / })).toHaveLength(0)
  })

  it('o selo não depende do status do processo (aberto ou finalizado)', () => {
    montar(
      [
        linha({ id: 'a', numero: 1, status: 'aberto' }),
        linha({ id: 'b', numero: 2, status: 'finalizado' }),
      ],
      true,
    )
    expect(tabela().getAllByRole('button', { name: 'Divergência sem justificativa' })).toHaveLength(2)
  })

  it('sem administrar o selo continua aparecendo (só a caixa é só leitura)', () => {
    montar([linha({})], false)
    expect(tabela().getAllByRole('button', { name: 'Divergência sem justificativa' })).toHaveLength(1)
  })
})

describe('diálogo de justificativa', () => {
  it('abrir mostra o texto anterior e quem escreveu por último, com a data', () => {
    montar(
      [
        linha({
          divergencia_justificativa: 'Faltaram 5 peças; fornecedor reenvia.',
          divergencia_justificada_por_nome: 'Maria Souza',
          divergencia_justificada_em: '2026-10-08T14:30:00Z',
        }),
      ],
      true,
    )
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência justificada' }))
    expect(screen.getByRole('textbox', { name: 'Justificativa da divergência' })).toHaveValue(
      'Faltaram 5 peças; fornecedor reenvia.',
    )
    expect(screen.getByText(/por Maria Souza/)).toBeInTheDocument()
    expect(screen.getByText(/\d{2}\/\d{2}\/\d{2,4}/)).toBeInTheDocument()
  })

  it('salvar manda para a action o texto EXATO digitado', async () => {
    montar([linha({})], true)
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência sem justificativa' }))
    const caixa = screen.getByRole('textbox', { name: 'Justificativa da divergência' })
    const digitado = '  Fornecedor mandou 5 a menos — repor até 15/10 😀  '
    fireEvent.change(caixa, { target: { value: digitado } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvar).toHaveBeenCalledTimes(1))
    expect(salvar).toHaveBeenCalledWith('p1', digitado)
  })

  it('salvar com texto troca o selo de ? para ✅', async () => {
    montar([linha({})], true)
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência sem justificativa' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Justificativa da divergência' }), {
      target: { value: 'Alinhado com o fornecedor.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(tabela().getByRole('button', { name: 'Divergência justificada' })).toBeInTheDocument(),
    )
    expect(tabela().queryByRole('button', { name: 'Divergência sem justificativa' })).toBeNull()
  })

  it('salvar vazio apaga: o selo volta de ✅ para ?', async () => {
    montar([linha({ divergencia_justificativa: 'Texto antigo' })], true)
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência justificada' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Justificativa da divergência' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvar).toHaveBeenCalledWith('p1', ''))
    await waitFor(() =>
      expect(tabela().getByRole('button', { name: 'Divergência sem justificativa' })).toBeInTheDocument(),
    )
    expect(tabela().queryByRole('button', { name: 'Divergência justificada' })).toBeNull()
  })

  it('se o servidor recusa, mostra o erro e o selo não muda', async () => {
    salvar.mockResolvedValue({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    montar([linha({})], true)
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência sem justificativa' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Justificativa da divergência' }), {
      target: { value: 'tentativa' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão')
    // Com o diálogo aberto o resto da página fica aria-hidden: por isso `hidden: true`.
    const t = within(screen.getByRole('table', { hidden: true }))
    expect(t.getByRole('button', { name: 'Divergência sem justificativa', hidden: true })).toBeInTheDocument()
    expect(t.queryByRole('button', { name: 'Divergência justificada', hidden: true })).toBeNull()
  })

  it('Cancelar fecha sem chamar a action', () => {
    montar([linha({})], true)
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência sem justificativa' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(salvar).not.toHaveBeenCalled()
  })

  describe('permissão administrar', () => {
    it('COM permissão: a caixa é editável e há botão Salvar (contraste que dá poder ao teste de baixo)', () => {
      montar([linha({})], true)
      fireEvent.click(tabela().getByRole('button', { name: 'Divergência sem justificativa' }))
      const caixa = screen.getByRole('textbox', { name: 'Justificativa da divergência' })
      expect(caixa).not.toHaveAttribute('readonly')
      expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
    })

    it('SEM permissão: a caixa existe, é só leitura, mostra o texto e não há Salvar', () => {
      montar([linha({ divergencia_justificativa: 'Texto que o conferente pode ler' })], false)
      fireEvent.click(tabela().getByRole('button', { name: 'Divergência justificada' }))
      // O elemento EXISTE (afirmação positiva) — sem isso o teste de baixo poderia passar vazio.
      const caixa = screen.getByRole('textbox', { name: 'Justificativa da divergência' })
      expect(caixa).toHaveValue('Texto que o conferente pode ler')
      expect(caixa).toHaveAttribute('readonly')
      expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
      expect(salvar).not.toHaveBeenCalled()
    })
  })
})

describe('ordenação e filtro da coluna Divergência continuam funcionando', () => {
  it('o cabeçalho abre o menu e ordenar navega com a coluna divergencia', () => {
    montar([linha({})], true)
    fireEvent.click(tabela().getByRole('button', { name: 'Divergência' }))
    fireEvent.click(screen.getByRole('button', { name: /↑/ }))
    expect(push).toHaveBeenCalledTimes(1)
    const url = String(push.mock.calls[0]![0])
    expect(url).toMatch(/^\/recebimento\/processos\?g=/)
    const g = decodeURIComponent(url.split('g=')[1]!)
    expect(g).toContain('divergencia')
  })
})
