import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { GraficoSemanas, PositivasNegativas, RankingFornecedores } from '../graficos-dashboard'

describe('ranking por fornecedor', () => {
  const fornecedores = [
    { fornecedor: 'Panasonic', divergentes: 2, itens: 3 },
    { fornecedor: 'Fornecedora Internacional de Componentes Eletrônicos e Passivos Ltda.', divergentes: 2, itens: 4 },
    { fornecedor: '', divergentes: 1, itens: 1 },
  ]
  it('cada barra mostra os divergentes e "x% dos itens dele"', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Panasonic/ })).toHaveTextContent('66,7% dos itens dele')
  })
  it('clicar aplica o filtro do fornecedor', () => {
    const onClique = vi.fn()
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={onClique} />)
    fireEvent.click(screen.getByRole('button', { name: /Panasonic/ }))
    expect(onClique).toHaveBeenCalledWith('Panasonic')
  })
  it('fornecedor em branco aparece como "(sem fornecedor)" e não é clicável', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={vi.fn()} />)
    const semFornecedor = screen.getByText('(sem fornecedor)')
    expect(semFornecedor.closest('button')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
  it('nome longo corta com reticências e guarda o nome inteiro no title', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="" onClique={vi.fn()} />)
    const nome = screen.getByText(/^Fornecedora Internacional/)
    expect(nome).toHaveClass('truncate')
    expect(nome).toHaveAttribute('title', fornecedores[1]!.fornecedor)
  })
  it('o filtrado fica marcado', () => {
    render(<RankingFornecedores fornecedores={fornecedores} ativo="Panasonic" onClique={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Panasonic/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('vazio: mensagem, sem barra', () => {
    render(<RankingFornecedores fornecedores={[]} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum fornecedor com item divergente neste recorte.')).toBeInTheDocument()
  })
})

describe('divergências por semana', () => {
  const semanas = [
    { inicio: '2026-09-07', justificadas: 1, semJustificativa: 1 },
    { inicio: '2026-09-14', justificadas: 0, semJustificativa: 0 },
    { inicio: '2026-09-21', justificadas: 1, semJustificativa: 3 },
  ]
  it('uma coluna clicável por semana, inclusive a vazia', () => {
    render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
  it('a semana vazia não desenha barra; as outras empilham as duas séries', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    const colunas = container.querySelectorAll('g[role="button"]')
    expect(colunas[1]!.querySelectorAll('rect[data-serie]')).toHaveLength(0)
    expect(colunas[2]!.querySelectorAll('rect[data-serie]')).toHaveLength(2)
  })
  it('todo retângulo tem cor explícita (classe de fill; o anel de foco usa stroke + fill="none")', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    for (const r of container.querySelectorAll('rect:not([data-foco])')) expect(r.getAttribute('class') ?? '').toMatch(/fill-/)
  })
  it('clique e Enter filtram pela semana', () => {
    const onClique = vi.fn()
    render(<GraficoSemanas semanas={semanas} ativo="" onClique={onClique} />)
    fireEvent.click(screen.getByRole('button', { name: /Semana de 07\/09\/2026 a 13\/09\/2026/ }))
    expect(onClique).toHaveBeenLastCalledWith('2026-09-07')
    fireEvent.keyDown(screen.getByRole('button', { name: /Semana de 21\/09\/2026/ }), { key: 'Enter' })
    expect(onClique).toHaveBeenLastCalledWith('2026-09-21')
  })
  it('as barras desenhadas estão em escala: altura proporcional ao valor e todas na mesma base', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    const colunas = container.querySelectorAll('g[role="button"]')
    const n = (el: Element, a: string) => Number(el.getAttribute(a))
    const just0 = colunas[0]!.querySelector('rect[data-serie="justificadas"]')!
    const sem0 = colunas[0]!.querySelector('rect[data-serie="sem-justificativa"]')!
    const just2 = colunas[2]!.querySelector('rect[data-serie="justificadas"]')!
    const sem2 = colunas[2]!.querySelector('rect[data-serie="sem-justificativa"]')!
    const unidade = n(just0, 'height')
    expect(unidade).toBeGreaterThan(0)
    expect(n(sem0, 'height')).toBeCloseTo(unidade, 6)
    expect(n(just2, 'height')).toBeCloseTo(unidade, 6)
    expect(n(sem2, 'height')).toBeCloseTo(3 * unidade, 6)
    // mesma base, e o segmento de cima assenta sobre o de baixo
    expect(n(just0, 'y') + n(just0, 'height')).toBeCloseTo(n(just2, 'y') + n(just2, 'height'), 6)
    expect(n(sem2, 'y') + n(sem2, 'height')).toBeCloseTo(n(just2, 'y'), 6)
  })
  it('o rótulo do eixo Y "4" fica na altura do topo da barra que soma 4', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    const topo = Number(container.querySelectorAll('g[role="button"]')[2]!.querySelector('rect[data-serie="sem-justificativa"]')!.getAttribute('y'))
    const rotulo4 = [...container.querySelectorAll('text')].find((t) => t.textContent === '4')!
    expect(Number(rotulo4.getAttribute('y'))).toBeCloseTo(topo, 6)
  })
  it('cada coluna tem um anel de foco visível por teclado (não só um fundo fraco)', () => {
    const { container } = render(<GraficoSemanas semanas={semanas} ativo="" onClique={vi.fn()} />)
    const colunas = container.querySelectorAll('g[role="button"]')
    expect(colunas).toHaveLength(3)
    for (const coluna of colunas) {
      const anel = coluna.querySelector('rect[data-foco]')
      expect(anel).not.toBeNull()
      // Contorno explícito (stroke), sem preenchimento, que só aparece com foco de teclado.
      expect(anel!.getAttribute('fill')).toBe('none')
      expect(anel!.getAttribute('class')).toContain('stroke-ring')
      expect(anel!.getAttribute('class')).toContain('group-focus-visible:opacity-100')
      expect(anel!.getAttribute('class')).toContain('opacity-0')
      expect(Number(anel!.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(2)
    }
  })
  it('uma semana só: uma coluna', () => {
    render(<GraficoSemanas semanas={[semanas[2]!]} ativo="2026-09-21" onClique={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
  it('nenhuma divergência: mensagem no lugar do gráfico', () => {
    render(<GraficoSemanas semanas={[semanas[1]!]} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum item divergente neste recorte.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('sem semana nenhuma (recorte sem datas): mensagem', () => {
    render(<GraficoSemanas semanas={[]} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum item com data de chegada neste recorte.')).toBeInTheDocument()
  })
})

describe('positivas × negativas', () => {
  it('duas barras com número e porcentagem; clique aplica o sinal', () => {
    const onClique = vi.fn()
    render(<PositivasNegativas positivas={3} negativas={1} ativo="" onClique={onClique} />)
    expect(screen.getByRole('button', { name: /Positivas/ })).toHaveTextContent('75%')
    fireEvent.click(screen.getByRole('button', { name: /Negativas/ }))
    expect(onClique).toHaveBeenCalledWith('negativa')
  })
  it('o sinal filtrado fica marcado', () => {
    render(<PositivasNegativas positivas={3} negativas={1} ativo="positiva" onClique={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Positivas/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('nenhuma divergência: mensagem', () => {
    render(<PositivasNegativas positivas={0} negativas={0} ativo="" onClique={vi.fn()} />)
    expect(screen.getByText('Nenhum item divergente neste recorte.')).toBeInTheDocument()
  })
})
