import type * as React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { editarOrdemAction } from '@/modules/shopfloor/application/ordens-actions'
import { OrdemForm, type OrdemView } from '../ordem-form'

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
const confirmar = vi.hoisted(() => vi.fn(async (_o: unknown) => true))
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

const BASE: OrdemView = {
  id: 'id-1', pmo: 'PMOF', op: '8682_F', cliente: 'Cliente', qtd: 1000,
  descricao: 'Produto', acp: '', status: 'ATIVA', sn_ini: '0845801001', sn_fim: '0845801993',
  postos: ['Teste'], receitaPorPosto: {}, tempoBurninPorPosto: {}, placas_por_painel: 1,
  embalagem_individual: false,
}

function montar(ordem?: OrdemView) {
  return render(
    <OrdemForm
      postos={['Teste']}
      postosPerfil={{}}
      ordem={ordem}
      padroesExistentes={[]}
      pmosExistentes={['PMOF']}
      clientesExistentes={['Cliente']}
      dadosPorPmo={{}}
    />,
  )
}

const faixasEnviadas = (c: HTMLElement) =>
  JSON.parse(String(new FormData(c.querySelector('form') as HTMLFormElement).get('faixas')))

describe('faixas de SN no cadastro de OP', () => {
  it('OP de uma faixa: a cara de sempre (SN inicial/final) e a faixa vai no campo faixas', () => {
    const { container } = montar(BASE)
    expect((screen.getByLabelText('SN inicial *') as HTMLInputElement).value).toBe('0845801001')
    expect((screen.getByLabelText('SN final *') as HTMLInputElement).value).toBe('0845801993')
    expect(screen.queryByLabelText('Remover faixa 1')).toBeNull()
    expect(faixasEnviadas(container)).toEqual([{ sn_ini: '0845801001', sn_fim: '0845801993' }])
  })

  it('adicionar uma faixa: mostra a contagem por faixa e o total contra a quantidade', () => {
    const { container } = montar(BASE)
    fireEvent.click(screen.getByText('Adicionar faixa'))
    fireEvent.change(screen.getByLabelText('SN inicial (faixa 2) *'), { target: { value: '08458001024' } })
    fireEvent.change(screen.getByLabelText('SN final (faixa 2) *'), { target: { value: '08458001030' } })
    expect(screen.getByText('993 nº')).toBeTruthy()
    expect(screen.getByText('7 nº')).toBeTruthy()
    expect(screen.getByText(/Total das faixas: 1000 números · Quantidade: 1000/)).toBeTruthy()
    expect(faixasEnviadas(container)).toEqual([
      { sn_ini: '0845801001', sn_fim: '0845801993' },
      { sn_ini: '08458001024', sn_fim: '08458001030' },
    ])
  })

  it('OP com duas faixas abre com as duas; remover volta para uma', () => {
    const { container } = montar({
      ...BASE,
      faixas: [
        { sn_ini: '0845801001', sn_fim: '0845801993' },
        { sn_ini: '08458001024', sn_fim: '08458001030' },
      ],
    })
    expect((screen.getByLabelText('SN inicial (faixa 2) *') as HTMLInputElement).value).toBe('08458001024')
    fireEvent.click(screen.getByLabelText('Remover faixa 2'))
    expect(screen.queryByLabelText('SN inicial (faixa 2) *')).toBeNull()
    expect(faixasEnviadas(container)).toEqual([{ sn_ini: '0845801001', sn_fim: '0845801993' }])
  })

  it('aviso do servidor (registros fora das faixas): pergunta e, confirmado, reenvia com confirmar_fora_faixa=1', async () => {
    const editar = vi.mocked(editarOrdemAction)
    editar.mockResolvedValueOnce({ ok: false, erro: '7 registros ficariam fora das faixas novas. Salvar mesmo assim?', confirmarForaDaFaixa: 7 })
    editar.mockResolvedValueOnce({ ok: true, id: 'id-1', pmo: 'PMOF', op: '8682_F' })
    const { container } = montar(BASE)
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    await waitFor(() => expect(confirmar).toHaveBeenCalledWith({
      titulo: '7 registros ficariam fora das faixas novas. Salvar mesmo assim?',
      rotuloConfirmar: 'Salvar mesmo assim',
    }))
    await waitFor(() => expect(editar).toHaveBeenCalledTimes(2))
    const fd = editar.mock.calls[1]![1] as FormData
    expect(fd.get('confirmar_fora_faixa')).toBe('1')
    expect(editar.mock.calls[0]![1].get('confirmar_fora_faixa')).toBeNull()
  })
})
