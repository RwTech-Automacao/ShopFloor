import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdemForm, type OrdemView } from '../ordem-form'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({
  criarOrdemAction: vi.fn(),
  editarOrdemAction: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({
  salvarPadraoAction: vi.fn(),
  excluirPadraoAction: vi.fn(),
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => vi.fn() }))

// Select nativo no lugar do Base UI (portal/floating-ui não funcionam em jsdom).
vi.mock('@/components/ui/select', () => ({
  Select: ({ name, value, defaultValue, onValueChange, children }: { name?: string; value?: string; defaultValue?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
    <select aria-label={name} name={name} value={value} defaultValue={value === undefined ? defaultValue : undefined} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => <option value={value}>{children}</option>,
}))
// O diálogo abre inline: em jsdom o portal do Base UI não renderiza. O botão extra existe para
// disparar `onOpenChange(true)` — é lá que a tela faz o reset dos campos ao reabrir.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: { children?: React.ReactNode; onOpenChange?: (v: boolean) => void }) => (
    <>
      <button type="button" onClick={() => onOpenChange?.(true)}>reabrir</button>
      {children}
    </>
  ),
  DialogTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogFooter: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
}))

const BASE: OrdemView = {
  id: 'id-1', pmo: 'PMOX01', op: '9001', cliente: 'Cliente', qtd: 10,
  descricao: 'Produto', acp: '', status: 'ATIVA', sn_ini: '1', sn_fim: '10',
  postos: ['Teste'], receitaPorPosto: {}, tempoBurninPorPosto: {}, placas_por_painel: 1,
} as OrdemView

function montar(ordem?: OrdemView) {
  return render(
    <OrdemForm
      postos={['Teste']}
      postosPerfil={{}}
      ordem={ordem}
      padroesExistentes={[]}
      pmosExistentes={['PMOX01']}
      clientesExistentes={['Cliente']}
      dadosPorPmo={{}}
    />,
  )
}

describe('placas por painel no cadastro de OP', () => {
  it('com N=1 o campo "Painéis" não aparece', () => {
    montar({ ...BASE, placas_por_painel: 1 })
    expect(screen.queryByLabelText('Painéis')).toBeNull()
    expect((screen.getByLabelText('Placas por painel') as HTMLInputElement).name).toBe('placas_por_painel')
  })

  it('com N=50, digitar 100 em "Painéis" faz a Quantidade valer 5000', () => {
    montar({ ...BASE, placas_por_painel: 50, qtd: null })
    fireEvent.change(screen.getByLabelText('Painéis'), { target: { value: '100' } })
    expect((screen.getByLabelText('Quantidade') as HTMLInputElement).value).toBe('5000')
  })

  it('com N=50, digitar a Quantidade preenche os painéis (vazio se não divide exato)', () => {
    montar({ ...BASE, placas_por_painel: 50, qtd: null })
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '5000' } })
    expect((screen.getByLabelText('Painéis') as HTMLInputElement).value).toBe('100')
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '5001' } })
    expect((screen.getByLabelText('Painéis') as HTMLInputElement).value).toBe('')
  })

  it('"Painéis" não é enviado no formulário', () => {
    montar({ ...BASE, placas_por_painel: 50 })
    expect((screen.getByLabelText('Painéis') as HTMLInputElement).name).toBe('')
  })

  it('aparece ao subir o N de 1 para mais', () => {
    montar({ ...BASE, placas_por_painel: 1 })
    fireEvent.change(screen.getByLabelText('Placas por painel'), { target: { value: '25' } })
    expect(screen.getByLabelText('Painéis')).toBeTruthy()
  })
})
