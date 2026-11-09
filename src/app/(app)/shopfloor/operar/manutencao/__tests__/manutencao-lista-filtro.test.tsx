import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Ocorrencia } from '@/modules/shopfloor/domain/manutencao-pendencias'
import { ManutencaoLista } from '../manutencao-lista'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/modules/shopfloor/application/manutencao-actions', () => ({ registrarReparo: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// A rolagem horizontal da tabela mede a largura com ResizeObserver, que o jsdom não tem.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

const ocorrencia = (sn: string): Ocorrencia => ({
  dataHora: '2026-11-06T12:00:00Z', cliente: 'RW', pmo: 'PMOF52_F', op: '8682_F', sn,
  posto: 'Teste', cod: '1002', tipo: 'SMD', posicoes: [], status: 'Pendente',
})

function montar() {
  render(
    <ManutencaoLista
      ocorrencias={[ocorrencia('0845801001FNT'), ocorrencia('0845801002FNT'), ocorrencia('0845802000FNT')]}
      defeitosCatalogo={[]}
      consertosCatalogo={[]}
    />,
  )
}

const filtrar = (texto: string) => fireEvent.change(screen.getByPlaceholderText('Filtrar por SN'), { target: { value: texto } })
const visiveis = () => ['0845801001FNT', '0845801002FNT', '0845802000FNT'].filter((sn) => screen.queryByText(sn))

describe('Manutenção — filtro por Nº de Série', () => {
  it('o SN digitado COM ESPAÇO (como na etiqueta) acha a peça gravada sem espaço', () => {
    montar()
    filtrar('0845801001 FNT')
    expect(visiveis()).toEqual(['0845801001FNT'])
  })

  it('com traço e em minúsculas também acha', () => {
    montar()
    filtrar('0845801002-fnt')
    expect(visiveis()).toEqual(['0845801002FNT'])
  })

  it('pedaço do SN continua funcionando', () => {
    montar()
    filtrar('458010')
    expect(visiveis()).toEqual(['0845801001FNT', '0845801002FNT'])
  })

  it('campo vazio mostra todas', () => {
    montar()
    filtrar('')
    expect(visiveis()).toHaveLength(3)
  })
})
