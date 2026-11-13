import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdemForm } from '../ordem-form'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/modules/shopfloor/application/ordens-actions', () => ({
  criarOrdemAction: vi.fn(),
  editarOrdemAction: vi.fn(),
  opTemRegistrosAction: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/padroes-fluxo-actions', () => ({
  salvarPadraoAction: vi.fn(),
  excluirPadraoAction: vi.fn(),
}))
const confirmar = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirmacao: () => ({ confirmar, dialog: null }) }))

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


function renderForm({ situacaoEstruturaPorPmo, pmoInicial }: { situacaoEstruturaPorPmo: Record<string, 'rascunho' | 'ativa'>; pmoInicial: string }) {
  const r = render(
    <OrdemForm
      postos={['Teste']}
      postosPerfil={{}}
      padroesExistentes={[]}
      pmosExistentes={[]}
      clientesExistentes={[]}
      dadosPorPmo={{}}
      situacaoEstruturaPorPmo={situacaoEstruturaPorPmo}
    />,
  )
  fireEvent.change(screen.getByLabelText('PMO *'), { target: { value: pmoInicial } })
  return r
}

describe('aviso da estrutura no formulário da OP', () => {
  it('PMO com estrutura ativa mostra que as PRTs serão apontadas', () => {
    renderForm({ situacaoEstruturaPorPmo: { PMOC14: 'ativa' }, pmoInicial: 'PMOC14' })
    expect(screen.getByText('Esta PMO tem estrutura ativa: as PRTs serão apontadas no Compels pelo ShopFloor.')).toBeTruthy()
  })
  it('PMO sem estrutura mostra o aviso com link para Estruturas', () => {
    renderForm({ situacaoEstruturaPorPmo: {}, pmoInicial: 'PMOX' })
    expect(screen.getByText(/Esta PMO não tem estrutura — as PRTs não serão apontadas pelo ShopFloor\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Cadastrar estrutura' }).getAttribute('href')).toBe('/shopfloor/estruturas?pmo=PMOX')
  })
  it('estrutura em rascunho avisa que ainda não vale', () => {
    renderForm({ situacaoEstruturaPorPmo: { PMOC14: 'rascunho' }, pmoInicial: 'PMOC14' })
    expect(screen.getByText('A estrutura desta PMO está em rascunho: ative-a em Estruturas para valer nesta OP.')).toBeTruthy()
  })
  it('PMO com sufixo de OP (PMOC14_F) usa a estrutura da PMO base', () => {
    renderForm({ situacaoEstruturaPorPmo: { PMOC14: 'ativa' }, pmoInicial: 'PMOC14_F' })
    expect(screen.getByText('Esta PMO tem estrutura ativa: as PRTs serão apontadas no Compels pelo ShopFloor.')).toBeTruthy()
  })
  it('o link de PMOX_F aponta para a PMO base', () => {
    renderForm({ situacaoEstruturaPorPmo: {}, pmoInicial: 'PMOX_F' })
    expect(screen.getByRole('link', { name: 'Cadastrar estrutura' }).getAttribute('href')).toBe('/shopfloor/estruturas?pmo=PMOX')
  })
})
