import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrdemForm, type OrdemView } from '../ordem-form'

/**
 * Posto Almoxarifado automático na OP NOVA (etapa 2 do card único): com a prop ligada, o posto
 * aparece como última linha FIXA (sem remover/mover) e vai no fim do campo `fluxo`; desligada, o
 * formulário é o de sempre; na edição nada muda.
 */

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
  postos: ['Teste', 'Embalagem'], receitaPorPosto: {}, tempoBurninPorPosto: {},
} as OrdemView

function montar(props: { ordem?: OrdemView; almoxarifadoAutomatico?: string | null } = {}) {
  return render(
    <OrdemForm
      postos={['Teste', 'Embalagem', 'Almoxarifado']}
      postosPerfil={{}}
      ordem={props.ordem}
      padroesExistentes={[]}
      pmosExistentes={['PMOX01']}
      clientesExistentes={['Cliente']}
      dadosPorPmo={{}}
      almoxarifadoAutomatico={props.almoxarifadoAutomatico}
    />,
  )
}
const fluxoEnviado = (c: HTMLElement) => JSON.parse((c.querySelector('input[name="fluxo"]') as HTMLInputElement).value) as string[]
const adicionar = (posto: string) => fireEvent.change(screen.getAllByRole('combobox').find((s) => Array.from((s as HTMLSelectElement).options).some((o) => o.value === posto && o.parentElement === s))!, { target: { value: posto } })

describe('posto Almoxarifado automático no formulário de OP', () => {
  it('DESLIGADO (prop ausente): nenhuma linha fixa; o Almoxarifado segue como posto comum e removível', () => {
    const { container } = montar()
    adicionar('Almoxarifado')
    expect(fluxoEnviado(container)).toEqual(['Almoxarifado'])
    expect(screen.getAllByLabelText('Remover')).toHaveLength(1)
    expect(screen.queryByText(/automático/i)).toBeNull()
  })

  it('LIGADO + OP nova: o Almoxarifado aparece fixo no fim, sem botões, e vai por último no envio', () => {
    const { container } = montar({ almoxarifadoAutomatico: 'Almoxarifado' })
    expect(screen.getByText('Almoxarifado')).toBeTruthy()
    expect(screen.getByText(/automático/i)).toBeTruthy()
    expect(screen.queryAllByLabelText('Remover')).toHaveLength(0)
    expect(fluxoEnviado(container)).toEqual(['Almoxarifado'])
    adicionar('Teste')
    adicionar('Embalagem')
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
    // mover/remover só afetam os demais; o Almoxarifado continua no fim.
    fireEvent.click(screen.getAllByLabelText('Subir')[1]!)
    expect(fluxoEnviado(container)).toEqual(['Embalagem', 'Teste', 'Almoxarifado'])
    fireEvent.click(screen.getAllByLabelText('Remover')[0]!)
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Almoxarifado'])
  })

  it('LIGADO + OP nova: o Almoxarifado não é oferecido de novo em "Adicionar posto"', () => {
    montar({ almoxarifadoAutomatico: 'Almoxarifado' })
    const opcoes = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opcoes).not.toContain('Almoxarifado')
  })

  it('LIGADO + EDIÇÃO: nada muda (sem linha fixa; rota como veio do banco)', () => {
    const { container } = montar({ ordem: BASE, almoxarifadoAutomatico: 'Almoxarifado' })
    expect(screen.queryByText(/automático/i)).toBeNull()
    expect(fluxoEnviado(container)).toEqual(['Teste', 'Embalagem'])
    expect(screen.getAllByLabelText('Remover')).toHaveLength(2)
  })
})
