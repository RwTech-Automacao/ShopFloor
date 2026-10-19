import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'

/**
 * Dublê do React Flow: o card usa `Handle` só pra o canvas saber onde as arestas encostam, e o
 * `Handle` de verdade exige o store do ReactFlow (fora de um canvas ele quebra). Nada do que
 * interessa aqui — os números e os rótulos do card — depende dele.
 */
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

// O card Concluído consulta o estoque do Compels por uma server action; aqui ela não importa.
vi.mock('@/modules/shopfloor/application/estoque-compels-actions', () => ({
  lerEstoqueCompelsAction: vi.fn(async () => ({ tipo: 'nao_configurado' })),
}))

const { FluxoNode } = await import('../fluxo-node')

/** Payload mínimo de um posto comum (passagem, sem status) — a base de cada caso. */
function base(over: Record<string, unknown> = {}) {
  return {
    posto: 'Embalagem',
    wip: 3,
    registros: 80,
    aprovadas: 0,
    reprovadas: 0,
    retestes: 0,
    aprovadosPrimeira: 0,
    reprovadosSemReteste: 0,
    temStatus: false,
    ehManutencao: false,
    recurso: 'caixa',
    concluido: false,
    passou: 80,
    devemPassar: 140,
    selecionado: false,
    ...over,
  }
}

/** Texto do card com espaços normalizados (os números vivem em spans separados). */
function texto(payload: Record<string, unknown>): string {
  const { container } = render(createElement(FluxoNode, { data: payload } as never))
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('card do posto no Fluxo da OP', () => {
  describe('posto de Almoxarifado (métricas próprias)', () => {
    const almox = (over: Record<string, unknown> = {}) =>
      base({ posto: 'Almoxarifado', recurso: 'almoxarifado', wip: 14, registros: 112, passou: 112, devemPassar: 126, caixasBipadas: 8, caixasFechadas: 10, ...over })

    it('mostra peças e caixas, as duas unidades (numa OP coletiva o operador conta caixas)', () => {
      const t = texto(almox())
      expect(t).toContain('112/126 peças')
      expect(t).toContain('8/10 caixas')
    })

    it('NOMEIA a fila na porta do almoxarifado: "Disponível Produção" com a contagem', () => {
      const t = texto(almox())
      expect(t).toContain('Disponível Produção')
      expect(t).toContain('14')
    })

    it('OP de embalagem individual (sem caixa): a linha das caixas não aparece', () => {
      const t = texto(almox({ caixasBipadas: undefined, caixasFechadas: undefined }))
      expect(t).toContain('112/126 peças')
      expect(t).not.toContain('caixas')
      expect(t).toContain('Disponível Produção') // a fila continua valendo
    })

    it('deixa o denominador legível no tooltip: é o que CHEGOU EMBALADO, não a qtd da OP', () => {
      const { container } = render(createElement(FluxoNode, { data: almox() } as never))
      const tips = [...container.querySelectorAll('[title]')].map((e) => e.getAttribute('title') ?? '').join(' | ')
      expect(tips).toMatch(/chegou embalado|chegaram embaladas/i)
      expect(tips).toMatch(/manutenção|sucatead/i) // diz POR QUE não fecha com a OP
      expect(tips).toContain('Disponível Produção')
    })
  })

  describe('REGRESSÃO: nenhum outro posto muda', () => {
    it('posto de passagem (Embalagem, que tem caixa na vida real) segue mostrando só peças', () => {
      const t = texto(base())
      expect(t).toContain('80 / 140')
      expect(t).not.toContain('peças')
      expect(t).not.toContain('caixas')
      expect(t).not.toContain('Disponível Produção')
    })

    it('posto com status (teste/inspeção) segue com % de 1ª e reprovadas', () => {
      const t = texto(base({ posto: 'Teste', recurso: 'nenhum', temStatus: true, aprovadas: 90, passou: 90, aprovadosPrimeira: 81, reprovadosSemReteste: 4 }))
      expect(t).toContain('90 / 140')
      expect(t).toContain('86%') // 81 de 94 que tiveram veredito (90 passaram + 4 reprovadas)
      expect(t).toContain('4')
      expect(t).not.toContain('Disponível Produção')
    })

    it('contagem de caixa num posto que NÃO é Almoxarifado é ignorada pelo card', () => {
      // Defesa em profundidade: mesmo se o dado chegar (agregado errado, refactor futuro), o card
      // de outro posto não pode inventar uma linha de caixas.
      const t = texto(base({ caixasBipadas: 8, caixasFechadas: 10 }))
      expect(t).not.toContain('caixas')
    })
  })
})
