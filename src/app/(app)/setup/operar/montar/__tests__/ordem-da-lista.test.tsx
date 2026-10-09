import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ItemSetup } from '@/modules/setup/infra/setup-repository'

// Os itens como o servidor os entrega: por posição (é a ordem canônica do repositório).
function item(posicao: string, criadoEm: string, atualizadoEm = criadoEm): ItemSetup {
  return { id: `i${posicao}`, posicao, feeder: `F${posicao}`, componente: `C${posicao}`, rolo: `R${posicao}`, colaborador: 'ana', atualizadoEm, criadoEm }
}

const ITENS_DO_SERVIDOR: ItemSetup[] = [
  item('1', '2026-10-01T10:00:00Z', '2026-10-09T18:00:00Z'), // o mais ANTIGO, mas EDITADO agora há pouco
  item('2', '2026-10-01T10:05:00Z'),
  item('3', '2026-10-01T10:10:00Z'), // o mais recente criado
]

vi.mock('@/modules/setup/application/setup-actions', () => ({
  abrirSetup: vi.fn(),
  editarItem: vi.fn(),
  incluirItem: vi.fn(),
  liberarSetup: vi.fn(),
  removerItem: vi.fn(),
  setupsParaCopiar: vi.fn(),
  localizarSetup: vi.fn(async () => ({ ok: true, setup: { id: 's1' } })),
  carregarSetupAction: vi.fn(async () => ({
    ok: true,
    setup: { id: 's1', pmo: 'PMO1', op: '10', estado: 'montagem', face: 'TOP', processo: 'SMD', equipamentoId: 'e1', linha: 'L1', bloco: 'B1', maquina: 'M1', snAbertura: null, colaborador: 'ana', criadoEm: '2026-10-01T09:00:00Z', liberadoEm: null, totalItens: 3, semRolo: 0 },
    itens: ITENS_DO_SERVIDOR,
  })),
}))

// A cascata de seleção não é o assunto: um botão entrega a seleção completa.
vi.mock('../../../selecao-setup', async (orig) => {
  const real = await orig<typeof import('../../../selecao-setup')>()
  return {
    ...real,
    SelecaoSetup: ({ onChange }: { onChange: (v: unknown) => void }) => (
      <button onClick={() => onChange({ pmo: 'PMO1', op: '10', processo: 'SMD', linha: 'L1', bloco: 'B1', maquina: 'M1', equipamentoId: 'e1', face: 'TOP' })}>escolher</button>
    ),
  }
})

import { MontarSetup } from '../montar-setup'

describe('Montar setup: ordem da lista', () => {
  it('mostra o item criado mais recentemente em primeiro, e EDITAR o mais antigo não o move', async () => {
    render(<MontarSetup ordens={[]} equipamentos={[]} podeAdministrar={false} />)
    fireEvent.click(screen.getByText('escolher'))
    await waitFor(() => expect(screen.getAllByText(/^C\d$/)).toHaveLength(3))
    const ordem = screen.getAllByText(/^C\d$/).map((e) => e.textContent)
    // Inverso da criação: 3, 2, 1. O item 1 foi editado por último e mesmo assim fica no fim.
    expect(ordem).toEqual(['C3', 'C2', 'C1'])
  })
})
